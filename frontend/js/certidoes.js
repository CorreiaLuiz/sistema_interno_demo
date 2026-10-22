exigirLogin();
inicializarShell();

const RÓTULOS_STATUS = {
  valida: 'Válida',
  a_vencer: 'A vencer',
  vencida: 'Vencida',
  emissao_pendente: 'Emissão pendente'
};

const RÓTULOS_TIPO = {
  federal: 'Federal',
  estadual: 'Estadual',
  municipal: 'Municipal',
  trabalhista: 'Trabalhista',
  fgts: 'FGTS',
  outra: 'Outra'
};

function badgeStatus(status) {
  return `<span class="badge badge-${status}">${RÓTULOS_STATUS[status] || status}</span>`;
}

function formatarData(dataIso) {
  if (!dataIso) return '—';
  const [ano, mes, dia] = dataIso.substring(0, 10).split('-');
  return `${dia}/${mes}/${ano}`;
}

// --- Carregar lista de empresas para o <select> do formulário ---
let listaEmpresas = [];

async function carregarEmpresasNoSelect() {
  const resultado = await apiFetch('/empresas?limite=500');
  listaEmpresas = resultado ? resultado.dados : [];
  const select = document.getElementById('empresa_id');
  select.innerHTML = listaEmpresas
    .map((emp) => `<option value="${emp.id}">${esc(emp.razao_social)} — ${esc(emp.cnpj)}</option>`)
    .join('');
}

// --- Resumo de status (cards no topo) ---
async function carregarResumo() {
  const resumo = await apiFetch('/certidoes/resumo/status');
  const container = document.getElementById('resumo-status');
  if (!resumo) return;

  const ordem = ['vencida', 'a_vencer', 'valida', 'emissao_pendente'];
  container.innerHTML = ordem.map((status) => `
    <div class="resumo-card ${status}">
      <span class="numero">${resumo[status] || 0}</span>
      <span class="rotulo">${RÓTULOS_STATUS[status]}</span>
    </div>
  `).join('');
}

// --- Modal de cadastro/edição ---
const modal = document.getElementById('modal-certidao');
const form = document.getElementById('form-certidao');
const erroCertidao = document.getElementById('erro-certidao');

function abrirModal(certidao = null) {
  erroCertidao.textContent = '';
  form.reset();
  document.getElementById('certidao-id').value = '';
  document.getElementById('titulo-modal').textContent = certidao ? 'Editar Certidão' : 'Nova Certidão';

  if (certidao) {
    document.getElementById('certidao-id').value = certidao.id;
    document.getElementById('empresa_id').value = certidao.empresa_id;
    document.getElementById('tipo').value = certidao.tipo;
    document.getElementById('orgao_emissor').value = certidao.orgao_emissor || '';
    document.getElementById('numero_certidao').value = certidao.numero_certidao || '';
    document.getElementById('data_emissao').value = certidao.data_emissao ? certidao.data_emissao.substring(0, 10) : '';
    document.getElementById('data_validade').value = certidao.data_validade ? certidao.data_validade.substring(0, 10) : '';
    document.getElementById('observacoes').value = certidao.observacoes || '';
  }

  modal.classList.add('aberto');
}

function fecharModal() {
  modal.classList.remove('aberto');
}

document.getElementById('btn-nova-certidao').addEventListener('click', () => abrirModal());
document.getElementById('btn-cancelar').addEventListener('click', fecharModal);

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  erroCertidao.textContent = '';

  const id = document.getElementById('certidao-id').value;
  const corpo = {
    empresa_id: document.getElementById('empresa_id').value,
    tipo: document.getElementById('tipo').value,
    orgao_emissor: document.getElementById('orgao_emissor').value,
    numero_certidao: document.getElementById('numero_certidao').value,
    data_emissao: document.getElementById('data_emissao').value || null,
    data_validade: document.getElementById('data_validade').value || null,
    observacoes: document.getElementById('observacoes').value
  };

  try {
    if (id) {
      await apiFetch(`/certidoes/${id}`, { method: 'PUT', body: corpo });
    } else {
      await apiFetch('/certidoes', { method: 'POST', body: corpo });
    }
    fecharModal();
    carregarCertidoes();
    carregarResumo();
  } catch (err) {
    erroCertidao.textContent = err.message;
  }
});

// --- Modal de renovação ---
const modalRenovar = document.getElementById('modal-renovar');
const formRenovar = document.getElementById('form-renovar');
const erroRenovar = document.getElementById('erro-renovar');

function abrirModalRenovar(certidaoId) {
  erroRenovar.textContent = '';
  formRenovar.reset();
  document.getElementById('renovar-certidao-id').value = certidaoId;
  modalRenovar.classList.add('aberto');
}

