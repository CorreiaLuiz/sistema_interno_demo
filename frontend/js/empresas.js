exigirLogin();
inicializarShell();

const modal = document.getElementById('modal-empresa');
const form = document.getElementById('form-empresa');
const erroEmpresa = document.getElementById('erro-empresa');

let responsaveisLegalizacaoCarregados = false;

async function carregarResponsaveisLegalizacao() {
  if (responsaveisLegalizacaoCarregados) return;
  const usuarios = await apiFetch('/processos-legalizacao/responsaveis-elegiveis');
  const select = document.getElementById('responsavel_legalizacao_id');
  (usuarios || []).forEach((u) => {
    const opt = document.createElement('option');
    opt.value = u.id;
    opt.textContent = u.nome;
    select.appendChild(opt);
  });
  responsaveisLegalizacaoCarregados = true;
}

function abrirModal(empresa = null) {
  erroEmpresa.textContent = '';
  form.reset();
  document.getElementById('empresa-id').value = '';
  document.getElementById('titulo-modal').textContent = empresa ? 'Editar Empresa' : 'Nova Empresa';

  // O campo de "atribuir responsável de Legalização automaticamente" só
  // faz sentido ao CRIAR a empresa — editar uma já existente não deveria
  // gerar um novo processo de abertura sozinho.
  const campoResponsavel = document.getElementById('campo-responsavel-legalizacao');
  campoResponsavel.style.display = empresa ? 'none' : 'block';
  if (!empresa) carregarResponsaveisLegalizacao();

  if (empresa) {
    document.getElementById('empresa-id').value = empresa.id;
    document.getElementById('razao_social').value = empresa.razao_social || '';
    document.getElementById('nome_fantasia').value = empresa.nome_fantasia || '';
    document.getElementById('cnpj').value = empresa.cnpj || '';
    document.getElementById('regime_tributario').value = empresa.regime_tributario || 'simples_nacional';
    document.getElementById('situacao').value = empresa.situacao || 'ativa';
    document.getElementById('cidade').value = empresa.cidade || '';
    document.getElementById('uf').value = empresa.uf || '';
    document.getElementById('telefone').value = empresa.telefone || '';
    document.getElementById('email').value = empresa.email || '';
    document.getElementById('observacoes').value = empresa.observacoes || '';
    document.getElementById('competencia_inicio').value = empresa.competencia_inicio ? String(empresa.competencia_inicio).slice(0, 7) : '';
    document.getElementById('fator_r').value = empresa.fator_r === true ? 'sim' : empresa.fator_r === false ? 'nao' : '';
    document.getElementById('pro_labore').value = empresa.pro_labore || '';
    // CNPJ não pode ser alterado após criado (evita inconsistência fiscal)
    document.getElementById('cnpj').disabled = true;
    mostrarOutrosDestinatarios(empresa.id);
  } else {
    document.getElementById('cnpj').disabled = false;
    document.getElementById('outros-destinatarios').style.display = 'none';
  }

  modal.classList.add('aberto');
}

/**
 * Guias e avisos vão para o e-mail do cadastro E para cada login ativo da Área do
 * Cliente da empresa — mostra esses outros e-mails embaixo do campo, para ninguém
 * trocar o e-mail achando que só ele recebe.
 */
async function mostrarOutrosDestinatarios(empresaId) {
  const aviso = document.getElementById('outros-destinatarios');
  aviso.style.display = 'none';
  try {
    const dados = await apiFetch(`/empresas/${empresaId}/acessos-cliente`);
    if (document.getElementById('empresa-id').value !== empresaId) return; // já abriu outra empresa
    const ativos = ((dados && dados.acessos) || []).filter((c) => c.ativo !== false);
    if (!ativos.length) return;
    aviso.innerHTML = `As guias e avisos <strong>também vão para</strong>: ${ativos.map((c) => `${esc(c.email)}${c.nome ? ` (${esc(c.nome)})` : ''}`).join(', ')}
      — ${ativos.length > 1 ? 'são logins' : 'é login'} da Área do Cliente. Para tirar, use o menu ⋮ → Área do Cliente.`;
    aviso.style.display = '';
  } catch (err) { /* sem permissão para ver os acessos: não mostra */ }
}

function fecharModal() {
  modal.classList.remove('aberto');
}

document.getElementById('btn-nova-empresa').addEventListener('click', () => abrirModal());
document.getElementById('btn-cancelar').addEventListener('click', fecharModal);

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  erroEmpresa.textContent = '';

  const id = document.getElementById('empresa-id').value;
  const corpo = {
    razao_social: document.getElementById('razao_social').value,
    nome_fantasia: document.getElementById('nome_fantasia').value,
    cnpj: document.getElementById('cnpj').value,
    regime_tributario: document.getElementById('regime_tributario').value,
    situacao: document.getElementById('situacao').value,
    cidade: document.getElementById('cidade').value,
    uf: document.getElementById('uf').value,
    telefone: document.getElementById('telefone').value,
    email: document.getElementById('email').value,
    observacoes: document.getElementById('observacoes').value,
    competencia_inicio: document.getElementById('competencia_inicio').value,
    fator_r: document.getElementById('fator_r').value,
    pro_labore: document.getElementById('pro_labore').value
  };

  // Só faz sentido mandar isso na criação (o campo fica escondido ao editar)
  if (!id) {
    const responsavelId = document.getElementById('responsavel_legalizacao_id').value;
    if (responsavelId) corpo.responsavel_legalizacao_id = responsavelId;
  }

  try {
    if (id) {
      await apiFetch(`/empresas/${id}`, { method: 'PUT', body: corpo });
    } else {
      await apiFetch('/empresas', { method: 'POST', body: corpo });
    }
    fecharModal();
    notificar(corpo.responsavel_legalizacao_id ? 'Empresa cadastrada — processo de abertura já atribuído.' : 'Empresa salva.', 'sucesso');
    carregarEmpresas();
  } catch (err) {
    erroEmpresa.textContent = err.message;
  }
});