document.getElementById('btn-cancelar-renovar').addEventListener('click', () => {
  modalRenovar.classList.remove('aberto');
});

formRenovar.addEventListener('submit', async (e) => {
  e.preventDefault();
  erroRenovar.textContent = '';

  const id = document.getElementById('renovar-certidao-id').value;
  const corpo = {
    data_emissao: document.getElementById('renovar_data_emissao').value || null,
    data_validade: document.getElementById('renovar_data_validade').value,
    observacoes: document.getElementById('renovar_observacoes').value
  };

  try {
    await apiFetch(`/certidoes/${id}/renovar`, { method: 'POST', body: corpo });
    modalRenovar.classList.remove('aberto');
    carregarCertidoes();
    carregarResumo();
  } catch (err) {
    erroRenovar.textContent = err.message;
  }
});

// --- Listagem principal ---
let paginaAtual = 1;
const LIMITE = 20;

async function carregarCertidoes() {
  const status = document.getElementById('filtro-status').value;
  const tipo = document.getElementById('filtro-tipo').value;

  const params = new URLSearchParams({ pagina: paginaAtual, limite: LIMITE });
  if (status) params.append('status', status);
  if (tipo) params.append('tipo', tipo);

  const resultado = await apiFetch(`/certidoes?${params.toString()}`);
  const tbody = document.getElementById('tabela-certidoes');
  tbody.innerHTML = '';

  atualizarControlesPagina(resultado ? resultado.total : 0);

  if (!resultado || resultado.dados.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7">Nenhuma certidão encontrada.</td></tr>';
    return;
  }

  resultado.dados.forEach((certidao) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${linkEmpresa(certidao.empresa_id, certidao.razao_social)}</td>
      <td>${RÓTULOS_TIPO[certidao.tipo] || certidao.tipo}</td>
      <td>${certidao.numero_certidao ? `<span class="ledger">${esc(certidao.numero_certidao)}</span>` : '—'}</td>
      <td>${esc(certidao.orgao_emissor) || '—'}</td>
      <td>${formatarData(certidao.data_validade)}</td>
      <td>${badgeStatus(certidao.status)}</td>
      <td class="celula-acoes">${celulaAcoes([
        { rotulo: 'Editar', dataset: { editar: certidao.id }, permissao: 'certidoes.editar' },
        { rotulo: 'Renovar', dataset: { renovar: certidao.id }, permissao: 'certidoes.editar' },
        { rotulo: 'Documentos', dataset: { documentos: certidao.id } },
        'separador',
        { rotulo: 'Excluir', dataset: { excluir: certidao.id }, perigo: true, permissao: 'certidoes.excluir' }
      ])}</td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('[data-editar]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const certidao = await apiFetch(`/certidoes/${btn.dataset.editar}`);
      abrirModal(certidao);
    });
  });

  tbody.querySelectorAll('[data-renovar]').forEach((btn) => {
    btn.addEventListener('click', () => abrirModalRenovar(btn.dataset.renovar));
  });

  tbody.querySelectorAll('[data-documentos]').forEach((btn) => {
    btn.addEventListener('click', () => abrirModalDocumentos(btn.dataset.documentos));
  });

  tbody.querySelectorAll('[data-excluir]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!(await confirmarAcao('Tem certeza que deseja excluir esta certidão? Esta ação não pode ser desfeita.'))) return;
      try {
        await apiFetch(`/certidoes/${btn.dataset.excluir}`, { method: 'DELETE' });
        carregarCertidoes();
        carregarResumo();
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
  if (paginaAtual > 1) { paginaAtual--; carregarCertidoes(); }
});
document.getElementById('btn-proxima-pagina').addEventListener('click', () => {
  paginaAtual++; carregarCertidoes();
});

document.getElementById('btn-filtrar').addEventListener('click', () => {
  paginaAtual = 1;
  carregarCertidoes();
});

// --- Inicialização ---
(async function iniciar() {
  await carregarEmpresasNoSelect();
  await carregarResumo();
  await carregarCertidoes();
})();

// --- Documentos vinculados à certidão ---
const modalDocumentos = document.getElementById('modal-documentos');
const formUpload = document.getElementById('form-upload-documento');
const erroUpload = document.getElementById('erro-upload');
let certidaoIdDocumentosAberta = null;