const ROTULOS_REGIME = {
  simples_nacional: 'Simples Nacional',
  lucro_presumido: 'Lucro Presumido',
  lucro_real: 'Lucro Real',
  mei: 'MEI'
};

function badgeSituacao(situacao) {
  const rotulos = {
    ativa: 'Ativa', suspensa: 'Suspensa', baixada: 'Baixada', em_legalizacao: 'Em legalização',
    saiu_escritorio: 'Saiu do escritório'
  };
  return `<span class="badge badge-${situacao}">${rotulos[situacao] || situacao}</span>`;
}

// ===== Saída da empresa do escritório (só administrador) =====
const ehAdministrador = pode('empresas.excluir');
const modalSaida = document.getElementById('modal-saida');
const formSaida = document.getElementById('form-saida');
let empresaSaidaAtual = null;

function abrirModalSaida(empresa) {
  empresaSaidaAtual = empresa.id;
  formSaida.reset();
  document.getElementById('erro-saida').textContent = '';
  document.getElementById('saida-nome-empresa').textContent = empresa.razao_social;
  modalSaida.classList.add('aberto');
}

document.getElementById('btn-cancelar-saida').addEventListener('click', () => modalSaida.classList.remove('aberto'));

formSaida.addEventListener('submit', async (e) => {
  e.preventDefault();
  document.getElementById('erro-saida').textContent = '';
  try {
    await apiFetch(`/empresas/${empresaSaidaAtual}/saida`, {
      method: 'POST',
      body: {
        data_saida: document.getElementById('saida-data').value,
        observacao: document.getElementById('saida-observacao').value
      }
    });
    modalSaida.classList.remove('aberto');
    notificar('Saída registrada — o escritório foi avisado por e-mail.', 'sucesso');
    carregarEmpresas();
  } catch (err) {
    document.getElementById('erro-saida').textContent = err.message;
  }
});

let paginaAtual = 1;
const LIMITE = 20;

async function carregarEmpresas() {
  const busca = document.getElementById('filtro-busca').value;
  const situacao = document.getElementById('filtro-situacao').value;

  const params = new URLSearchParams({ pagina: paginaAtual, limite: LIMITE });
  if (busca) params.append('busca', busca);
  if (situacao) params.append('situacao', situacao);

  const resultado = await apiFetch(`/empresas?${params.toString()}`);
  const tbody = document.getElementById('tabela-empresas');
  tbody.innerHTML = '';

  atualizarControlesPagina(resultado ? resultado.total : 0);

  if (!resultado || resultado.dados.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6">Nenhuma empresa encontrada.</td></tr>';
    return;
  }

  resultado.dados.forEach((empresa) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${linkEmpresa(empresa.id, empresa.razao_social)}</td>
      <td><span class="ledger">${esc(empresa.cnpj)}</span></td>
      <td>${esc(ROTULOS_REGIME[empresa.regime_tributario] || empresa.regime_tributario)}</td>
      <td>${badgeSituacao(empresa.situacao)}</td>
      <td>${esc(empresa.cidade)}${empresa.uf ? '/' + esc(empresa.uf) : ''}</td>
      <td class="celula-acoes">${celulaAcoes([
        { rotulo: 'Editar', dataset: { editar: empresa.id }, permissao: 'empresas.editar' },
        { rotulo: 'Esteira', dataset: { esteira: empresa.id } },
        { rotulo: 'CND Federal', dataset: { cnds: empresa.id }, permissao: 'empresas.cnd' },
        { rotulo: 'Certificado Digital', dataset: { certificado: empresa.id } },
        { rotulo: 'Documentos', dataset: { documentos: empresa.id } },
        { rotulo: 'Área do Cliente', dataset: { portal: empresa.id }, permissao: 'empresas.area_cliente' },
        'separador',
        ...(ehAdministrador && empresa.situacao !== 'saiu_escritorio'
          ? [{ rotulo: 'Registrar saída do escritório', dataset: { saida: empresa.id }, perigo: true }]
          : []),
        { rotulo: 'Excluir', dataset: { excluir: empresa.id }, perigo: true, permissao: 'empresas.excluir' }
      ])}</td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('[data-saida]').forEach((btn) => {
    const empresa = resultado.dados.find((e) => e.id === btn.dataset.saida);
    btn.addEventListener('click', () => abrirModalSaida(empresa));
  });

  tbody.querySelectorAll('[data-esteira]').forEach((btn) => {
    btn.addEventListener('click', () => abrirModalEsteira(btn.dataset.esteira));
  });

  tbody.querySelectorAll('[data-editar]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const empresa = await apiFetch(`/empresas/${btn.dataset.editar}`);
      abrirModal(empresa);
    });
  });

  tbody.querySelectorAll('[data-cnds]').forEach((btn) => {
    btn.addEventListener('click', () => abrirModalCnds(btn.dataset.cnds));
  });

  tbody.querySelectorAll('[data-portal]').forEach((btn) => {
    btn.addEventListener('click', () => abrirModalPortal(btn.dataset.portal));
  });

  tbody.querySelectorAll('[data-certificado]').forEach((btn) => {
    btn.addEventListener('click', () => abrirModalCertificado(btn.dataset.certificado));
  });

  tbody.querySelectorAll('[data-documentos]').forEach((btn) => {
    btn.addEventListener('click', () => abrirModalDocumentos(btn.dataset.documentos));
  });

  tbody.querySelectorAll('[data-excluir]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!(await confirmarAcao('Tem certeza que deseja excluir esta empresa? Esta ação não pode ser desfeita.'))) return;
      try {
        await apiFetch(`/empresas/${btn.dataset.excluir}`, { method: 'DELETE' });
        carregarEmpresas();
      } catch (err) {
        notificar(err.message, 'erro');
      }
    });
  });
}

function atualizarControlesPagina(total) {
  const totalPaginas = Math.max(1, Math.ceil(total / LIMITE));
  document.getElementById('info-pagina').textContent = `Página ${paginaAtual} de ${totalPaginas} (${total} ao todo)`;
  document.getElementById('btn-pagina-anterior').disabled = paginaAtual <= 1;
  document.getElementById('btn-proxima-pagina').disabled = paginaAtual >= totalPaginas;
}

document.getElementById('btn-pagina-anterior').addEventListener('click', () => {
  if (paginaAtual > 1) { paginaAtual--; carregarEmpresas(); }
});
document.getElementById('btn-proxima-pagina').addEventListener('click', () => {
  paginaAtual++; carregarEmpresas();
});

document.getElementById('btn-filtrar').addEventListener('click', () => {
  paginaAtual = 1;
  carregarEmpresas();
});

// Filtros vindos pela URL: busca global (?busca=...) e atalhos do dashboard (?situacao=...)
const paramsDaUrl = new URLSearchParams(window.location.search);
if (paramsDaUrl.get('busca')) {
  document.getElementById('filtro-busca').value = paramsDaUrl.get('busca');
}
if (paramsDaUrl.get('situacao')) {
  document.getElementById('filtro-situacao').value = paramsDaUrl.get('situacao');
}

carregarEmpresas();

// --- Exportar para Excel (com os filtros da tela) ---
document.getElementById('btn-exportar').addEventListener('click', async () => {
  try {
    const params = new URLSearchParams({ pagina: 1, limite: 5000 });
    const busca = document.getElementById('filtro-busca').value;
    const situacao = document.getElementById('filtro-situacao').value;
    if (busca) params.append('busca', busca);
    if (situacao) params.append('situacao', situacao);
    const r = await apiFetch(`/empresas?${params.toString()}`);
    const linhas = r ? r.dados : [];
    if (!linhas.length) { notificar('Nenhuma empresa para exportar com esse filtro.', 'info'); return; }
    const situacoes = { ativa: 'Ativa', suspensa: 'Suspensa', baixada: 'Baixada', em_legalizacao: 'Em legalização', saiu_escritorio: 'Saiu do escritório' };
    exportarExcel('empresas', [
      { titulo: 'Razão social', valor: (e) => e.razao_social },
      { titulo: 'Nome fantasia', valor: (e) => e.nome_fantasia },
      { titulo: 'CNPJ', valor: (e) => e.cnpj },
      { titulo: 'Regime', valor: (e) => ROTULOS_REGIME[e.regime_tributario] || e.regime_tributario },
      { titulo: 'Situação', valor: (e) => situacoes[e.situacao] || e.situacao },
      { titulo: 'Cidade', valor: (e) => e.cidade },
      { titulo: 'UF', valor: (e) => e.uf },
      { titulo: 'Telefone', valor: (e) => e.telefone },
      { titulo: 'E-mail', valor: (e) => e.email },
      { titulo: 'Inscrição estadual', valor: (e) => e.inscricao_estadual },
      { titulo: 'Inscrição municipal', valor: (e) => e.inscricao_municipal },
      { titulo: 'Abertura', valor: (e) => formatarDataBR(e.data_abertura) }
    ], linhas);
  } catch (err) {
    notificar(err.message, 'erro');
  }
});

// --- Documentos vinculados à empresa ---
const modalDocumentos = document.getElementById('modal-documentos');
const formUpload = document.getElementById('form-upload-documento');
const erroUpload = document.getElementById('erro-upload');
let empresaIdDocumentosAberta = null;

const RÓTULOS_CATEGORIA = {
  cartao_cnpj: 'Cartão CNPJ',
  contrato_social: 'Contrato Social',
  certidao: 'Certidão',
  alvara: 'Alvará',
  certificado_digital: 'Certificado Digital',
  guia: 'Guia',
  comprovante: 'Comprovante',
  documento_pessoal: 'Documento Pessoal',
  outro: 'Outro'
};

function formatarTamanho(bytes) {
  if (!bytes) return '';
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/** Ordena a lista de documentos conforme o seletor (a escolha fica lembrada). */
function ordenarDocumentos(documentos) {
  const ordem = document.getElementById('ordem-documentos').value;
  const texto = (v) => String(v || '').toLocaleLowerCase('pt-BR');
  const lista = [...documentos];
  if (ordem === 'nome') lista.sort((a, b) => texto(a.nome_original).localeCompare(texto(b.nome_original), 'pt-BR'));
  if (ordem === 'categoria') {
    lista.sort((a, b) => texto(RÓTULOS_CATEGORIA[a.categoria] || a.categoria).localeCompare(texto(RÓTULOS_CATEGORIA[b.categoria] || b.categoria), 'pt-BR')
      || texto(a.nome_original).localeCompare(texto(b.nome_original), 'pt-BR'));
  }
  return lista; // "recentes": já vem do servidor do mais novo para o mais antigo
}

async function carregarDocumentos(empresaId) {
  const recebidos = await apiFetch(`/documentos?empresa_id=${empresaId}`);
  const lista = document.getElementById('lista-documentos');

  if (!recebidos || recebidos.length === 0) {
    lista.innerHTML = '<p style="color:var(--color-text-muted);">Nenhum documento enviado ainda.</p>';
    return;
  }
  const documentos = ordenarDocumentos(recebidos);

  lista.innerHTML = documentos.map((doc) => `
    <div class="item-documento">
      <div>
        <strong>${esc(doc.nome_original)}</strong>
        <div class="meta">
          ${RÓTULOS_CATEGORIA[doc.categoria] || doc.categoria} • ${formatarTamanho(doc.tamanho_bytes)}
          ${doc.enviado_por_nome ? '• enviado por ' + esc(doc.enviado_por_nome) : ''}
          ${!doc.enviado_por
            ? '• enviado pelo cliente' + (doc.enviado_por_cliente_nome || doc.enviado_por_cliente_email
              ? ' (' + esc(doc.enviado_por_cliente_nome || doc.enviado_por_cliente_email) + ')' : '')
            : ''}
        </div>
        ${doc.descricao ? `<div class="meta">${esc(doc.descricao)}</div>` : ''}
        <div class="meta">${doc.visivel_cliente
          ? '<span class="badge badge-valida">Cliente vê</span>'
          : '<span class="badge badge-emissao_pendente">Só o escritório vê</span>'}</div>
      </div>
      <div>
        <button class="link-acao" data-visibilidade="${doc.id}" data-visivel="${doc.visivel_cliente ? '1' : ''}">${doc.visivel_cliente ? 'Ocultar do cliente' : 'Mostrar ao cliente'}</button>
        <button class="link-acao" data-baixar="${doc.id}">Baixar</button>
        <button class="link-acao" data-excluir-doc="${doc.id}">Excluir</button>
      </div>
    </div>
  `).join('');

  lista.querySelectorAll('[data-baixar]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const token = getToken();
      // Download autenticado: usamos fetch + blob para poder enviar o header Authorization
      fetch(`/api/documentos/${btn.dataset.baixar}/download`, {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then((r) => r.blob())
        .then((blob) => {
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = '';
          a.click();
          window.URL.revokeObjectURL(url);
        });
    });
  });

  lista.querySelectorAll('[data-visibilidade]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await apiFetch(`/documentos/${btn.dataset.visibilidade}/visibilidade-cliente`, {
          method: 'PATCH',
          body: { visivel_cliente: !btn.dataset.visivel }
        });
        notificar(btn.dataset.visivel ? 'Documento oculto da Área do Cliente.' : 'Documento visível na Área do Cliente.', 'sucesso');
        carregarDocumentos(empresaIdDocumentosAberta);
      } catch (err) {
        notificar(err.message, 'erro');
      }
    });
  });

  lista.querySelectorAll('[data-excluir-doc]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!(await confirmarAcao('Excluir este documento? Esta ação não pode ser desfeita.'))) return;
      try {
        await apiFetch(`/documentos/${btn.dataset.excluirDoc}`, { method: 'DELETE' });
        carregarDocumentos(empresaIdDocumentosAberta);
      } catch (err) {
        notificar(err.message, 'erro');
      }
    });
  });
}