const RÓTULOS_CATEGORIA = {
  contrato_social: 'Contrato Social',
  certidao: 'Certidão',
  alvara: 'Alvará',
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

async function carregarDocumentos(certidaoId) {
  const documentos = await apiFetch(`/documentos?certidao_id=${certidaoId}`);
  const lista = document.getElementById('lista-documentos');

  if (!documentos || documentos.length === 0) {
    lista.innerHTML = '<p style="color:var(--color-text-muted);">Nenhum documento enviado ainda.</p>';
    return;
  }

  lista.innerHTML = documentos.map((doc) => `
    <div class="item-documento">
      <div>
        <strong>${esc(doc.nome_original)}</strong>
        <div class="meta">
          ${RÓTULOS_CATEGORIA[doc.categoria] || doc.categoria} • ${formatarTamanho(doc.tamanho_bytes)}
          ${doc.enviado_por_nome ? '• enviado por ' + esc(doc.enviado_por_nome) : ''}
        </div>
        ${doc.descricao ? `<div class="meta">${esc(doc.descricao)}</div>` : ''}
      </div>
      <div>
        <button class="link-acao" data-baixar="${doc.id}">Baixar</button>
        <button class="link-acao" data-excluir-doc="${doc.id}">Excluir</button>
      </div>
    </div>
  `).join('');

  lista.querySelectorAll('[data-baixar]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const token = getToken();
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

  lista.querySelectorAll('[data-excluir-doc]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!(await confirmarAcao('Excluir este documento? Esta ação não pode ser desfeita.'))) return;
      try {
        await apiFetch(`/documentos/${btn.dataset.excluirDoc}`, { method: 'DELETE' });
        carregarDocumentos(certidaoIdDocumentosAberta);
      } catch (err) {
        notificar(err.message, 'erro');
      }
    });
  });
}

function abrirModalDocumentos(certidaoId) {
  certidaoIdDocumentosAberta = certidaoId;
  erroUpload.textContent = '';
  formUpload.reset();
  document.getElementById('campo-descricao-documento').style.display = 'none';
  carregarDocumentos(certidaoId);
  modalDocumentos.classList.add('aberto');
}

document.getElementById('btn-fechar-documentos').addEventListener('click', () => {
  modalDocumentos.classList.remove('aberto');
});

document.getElementById('categoria-documento').addEventListener('change', (e) => {
  document.getElementById('campo-descricao-documento').style.display =
    e.target.value === 'outro' ? 'block' : 'none';
});

formUpload.addEventListener('submit', async (e) => {
  e.preventDefault();
  erroUpload.textContent = '';

  const arquivo = document.getElementById('arquivo-documento').files[0];
  if (!arquivo) {
    erroUpload.textContent = 'Selecione um arquivo.';
    return;
  }

  const categoria = document.getElementById('categoria-documento').value;
  const descricao = document.getElementById('descricao-documento').value;

  if (categoria === 'outro' && !descricao.trim()) {
    erroUpload.textContent = 'Descreva do que se trata o documento.';
    return;
  }

  const formData = new FormData();
  formData.append('arquivo', arquivo);
  formData.append('certidao_id', certidaoIdDocumentosAberta);
  formData.append('categoria', categoria);
  if (categoria === 'outro') formData.append('descricao', descricao);

  try {
    await apiFetch('/documentos', { method: 'POST', body: formData });
    formUpload.reset();
    document.getElementById('campo-descricao-documento').style.display = 'none';
    carregarDocumentos(certidaoIdDocumentosAberta);
  } catch (err) {
    erroUpload.textContent = err.message;
  }
});

// --- Exportar para Excel (com os filtros da tela) ---
document.getElementById('btn-exportar').addEventListener('click', async () => {
  try {
    const params = new URLSearchParams({ pagina: 1, limite: 5000 });
    const status = document.getElementById('filtro-status').value;
    const tipo = document.getElementById('filtro-tipo').value;
    if (status) params.append('status', status);
    if (tipo) params.append('tipo', tipo);
    const r = await apiFetch(`/certidoes?${params.toString()}`);
    const linhas = r ? r.dados : [];
    if (!linhas.length) { notificar('Nenhuma certidão para exportar com esse filtro.', 'info'); return; }
    exportarExcel('certidoes', [
      { titulo: 'Empresa', valor: (c) => c.razao_social },
      { titulo: 'CNPJ', valor: (c) => c.cnpj },
      { titulo: 'Tipo', valor: (c) => RÓTULOS_TIPO[c.tipo] || c.tipo },
      { titulo: 'Número', valor: (c) => c.numero_certidao },
      { titulo: 'Órgão emissor', valor: (c) => c.orgao_emissor },
      { titulo: 'Emissão', valor: (c) => formatarDataBR(c.data_emissao) },
      { titulo: 'Validade', valor: (c) => formatarDataBR(c.data_validade) },
      { titulo: 'Status', valor: (c) => RÓTULOS_STATUS[c.status] || c.status }
    ], linhas);
  } catch (err) {
    notificar(err.message, 'erro');
  }
});