(function lembrarOrdemDocumentos() {
  const seletor = document.getElementById('ordem-documentos');
  try { seletor.value = localStorage.getItem('ordem_documentos') || 'recentes'; } catch (e) { /* sem armazenamento */ }
  seletor.addEventListener('change', () => {
    try { localStorage.setItem('ordem_documentos', seletor.value); } catch (e) { /* sem armazenamento */ }
    if (empresaIdDocumentosAberta) carregarDocumentos(empresaIdDocumentosAberta);
  });
})();

function abrirModalDocumentos(empresaId) {
  empresaIdDocumentosAberta = empresaId;
  erroUpload.textContent = '';
  document.getElementById('ok-upload').style.display = 'none';
  formUpload.reset();
  document.getElementById('campo-descricao-documento').style.display = 'none';
  sugerirVisibilidadeCliente();
  carregarDocumentos(empresaId);
  modalDocumentos.classList.add('aberto');
}

document.getElementById('btn-fechar-documentos').addEventListener('click', () => {
  modalDocumentos.classList.remove('aberto');
});

// Documentos "da empresa" já nascem visíveis para o cliente; os internos
// (comprovantes, documentos pessoais, outros) nascem ocultos.
const CATEGORIAS_VISIVEIS_POR_PADRAO = ['cartao_cnpj', 'contrato_social', 'certidao', 'alvara', 'certificado_digital', 'guia'];

function sugerirVisibilidadeCliente() {
  const categoria = document.getElementById('categoria-documento').value;
  document.getElementById('visivel-cliente-documento').checked = CATEGORIAS_VISIVEIS_POR_PADRAO.includes(categoria);
  // Guia já sai marcada para ir por e-mail; o resto o usuário decide
  document.getElementById('email-cliente-documento').checked = categoria === 'guia';
  ajustarEnvioEmail();
}

// Só dá para mandar por e-mail o que o cliente pode ver
function ajustarEnvioEmail() {
  const visivel = document.getElementById('visivel-cliente-documento').checked;
  const email = document.getElementById('email-cliente-documento');
  email.disabled = !visivel;
  if (!visivel) email.checked = false;
}
document.getElementById('visivel-cliente-documento').addEventListener('change', ajustarEnvioEmail);

document.getElementById('categoria-documento').addEventListener('change', (e) => {
  document.getElementById('campo-descricao-documento').style.display =
    e.target.value === 'outro' ? 'block' : 'none';
  sugerirVisibilidadeCliente();
});

formUpload.addEventListener('submit', async (e) => {
  e.preventDefault();
  erroUpload.textContent = '';
  const okUpload = document.getElementById('ok-upload');
  okUpload.style.display = 'none';

  const arquivo = document.getElementById('arquivo-documento').files[0];
  if (!arquivo) {
    erroUpload.textContent = 'Selecione um arquivo.';
    return;
  }

  const categoria = document.getElementById('categoria-documento').value;
  const descricao = document.getElementById('descricao-documento').value;

  if (!categoria) {
    erroUpload.textContent = 'Escolha a categoria do documento.';
    return;
  }
  if (categoria === 'outro' && !descricao.trim()) {
    erroUpload.textContent = 'Descreva do que se trata o documento.';
    return;
  }

  const formData = new FormData();
  formData.append('arquivo', arquivo);
  formData.append('empresa_id', empresaIdDocumentosAberta);
  formData.append('categoria', categoria);
  if (categoria === 'outro') formData.append('descricao', descricao);
  formData.append('visivel_cliente', document.getElementById('visivel-cliente-documento').checked ? 'true' : 'false');
  formData.append('enviar_email', document.getElementById('email-cliente-documento').checked ? 'true' : 'false');

  try {
    const documento = await apiFetch('/documentos', { method: 'POST', body: formData });
    const avisos = {
      na_fila: `Documento enviado. O e-mail está saindo para: ${(documento.email_destinatarios || []).join(', ')}.`,
      sem_email: 'Documento enviado, mas o e-mail NÃO saiu: esta empresa não tem e-mail cadastrado nem cliente com acesso.'
    };
    okUpload.textContent = avisos[documento.email_status] || 'Documento enviado.';
    okUpload.style.color = documento.email_status === 'sem_email' ? 'var(--color-carmine)' : '';
    okUpload.style.display = 'block';
    formUpload.reset();
    document.getElementById('campo-descricao-documento').style.display = 'none';
    sugerirVisibilidadeCliente();
    carregarDocumentos(empresaIdDocumentosAberta);
  } catch (err) {
    erroUpload.textContent = err.message;
  }
});

// --- CND Federal (API do SERPRO) ---
// Só consulta quando alguém clica: cada consulta é cobrada pelo SERPRO.
const modalCnds = document.getElementById('modal-cnds');
let empresaIdCndsAberta = null;

const RÓTULOS_STATUS_CND = {
  valida: 'Regular',
  a_vencer: 'Vence em breve',
  vencida: 'Com pendência',
  emissao_pendente: 'Ainda não consultada'
};

const dataCnd = (v) => (v ? new Date(String(v).substring(0, 10) + 'T00:00:00').toLocaleDateString('pt-BR') : '—');

function abrirPdfAutenticado(id) {
  fetch(`/api/documentos/${id}/download`, { headers: { Authorization: `Bearer ${getToken()}` } })
    .then((r) => { if (!r.ok) throw new Error('Não foi possível abrir o PDF.'); return r.blob(); })
    .then((blob) => {
      const url = window.URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => window.URL.revokeObjectURL(url), 60000);
    })
    .catch((err) => notificar(err.message, 'erro'));
}

function mostrarCndFederal({ certidao, documento, configurado, situacao, mensagem }) {
  const badge = document.getElementById('cnd-badge');
  const resultado = document.getElementById('cnd-resultado');
  const status = certidao ? certidao.status : 'emissao_pendente';
  badge.className = `badge badge-${status}`;
  badge.textContent = RÓTULOS_STATUS_CND[status] || status;

  let html;
  if (!certidao) {
    html = '<p>Ainda não foi consultada pelo sistema.</p>';
  } else if (status === 'vencida' && situacao !== 'regular' && !certidao.data_validade) {
    html = `<p><strong>${esc(mensagem || 'Certidão não emitida: há pendências na Receita Federal ou na PGFN.')}</strong></p>
      <p>Confira o Relatório de Situação Fiscal no e-CAC.</p>`;
  } else {
    html = `<dl class="cnd-dados">
      <div><dt>Emitida em</dt><dd>${dataCnd(certidao.data_emissao)}</dd></div>
      <div><dt>Válida até</dt><dd>${dataCnd(certidao.data_validade)}</dd></div>
      ${certidao.numero_certidao ? `<div><dt>Código de controle</dt><dd>${esc(certidao.numero_certidao)}</dd></div>` : ''}
    </dl>`;
  }
  if (certidao && certidao.observacoes) html += `<p class="cnd-obs">${esc(certidao.observacoes)}</p>`;
  resultado.innerHTML = html;

  const btnPdf = document.getElementById('cnd-pdf');
  btnPdf.style.display = documento ? '' : 'none';
  btnPdf.onclick = documento ? () => abrirPdfAutenticado(documento.id) : null;

  document.getElementById('cnd-buscar').disabled = !configurado;
  document.getElementById('cnd-nao-configurado').style.display = configurado ? 'none' : '';
}

// --- Situação fiscal (SITFIS) pelo Integra Contador ---
const RÓTULOS_SITFIS = { regular: ['badge-valida', 'Sem pendências'], pendencia: ['badge-vencida', 'Com pendências'], indefinida: ['badge-a_vencer', 'Conferir o relatório'] };

function mostrarSituacaoFiscal(integra) {
  const cartao = document.getElementById('sitfis-cartao');
  if (!integra || !integra.configurado) { cartao.style.display = 'none'; return; }
  cartao.style.display = '';
  const ultima = integra.ultima;
  const badge = document.getElementById('sitfis-badge');
  const [classe, rotulo] = ultima ? RÓTULOS_SITFIS[ultima.situacao] || RÓTULOS_SITFIS.indefinida : ['badge-emissao_pendente', 'Ainda não consultada'];
  badge.className = `badge ${classe}`;
  badge.textContent = rotulo;

  let html = '<p>Ainda não foi consultada pelo sistema.</p>';
  if (ultima) {
    const r = ultima.resumo || {};
    const itens = [];
    if (r.certidao) itens.push(`<div><dt>Certidão emitida</dt><dd>${esc(r.certidao.tipo.replace('Certidão ', ''))}<br>válida até ${dataCnd(r.certidao.validade)}</dd></div>`);
    itens.push(`<div><dt>Receita Federal</dt><dd>${r.pendencias && r.pendencias.length ? `<strong>${r.pendencias.map(esc).join('<br>')}</strong>` : 'Sem pendências'}${r.suspensos && r.suspensos.length ? `<br><span class="cnd-obs">${r.suspensos.map(esc).join('<br>')} (não impede a certidão)</span>` : ''}</dd></div>`);
    itens.push(`<div><dt>PGFN</dt><dd>${r.pgfnSemPendencias ? 'Sem pendências' : 'Ver o relatório'}</dd></div>`);
    html = `<dl class="cnd-dados">${itens.join('')}</dl><p class="cnd-obs">Consultado em ${new Date(ultima.criado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}.</p>`;
  }
  document.getElementById('sitfis-resultado').innerHTML = html;
  const btnPdf = document.getElementById('sitfis-pdf');
  btnPdf.style.display = ultima && ultima.documento_id ? '' : 'none';
  btnPdf.onclick = ultima && ultima.documento_id ? () => abrirPdfAutenticado(ultima.documento_id) : null;
}

async function buscarSituacaoFiscal() {
  const btn = document.getElementById('sitfis-buscar');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Pedindo o relatório à Receita…';
  document.getElementById('sitfis-resultado').innerHTML = '<p>Pode levar até um minuto.</p>';
  try {
    const dados = await apiFetch(`/empresas/${empresaIdCndsAberta}/situacao-fiscal`, { method: 'POST' });
    mostrarSituacaoFiscal(dados.integra);
    if (dados.certidao) mostrarCndFederal({ certidao: dados.certidao, documento: dados.documento, configurado: !document.getElementById('cnd-buscar').disabled });
    notificar(dados.integra.ultima.situacao === 'pendencia' ? 'Relatório pronto: há pendências.' : 'Relatório pronto. O PDF foi salvo nos documentos da empresa.', dados.integra.ultima.situacao === 'pendencia' ? 'erro' : 'sucesso');
  } catch (err) {
    document.getElementById('sitfis-resultado').innerHTML = `<p class="cnd-erro">${esc(err.message)}</p>`;
    notificar(err.message, 'erro');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Ver situação fiscal';
  }
}

document.getElementById('sitfis-buscar').addEventListener('click', buscarSituacaoFiscal);

async function buscarCndFederal() {
  const btn = document.getElementById('cnd-buscar');
  const resultado = document.getElementById('cnd-resultado');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Consultando Receita / PGFN…';
  resultado.innerHTML = '<p>Pode levar alguns segundos.</p>';
  try {
    const dados = await apiFetch(`/empresas/${empresaIdCndsAberta}/cnd-federal`, { method: 'POST' });
    mostrarCndFederal({ ...dados, configurado: true });
    if (dados.situacao === 'regular') notificar('CND Federal emitida. O PDF foi salvo nos documentos da empresa.', 'sucesso');
    else notificar('CND Federal não emitida: há pendências para esta empresa.', 'erro');
  } catch (err) {
    resultado.innerHTML = `<p class="cnd-erro">${esc(err.message)}</p>`;
    notificar(err.message, 'erro');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Consultar agora';
  }
}

document.getElementById('cnd-buscar').addEventListener('click', buscarCndFederal);

async function abrirModalCnds(empresaId) {
  empresaIdCndsAberta = empresaId;
  document.getElementById('cnd-resultado').innerHTML = '<p>Carregando…</p>';
  document.getElementById('cnd-pdf').style.display = 'none';
  document.getElementById('sitfis-cartao').style.display = 'none';
  modalCnds.classList.add('aberto');
  try {
    // Mostra a última consulta guardada (não cobra nada)
    const dados = await apiFetch(`/empresas/${empresaId}/cnd-federal`);
    mostrarCndFederal(dados);
    mostrarSituacaoFiscal(dados.integra);
  } catch (err) {
    document.getElementById('cnd-resultado').innerHTML = `<p class="cnd-erro">${esc(err.message)}</p>`;
  }
}

document.getElementById('btn-fechar-cnds').addEventListener('click', () => {
  modalCnds.classList.remove('aberto');
});

// --- Área do Cliente (logins dos clientes com acesso a esta empresa) ---
const modalPortal = document.getElementById('modal-portal');
const formAcessoCliente = document.getElementById('form-acesso-cliente');
let empresaPortalAberta = null;

function descreverEnvio(envio) {
  const canais = [];
  if (envio && envio.email) canais.push('e-mail');
  if (envio && envio.whatsapp) canais.push('WhatsApp');
  return canais.length
    ? `Enviado por ${canais.join(' e ')}.`
    : 'Não foi possível enviar automaticamente (e-mail/WhatsApp não configurados ou sem telefone).';
}

function mostrarLinkConvite(link, envio, nome) {
  const box = document.getElementById('link-convite-box');
  if (!link) { box.style.display = 'none'; return; }
  document.getElementById('link-convite-texto').textContent =
    `Link para ${nome} criar a senha (válido por 7 dias). ${descreverEnvio(envio)} Se precisar, copie e mande pelo WhatsApp do escritório:`;
  document.getElementById('link-convite').value = link;
  box.style.display = 'block';
}

document.getElementById('btn-copiar-convite').addEventListener('click', async () => {
  const campo = document.getElementById('link-convite');
  try {
    await navigator.clipboard.writeText(campo.value);
  } catch (e) {
    campo.select();
    document.execCommand('copy');
  }
  notificar('Link copiado.', 'sucesso');
});

async function carregarAcessosCliente() {
  const dados = await apiFetch(`/empresas/${empresaPortalAberta.id}/acessos-cliente`);
  if (!dados) return;
  const lista = document.getElementById('lista-acessos-cliente');

  if (!dados.acessos.length) {
    lista.innerHTML = '<p style="color:var(--color-text-muted); font-size:var(--text-sm);">Nenhum cliente com acesso ainda.</p>';
  } else {
    lista.innerHTML = dados.acessos.map((c) => `
      <div class="item-documento">
        <div>
          <strong>${esc(c.nome || c.email)}</strong>
          <div class="meta">${esc(c.email)}${c.telefone ? ' • ' + esc(c.telefone) : ''}</div>
          <div class="meta">
            ${c.senha_definida
              ? `<span class="badge badge-valida">Senha criada</span> ${c.ultimo_login ? '• último acesso em ' + new Date(c.ultimo_login).toLocaleString('pt-BR') : '• ainda não entrou'}`
              : '<span class="badge badge-a_vencer">Aguardando criar a senha</span>'}
          </div>
        </div>
        <div>
          <button class="link-acao" data-reenviar-acesso="${c.id}">${c.senha_definida ? 'Enviar link de nova senha' : 'Reenviar convite'}</button>
          <button class="link-acao" data-remover-acesso="${c.id}">Remover acesso</button>
        </div>
      </div>
    `).join('');
  }

  lista.querySelectorAll('[data-reenviar-acesso]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const cliente = dados.acessos.find((c) => c.id === btn.dataset.reenviarAcesso);
      try {
        const r = await apiFetch(`/empresas/${empresaPortalAberta.id}/acessos-cliente/${cliente.id}/reenviar`, { method: 'POST' });
        mostrarLinkConvite(r.link, r.envio, cliente.nome || cliente.email);
        notificar('Novo link gerado.', 'sucesso');
      } catch (err) {
        notificar(err.message, 'erro');
      }
    });
  });

  lista.querySelectorAll('[data-remover-acesso]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!(await confirmarAcao('Remover o acesso desta pessoa aos dados desta empresa? Ela deixa de ver tudo na hora.', 'Remover'))) return;
      try {
        await apiFetch(`/empresas/${empresaPortalAberta.id}/acessos-cliente/${btn.dataset.removerAcesso}`, { method: 'DELETE' });
        notificar('Acesso removido.', 'sucesso');
        carregarAcessosCliente();
      } catch (err) {
        notificar(err.message, 'erro');
      }
    });
  });

  document.getElementById('lista-downloads-cliente').innerHTML = dados.downloads.length
    ? dados.downloads.map((d) => `
      <div class="item-documento">
        <div>
          <strong>${esc(d.documento_nome || 'Documento excluído')}</strong>
          <div class="meta">${esc(d.cliente_nome || d.cliente_email || d.email_destinatario || 'Cliente removido')} • ${d.origem === 'email' ? 'pelo e-mail' : 'pela Área do Cliente'} • ${new Date(d.criado_em).toLocaleString('pt-BR')}</div>
        </div>
      </div>`).join('')
    : '<p style="color:var(--color-text-muted); font-size:var(--text-sm);">Nenhum download ainda.</p>';
}

async function abrirModalPortal(empresaId) {
  try {
    empresaPortalAberta = await apiFetch(`/empresas/${empresaId}`);
  } catch (err) {
    notificar(err.message, 'erro');
    return;
  }
  formAcessoCliente.reset();
  document.getElementById('erro-acesso-cliente').textContent = '';
  document.getElementById('link-convite-box').style.display = 'none';
  document.getElementById('portal-nome-empresa').textContent = empresaPortalAberta.razao_social;
  // Sugere o contato principal da empresa (o mesmo que recebe as guias)
  document.getElementById('acesso-email').value = empresaPortalAberta.email || '';
  document.getElementById('acesso-telefone').value = empresaPortalAberta.telefone || '';
  modalPortal.classList.add('aberto');
  carregarAcessosCliente().catch((err) => notificar(err.message, 'erro'));
}

document.getElementById('btn-fechar-portal').addEventListener('click', () => {
  modalPortal.classList.remove('aberto');
});

formAcessoCliente.addEventListener('submit', async (e) => {
  e.preventDefault();
  const erroEl = document.getElementById('erro-acesso-cliente');
  const btn = document.getElementById('btn-liberar-acesso');
  erroEl.textContent = '';
  btn.disabled = true;
  try {
    const r = await apiFetch(`/empresas/${empresaPortalAberta.id}/acessos-cliente`, {
      method: 'POST',
      body: {
        email: document.getElementById('acesso-email').value.trim(),
        nome: document.getElementById('acesso-nome').value.trim(),
        telefone: document.getElementById('acesso-telefone').value.trim()
      }
    });
    if (r.ja_tinha_senha) {
      document.getElementById('link-convite-box').style.display = 'none';
      notificar(`Empresa adicionada ao login de ${r.cliente.email}. ${descreverEnvio(r.envio)}`, 'sucesso');
    } else {
      mostrarLinkConvite(r.link, r.envio, r.cliente.nome || r.cliente.email);
      notificar('Acesso liberado.', 'sucesso');
    }
    formAcessoCliente.reset();
    carregarAcessosCliente();
  } catch (err) {
    erroEl.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

// --- Certificado Digital ---
const modalCertificado = document.getElementById('modal-certificado');
const formCertificado = document.getElementById('form-certificado');
const erroCertificado = document.getElementById('erro-certificado');
let empresaIdCertificadoAberta = null;

const RÓTULOS_TIPO_CERTIFICADO = { 'e-cnpj': 'e-CNPJ', 'e-cpf': 'e-CPF', outro: 'Outro' };
const RÓTULOS_STATUS_CERTIFICADO = {
  valida: 'Válido', a_vencer: 'A vencer', vencida: 'Vencido', emissao_pendente: 'Sem data cadastrada'
};

function formatarDataCertificado(dataIso) {
  if (!dataIso) return '—';
  const [ano, mes, dia] = dataIso.substring(0, 10).split('-');
  return `${dia}/${mes}/${ano}`;
}

async function carregarCertificados() {
  const certificados = await apiFetch(`/certificados-digitais/empresa/${empresaIdCertificadoAberta}`);
  const lista = document.getElementById('lista-certificados');

  if (!certificados || certificados.length === 0) {
    lista.innerHTML = '<p style="color:var(--color-text-muted); font-size:var(--text-sm);">Nenhum certificado cadastrado ainda.</p>';
    return;
  }

  lista.innerHTML = certificados.map((c) => `
    <div class="item-etapa">
      <span class="nome-etapa">
        <span class="badge badge-${c.status}">${RÓTULOS_STATUS_CERTIFICADO[c.status] || c.status}</span>
        &nbsp;${RÓTULOS_TIPO_CERTIFICADO[c.tipo] || c.tipo} — válido até ${formatarDataCertificado(c.data_validade)}
      </span>
      <button type="button" class="remover-etapa" data-editar-certificado="${c.id}">Editar</button>
      <button type="button" class="remover-etapa" data-remover-certificado="${c.id}">Remover</button>
    </div>
  `).join('');

  lista.querySelectorAll('[data-editar-certificado]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const c = certificados.find((x) => x.id === btn.dataset.editarCertificado);
      document.getElementById('certificado-id').value = c.id;
      document.getElementById('certificado-tipo').value = c.tipo;
      document.getElementById('certificado-serie').value = c.numero_serie || '';
      document.getElementById('certificado-emissao').value = c.data_emissao ? c.data_emissao.substring(0, 10) : '';
      document.getElementById('certificado-validade').value = c.data_validade ? c.data_validade.substring(0, 10) : '';
      document.getElementById('certificado-observacoes').value = c.observacoes || '';
    });
  });

  lista.querySelectorAll('[data-remover-certificado]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!(await confirmarAcao('Remover este certificado digital?', 'Remover'))) return;
      try {
        await apiFetch(`/certificados-digitais/${btn.dataset.removerCertificado}`, { method: 'DELETE' });
        carregarCertificados();
      } catch (err) {
        notificar(err.message, 'erro');
      }
    });
  });
}

function abrirModalCertificado(empresaId) {
  empresaIdCertificadoAberta = empresaId;
  erroCertificado.textContent = '';
  formCertificado.reset();
  document.getElementById('certificado-id').value = '';
  carregarCertificados();
  modalCertificado.classList.add('aberto');
}

document.getElementById('btn-fechar-certificado').addEventListener('click', () => {
  modalCertificado.classList.remove('aberto');
});

formCertificado.addEventListener('submit', async (e) => {
  e.preventDefault();
  erroCertificado.textContent = '';

  const id = document.getElementById('certificado-id').value;
  const corpo = {
    empresa_id: empresaIdCertificadoAberta,
    tipo: document.getElementById('certificado-tipo').value,
    numero_serie: document.getElementById('certificado-serie').value,
    data_emissao: document.getElementById('certificado-emissao').value || null,
    data_validade: document.getElementById('certificado-validade').value || null,
    observacoes: document.getElementById('certificado-observacoes').value
  };

  try {
    if (id) {
      await apiFetch(`/certificados-digitais/${id}`, { method: 'PUT', body: corpo });
    } else {
      await apiFetch('/certificados-digitais', { method: 'POST', body: corpo });
    }
    formCertificado.reset();
    document.getElementById('certificado-id').value = '';
    notificar('Certificado digital salvo.', 'sucesso');
    carregarCertificados();
  } catch (err) {
    erroCertificado.textContent = err.message;
  }
});

// ===== Esteira de integração de empresa nova =====
const ROTULOS_ESTAGIO_ESTEIRA = {
  legalizacao: 'Legalização',
  cadastro_dominio: 'Cadastro no Domínio',
  fechamento_setorial: 'Fechamento setorial'
};

const modalEsteira = document.getElementById('modal-esteira');
const esteiraConteudo = document.getElementById('esteira-conteudo');
const btnAvancarEsteira = document.getElementById('btn-avancar-esteira');
let empresaEsteiraAtual = null;

async function abrirModalEsteira(empresaId) {
  empresaEsteiraAtual = empresaId;
  esteiraConteudo.innerHTML = '<p>Carregando…</p>';
  btnAvancarEsteira.style.display = 'none';
  modalEsteira.classList.add('aberto');

  try {
    const dados = await apiFetch(`/onboarding/${empresaId}`);
    renderizarEsteira(dados);
  } catch (err) {
    esteiraConteudo.innerHTML = `<p class="erro-msg">${esc(err.message)}</p>`;
  }
}

function renderizarEsteira(dados) {
  const usuario = getUsuario();

  if (!dados.estagio) {
    esteiraConteudo.innerHTML = `<p>${esc(dados.mensagem)}</p>`;
    return;
  }

  const responsaveisAtuais = (dados.responsaveis_estagio_atual || [])
    .map((r) => `${esc(r.nome)}${r.setor ? ` (${esc(r.setor)})` : ''}`)
    .join(', ');

  const historicoHtml = (dados.historico || []).map((h) => `
    <li>${ROTULOS_ESTAGIO_ESTEIRA[h.estagio] || h.estagio} — concluído por ${esc(h.concluido_por_nome) || '—'}
      em ${new Date(h.criado_em).toLocaleString('pt-BR')}</li>
  `).join('');

  esteiraConteudo.innerHTML = `
    <p><strong>Estágio atual:</strong> ${ROTULOS_ESTAGIO_ESTEIRA[dados.estagio] || dados.estagio}</p>
    <p><strong>Responsável(is) agora:</strong> ${responsaveisAtuais || '—'}</p>
    ${historicoHtml ? `<p style="margin-top:var(--space-4);"><strong>Histórico:</strong></p><ul>${historicoHtml}</ul>` : ''}
  `;

  const souResponsavel = usuario && (
    usuario.role === 'administrador' ||
    (dados.responsaveis_estagio_atual || []).some(
      (r) => r.email && r.email.toLowerCase() === usuario.email.toLowerCase()
    )
  );
  const temProximoEstagio = !!dados.estagio && ROTULOS_ESTAGIO_ESTEIRA[dados.estagio] &&
    dados.estagio !== 'fechamento_setorial';

  btnAvancarEsteira.style.display = souResponsavel && temProximoEstagio ? 'inline-flex' : 'none';
}

btnAvancarEsteira.addEventListener('click', async () => {
  if (!empresaEsteiraAtual) return;
  try {
    await apiFetch(`/onboarding/${empresaEsteiraAtual}/avancar`, { method: 'POST' });
    notificar('Etapa concluída — próximo responsável foi avisado.', 'sucesso');
    const dados = await apiFetch(`/onboarding/${empresaEsteiraAtual}`);
    renderizarEsteira(dados);
  } catch (err) {
    notificar(err.message, 'erro');
  }
});

document.getElementById('btn-fechar-esteira').addEventListener('click', () => {
  modalEsteira.classList.remove('aberto');
});

// ===== Atalhos vindos da ficha da empresa (?abrir=...&id=...) =====
(async function abrirPelaUrl() {
  const params = new URLSearchParams(window.location.search);
  const acao = params.get('abrir');
  const id = params.get('id');
  if (!acao || !id) return;
  history.replaceState(null, '', window.location.pathname);
  try {
    if (acao === 'editar') abrirModal(await apiFetch(`/empresas/${encodeURIComponent(id)}`));
    else if (acao === 'documentos') abrirModalDocumentos(id);
    else if (acao === 'portal') abrirModalPortal(id);
    else if (acao === 'certificado') abrirModalCertificado(id);
    else if (acao === 'cnds') abrirModalCnds(id);
  } catch (err) {
    notificar(err.message, 'erro');
  }
})();
