/**
 * Área do Cliente (portal). Depende de cliente-api.js.
 * Estado: a empresa escolhida fica lembrada no navegador; tudo o mais
 * é recarregado do servidor ao trocar de empresa.
 */
if (!tokenCliente()) window.location.replace('/pages/cliente-login.html' + window.location.hash);

const RÓTULOS_STATUS_VALIDADE = {
  valida: 'Regular', a_vencer: 'Vence em breve', vencida: 'Vencida / com pendência', emissao_pendente: 'Aguardando'
};
const RÓTULOS_TIPO_CERTIDAO = {
  federal: 'CND Federal', estadual: 'CND Estadual', municipal: 'CND Municipal',
  trabalhista: 'CND Trabalhista', fgts: 'CRF (FGTS)', outra: 'Outra certidão'
};
const RÓTULOS_TIPO_LICENCA = {
  vigilancia_sanitaria: 'Vigilância Sanitária', bombeiros: 'Bombeiros',
  ambiental: 'Ambiental', funcionamento: 'Alvará de Funcionamento', outra: 'Outra licença'
};
const RÓTULOS_TIPO_CERTIFICADO = { 'e-cnpj': 'e-CNPJ', 'e-cpf': 'e-CPF', outro: 'Certificado' };
const RÓTULOS_TIPO_PROCESSO = { abertura: 'Abertura', alteracao: 'Alteração', baixa: 'Baixa' };
const RÓTULOS_STATUS_PROCESSO = { em_andamento: 'Em andamento', exigencia: 'Em exigência', concluido: 'Concluído', cancelado: 'Cancelado' };
const CLASSE_STATUS_PROCESSO = { em_andamento: 'badge-em_andamento', exigencia: 'badge-exigencia', concluido: 'badge-concluido', cancelado: 'badge-baixada' };
const RÓTULOS_STATUS_PEDIDO = { pendente: 'Recebido', em_andamento: 'Em andamento', concluido: 'Concluído' };
const CLASSE_STATUS_PEDIDO = { pendente: 'badge-pendente', em_andamento: 'badge-em_andamento', concluido: 'badge-concluido' };

const CATEGORIAS_DOCUMENTO = {
  cartao_cnpj: 'Cartão CNPJ',
  contrato_social: 'Contrato Social',
  certidao: 'Certidões',
  alvara: 'Alvarás',
  certificado_digital: 'Certificado Digital',
  guia: 'Guias',
  comprovante: 'Comprovantes',
  documento_pessoal: 'Documentos pessoais',
  outro: 'Outros'
};

const estado = {
  cliente: null,
  empresas: [],
  empresaId: null,
  documentos: [],
  filtroDocumentos: 'todos',
  tiposPedido: {}
};

// ---------------- Utilidades ----------------
function formatarData(dataIso) {
  if (!dataIso) return '—';
  const [ano, mes, dia] = String(dataIso).substring(0, 10).split('-');
  return `${dia}/${mes}/${ano}`;
}
function formatarDataHora(dataIso) {
  return dataIso ? new Date(dataIso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
}
function formatarTamanho(bytes) {
  if (!bytes) return '';
  const kb = bytes / 1024;
  return kb < 1024 ? `${kb.toFixed(0)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}
function formatarCompetencia(comp) {
  return comp ? `${comp.slice(5, 7)}/${comp.slice(0, 4)}` : '';
}
function extensaoDoArquivo(nome) {
  const partes = String(nome || '').split('.');
  return partes.length > 1 ? partes.pop().slice(0, 4).toUpperCase() : 'DOC';
}
function badge(classe, texto) {
  return `<span class="badge ${classe}">${esc(texto)}</span>`;
}
function vazio(texto) {
  return `<p class="pc-vazio">${esc(texto)}</p>`;
}

// ---------------- Abas ----------------
function abrirAba(nome) {
  document.querySelectorAll('.pc-aba').forEach((aba) => aba.setAttribute('aria-selected', String(aba.dataset.aba === nome)));
  document.querySelectorAll('.pc-painel').forEach((p) => p.classList.toggle('ativo', p.dataset.painel === nome));
  // Guarda a aba no endereço (ex: #pedidos) — o link das mensagens abre direto nela
  history.replaceState(null, '', nome === 'inicio' ? window.location.pathname : `#${nome}`);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
const ABAS = ['inicio', 'documentos', 'pedidos', 'conta'];
document.querySelectorAll('.pc-aba').forEach((aba) => aba.addEventListener('click', () => abrirAba(aba.dataset.aba)));

// ---------------- Carregamento ----------------
async function iniciar() {
  try {
    const [me, tipos] = await Promise.all([clienteFetch('/me'), clienteFetch('/tipos-solicitacao')]);
    if (!me) return;
    estado.cliente = me.cliente;
    estado.empresas = me.empresas;
    estado.tiposPedido = tipos || {};

    if (!estado.empresas.length) {
      document.getElementById('tela-carregando').textContent =
        'Seu acesso ainda não tem nenhuma empresa liberada. Fale com o escritório.';
      return;
    }

    const salva = lerArmazenamento(CHAVE_EMPRESA_CLIENTE);
    estado.empresaId = estado.empresas.some((e) => e.id === salva) ? salva : estado.empresas[0].id;

    preencherConta();
    montarSeletorEmpresa();
    montarFormularioPedido();
    await carregarEmpresa();

    document.getElementById('tela-carregando').style.display = 'none';
    document.getElementById('tela-portal').style.display = 'block';

    const abaDoEndereco = window.location.hash.slice(1);
    if (ABAS.includes(abaDoEndereco) && abaDoEndereco !== 'inicio') abrirAba(abaDoEndereco);
  } catch (err) {
    document.getElementById('tela-carregando').textContent = err.message;
  }
}

function preencherConta() {
  const c = estado.cliente;
  document.getElementById('nome-usuario').textContent = c.nome || c.email;
  document.getElementById('conta-nome').textContent = c.nome || '—';
  document.getElementById('conta-email').textContent = c.email;
  document.getElementById('conta-telefone').textContent = c.telefone || 'Não cadastrado';
}

function montarSeletorEmpresa() {
  const bloco = document.getElementById('bloco-trocar-empresa');
  const select = document.getElementById('seletor-empresa');
  if (estado.empresas.length < 2) { bloco.style.display = 'none'; return; }
  bloco.style.display = 'flex';
  select.innerHTML = estado.empresas
    .map((e) => `<option value="${esc(e.id)}">${esc(e.nome_fantasia || e.razao_social)} — ${esc(e.cnpj)}</option>`)
    .join('');
  select.value = estado.empresaId;
  select.addEventListener('change', async () => {
    estado.empresaId = select.value;
    gravarArmazenamento(CHAVE_EMPRESA_CLIENTE, estado.empresaId);
    estado.filtroDocumentos = 'todos';
    await carregarEmpresa();
    notificar('Empresa alterada.', 'sucesso');
  });
}

async function carregarEmpresa() {
  const base = `/empresas/${encodeURIComponent(estado.empresaId)}`;
  const [resumo, documentos, pedidos] = await Promise.all([
    clienteFetch(`${base}/resumo`),
    clienteFetch(`${base}/documentos`),
    clienteFetch(`${base}/solicitacoes`)
  ]);
  if (!resumo) return;

  document.getElementById('nome-empresa').textContent = resumo.empresa.nome_fantasia || resumo.empresa.razao_social;
  document.getElementById('cnpj-empresa').textContent =
    `${resumo.empresa.cnpj}${resumo.empresa.nome_fantasia ? ' · ' + resumo.empresa.razao_social : ''}`;
  document.title = `Área do Cliente — ${resumo.empresa.razao_social}`;

  renderizarResumo(resumo);
  estado.documentos = documentos || [];
  renderizarDocumentos();
  renderizarPedidos(pedidos || []);
}

/**
 * Quadro "Certificado digital" do Início: validade (se cadastrada) e o
 * arquivo do certificado para baixar (se o escritório disponibilizou).
 */
function renderizarArquivosCertificado() {
  const el = document.getElementById('lista-certificados');
  const validades = (estado.certificadosValidade || [])
    .map((c) => `
      <div class="pc-linha">
        <div><strong>${esc(RÓTULOS_TIPO_CERTIFICADO[c.tipo] || c.tipo)}</strong><div class="meta">Validade: ${formatarData(c.data_validade)}</div></div>
        ${badge(`badge-${c.status}`, RÓTULOS_STATUS_VALIDADE[c.status] || c.status)}
      </div>`).join('');
  const arquivos = estado.documentos.filter((d) => d.categoria === 'certificado_digital' && !d.enviado_pelo_cliente);
  const htmlArquivos = arquivos.map((d) => `
    <div class="pc-linha">
      <div><strong>${esc(d.nome_original)}</strong><div class="meta">Arquivo do certificado · disponibilizado em ${formatarData(d.criado_em)}</div></div>
      <button type="button" class="btn btn-secundario" style="height:34px;" data-baixar-certificado="${esc(d.id)}">Baixar</button>
    </div>`).join('');

  el.innerHTML = validades + htmlArquivos || vazio('Nenhum certificado disponível ainda.');
  if (arquivos.length) {
    el.insertAdjacentHTML('beforeend', '<p class="pc-vazio" style="font-size:var(--text-xs);">A senha do certificado não fica no sistema. Se precisar dela, fale com o escritório por telefone.</p>');
  }
  el.querySelectorAll('[data-baixar-certificado]').forEach((btn) => btn.addEventListener('click', () => {
    baixarDocumento(estado.documentos.find((d) => d.id === btn.dataset.baixarCertificado), btn);
  }));
}

// ---------------- Início ----------------
function renderizarResumo(r) {
  const card = document.getElementById('card-atencao');
  if (r.atencao.length) {
    card.style.display = 'block';
    const nomes = { certidao: RÓTULOS_TIPO_CERTIDAO, licenca: RÓTULOS_TIPO_LICENCA, certificado: RÓTULOS_TIPO_CERTIFICADO };
    const prefixo = { certificado: 'Certificado digital ' };
    document.getElementById('lista-atencao').innerHTML = r.atencao.map((a) => `
      <div class="pc-atencao-item">
        <span><strong>${esc((prefixo[a.grupo] || '') + ((nomes[a.grupo] || {})[a.tipo] || a.tipo))}</strong>
          — ${a.status === 'vencida' ? 'venceu' : 'vence'} em ${formatarData(a.data_validade)}</span>
        ${badge(`badge-${a.status}`, RÓTULOS_STATUS_VALIDADE[a.status])}
      </div>`).join('');
  } else {
    card.style.display = 'none';
  }

  const linhaValidade = (titulo, item) => `
    <div class="pc-linha">
      <div><strong>${esc(titulo)}</strong><div class="meta">Validade: ${formatarData(item.data_validade)}</div></div>
      ${badge(`badge-${item.status}`, RÓTULOS_STATUS_VALIDADE[item.status] || item.status)}
    </div>`;

  document.getElementById('lista-certidoes').innerHTML = r.certidoes.length
    ? r.certidoes.map((c) => linhaValidade(RÓTULOS_TIPO_CERTIDAO[c.tipo] || c.tipo, c)).join('')
    : vazio('Nenhuma certidão cadastrada ainda.');
  // A validade vem do cadastro do certificado; o arquivo (.pfx) é
  // acrescentado por renderizarArquivosCertificado(), depois que os documentos chegam.
  estado.certificadosValidade = r.certificados;
  document.getElementById('lista-certificados').innerHTML =
    r.certificados.map((c) => linhaValidade(RÓTULOS_TIPO_CERTIFICADO[c.tipo] || c.tipo, c)).join('');
  document.getElementById('lista-licencas').innerHTML = r.licencas.length
    ? r.licencas.map((l) => linhaValidade(RÓTULOS_TIPO_LICENCA[l.tipo] || l.tipo, l)).join('')
    : vazio('Nenhuma licença cadastrada.');
  document.getElementById('lista-processos').innerHTML = r.processos.length
    ? r.processos.map((p) => `
      <div class="pc-linha">
        <div><strong>${esc(RÓTULOS_TIPO_PROCESSO[p.tipo] || p.tipo)}</strong>
          <div class="meta">${esc(p.descricao || '')}${p.orgao ? ' · ' + esc(p.orgao) : ''}</div></div>
        ${badge(CLASSE_STATUS_PROCESSO[p.status] || '', RÓTULOS_STATUS_PROCESSO[p.status] || p.status)}
      </div>`).join('')
    : vazio('Nenhum processo em andamento.');

  const contador = document.getElementById('contador-pedidos');
  contador.textContent = r.pedidos_abertos;
  contador.style.display = r.pedidos_abertos ? 'inline-flex' : 'none';
}

document.getElementById('atalho-cartao').addEventListener('click', () => {
  const cartao = estado.documentos.find((d) => d.categoria === 'cartao_cnpj');
  if (cartao) baixarDocumento(cartao);
});
document.getElementById('atalho-guia').addEventListener('click', () => {
  abrirAba('pedidos');
  abrirFormularioPedido('fiscal');
});
document.getElementById('atalho-enviar').addEventListener('click', () => {
  abrirAba('documentos');
  setTimeout(() => {
    document.getElementById('card-enviar').scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.getElementById('arquivo-upload').focus();
  }, 150);
});

// ---------------- Documentos ----------------
function renderizarDocumentos() {
  const docs = estado.documentos;
  renderizarArquivosCertificado();

  const cartao = docs.find((d) => d.categoria === 'cartao_cnpj');
  document.getElementById('atalho-cartao').disabled = !cartao;
  document.getElementById('atalho-cartao-texto').textContent = cartao
    ? `Baixar (${formatarData(cartao.criado_em)})`
    : 'Ainda não disponibilizado pelo escritório';

  // Filtros só das categorias que existem para esta empresa
  const presentes = Object.keys(CATEGORIAS_DOCUMENTO).filter((c) => docs.some((d) => d.categoria === c && !d.enviado_pelo_cliente));
  const filtros = [['todos', 'Todos'], ...presentes.map((c) => [c, CATEGORIAS_DOCUMENTO[c]])];
  if (docs.some((d) => d.enviado_pelo_cliente)) filtros.push(['enviados', 'Enviados por você']);
  if (!filtros.some(([v]) => v === estado.filtroDocumentos)) estado.filtroDocumentos = 'todos';

  const filtrosEl = document.getElementById('filtros-documentos');
  filtrosEl.innerHTML = filtros.length > 2 || docs.length > 6
    ? filtros.map(([valor, rotulo]) =>
      `<button type="button" class="pc-chip" data-filtro="${valor}" aria-pressed="${valor === estado.filtroDocumentos}">${esc(rotulo)}</button>`).join('')
    : '';
  filtrosEl.querySelectorAll('[data-filtro]').forEach((btn) => btn.addEventListener('click', () => {
    estado.filtroDocumentos = btn.dataset.filtro;
    renderizarDocumentos();
  }));

  const visiveis = docs.filter((d) => {
    if (estado.filtroDocumentos === 'todos') return true;
    if (estado.filtroDocumentos === 'enviados') return d.enviado_pelo_cliente;
    return d.categoria === estado.filtroDocumentos && !d.enviado_pelo_cliente;
  });

  document.getElementById('aviso-certificado').style.display =
    docs.some((d) => d.categoria === 'certificado_digital') ? 'block' : 'none';

  const lista = document.getElementById('lista-documentos');
  if (!visiveis.length) {
    lista.innerHTML = vazio(docs.length ? 'Nenhum documento nesta categoria.' : 'O escritório ainda não disponibilizou documentos para esta empresa.');
    return;
  }
  lista.innerHTML = visiveis.map((d) => `
    <div class="pc-doc">
      <div class="ic" aria-hidden="true">${esc(extensaoDoArquivo(d.nome_original))}</div>
      <div class="info">
        <strong>${esc(d.descricao && d.categoria !== 'outro' ? d.descricao : d.nome_original)}</strong>
        <div class="meta">
          ${d.enviado_pelo_cliente ? 'Enviado por você' : esc(CATEGORIAS_DOCUMENTO[d.categoria] || 'Documento')}
          · ${formatarData(d.criado_em)} ${d.tamanho_bytes ? '· ' + formatarTamanho(d.tamanho_bytes) : ''}
          ${d.descricao && d.categoria !== 'outro' ? '· ' + esc(d.nome_original) : ''}
        </div>
      </div>
      <button type="button" class="btn btn-secundario" data-baixar="${esc(d.id)}">Baixar</button>
    </div>`).join('');

  lista.querySelectorAll('[data-baixar]').forEach((btn) => btn.addEventListener('click', () => {
    baixarDocumento(estado.documentos.find((d) => d.id === btn.dataset.baixar), btn);
  }));
}

async function baixarDocumento(doc, btn) {
  if (!doc) return;
  if (btn) btn.disabled = true;
  try {
    await baixarArquivoCliente(`/empresas/${encodeURIComponent(estado.empresaId)}/documentos/${encodeURIComponent(doc.id)}/download`, doc.nome_original);
  } catch (err) {
    notificar(err.message, 'erro');
  } finally {
    if (btn) btn.disabled = false;
  }
}

document.getElementById('form-upload').addEventListener('submit', async (e) => {
  e.preventDefault();
  const erroEl = document.getElementById('erro-upload');
  erroEl.textContent = '';
  const arquivo = document.getElementById('arquivo-upload').files[0];
  if (!arquivo) { erroEl.textContent = 'Escolha um arquivo.'; return; }

  const formData = new FormData();
  formData.append('arquivo', arquivo);
  const descricao = document.getElementById('descricao-upload').value.trim();
  if (descricao) formData.append('descricao', descricao);

  const btn = document.getElementById('btn-upload');
  btn.disabled = true;
  try {
    await clienteFetch(`/empresas/${encodeURIComponent(estado.empresaId)}/documentos`, { method: 'POST', body: formData });
    e.target.reset();
    notificar('Documento enviado ao escritório.', 'sucesso');
    estado.documentos = await clienteFetch(`/empresas/${encodeURIComponent(estado.empresaId)}/documentos`) || [];
    renderizarDocumentos();
  } catch (err) {
    erroEl.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

// ---------------- Pedidos ----------------
const formPedido = document.getElementById('form-pedido');
const selectSetor = document.getElementById('pedido-setor');
const selectTipo = document.getElementById('pedido-tipo');

function montarFormularioPedido() {
  selectSetor.innerHTML = Object.entries(estado.tiposPedido)
    .map(([valor, cfg]) => `<option value="${esc(valor)}">${esc(cfg.rotulo)}</option>`).join('');
  atualizarTiposPedido();
}

function tipoSelecionado() {
  const cfg = estado.tiposPedido[selectSetor.value];
  return cfg ? cfg.tipos.find((t) => t.valor === selectTipo.value) : null;
}

function atualizarTiposPedido() {
  const cfg = estado.tiposPedido[selectSetor.value];
  selectTipo.innerHTML = cfg ? cfg.tipos.map((t) => `<option value="${esc(t.valor)}">${esc(t.rotulo)}</option>`).join('') : '';
  atualizarCamposPedido();
}

function atualizarCamposPedido() {
  const tipo = tipoSelecionado();
  const pedeCompetencia = !!(tipo && tipo.pedeCompetencia);
  document.getElementById('campo-competencia').style.display = pedeCompetencia ? 'block' : 'none';
  document.getElementById('pedido-competencia').required = pedeCompetencia;
  const obsObrigatoria = !!(tipo && tipo.valor.startsWith('outro_'));
  document.getElementById('obs-obrigatoria').style.display = obsObrigatoria ? 'inline' : 'none';
  document.getElementById('pedido-observacao').required = obsObrigatoria;
}

selectSetor.addEventListener('change', atualizarTiposPedido);
selectTipo.addEventListener('change', atualizarCamposPedido);

function abrirFormularioPedido(setor) {
  formPedido.reset();
  document.getElementById('erro-pedido').textContent = '';
  if (setor && estado.tiposPedido[setor]) selectSetor.value = setor;
  atualizarTiposPedido();
  // Competência sugerida: mês passado (é o caso mais comum de guia em atraso)
  const hoje = new Date();
  const mesPassado = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
  document.getElementById('pedido-competencia').value =
    `${mesPassado.getFullYear()}-${String(mesPassado.getMonth() + 1).padStart(2, '0')}`;
  formPedido.classList.add('aberto');
  document.getElementById('btn-novo-pedido').style.display = 'none';
  selectTipo.focus();
}

function fecharFormularioPedido() {
  formPedido.classList.remove('aberto');
  document.getElementById('btn-novo-pedido').style.display = '';
}

document.getElementById('btn-novo-pedido').addEventListener('click', () => abrirFormularioPedido());
document.getElementById('btn-cancelar-pedido').addEventListener('click', fecharFormularioPedido);

formPedido.addEventListener('submit', async (e) => {
  e.preventDefault();
  const erroEl = document.getElementById('erro-pedido');
  erroEl.textContent = '';
  const tipo = tipoSelecionado();
  const btn = document.getElementById('btn-enviar-pedido');
  btn.disabled = true;
  try {
    await clienteFetch(`/empresas/${encodeURIComponent(estado.empresaId)}/solicitacoes`, {
      method: 'POST',
      body: {
        setor: selectSetor.value,
        tipo: selectTipo.value,
        competencia: tipo && tipo.pedeCompetencia ? document.getElementById('pedido-competencia').value : undefined,
        observacao: document.getElementById('pedido-observacao').value.trim()
      }
    });
    fecharFormularioPedido();
    notificar('Pedido enviado! O setor responsável já foi avisado.', 'sucesso');
    await carregarEmpresa();
  } catch (err) {
    erroEl.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

function rotuloTipoPedido(setor, tipo) {
  const cfg = estado.tiposPedido[setor];
  const t = cfg && cfg.tipos.find((x) => x.valor === tipo);
  return t ? t.rotulo : tipo;
}

function renderizarPedidos(pedidos) {
  const lista = document.getElementById('lista-pedidos');
  if (!pedidos.length) {
    lista.innerHTML = vazio('Você ainda não fez nenhum pedido. Precisa da 2ª via de uma guia? Clique em "Novo pedido".');
    return;
  }
  lista.innerHTML = pedidos.map((p) => {
    const setor = estado.tiposPedido[p.setor] ? estado.tiposPedido[p.setor].rotulo : p.setor;
    const temResposta = p.resposta_cliente || p.documento_resposta_id;
    return `
      <div class="pc-pedido">
        <div class="topo">
          <div>
            <strong>${esc(rotuloTipoPedido(p.setor, p.tipo_solicitacao))}${p.competencia ? ' — ' + formatarCompetencia(p.competencia) : ''}</strong>
            <div class="meta">${esc(setor)} · pedido em ${formatarDataHora(p.criado_em)}${p.cliente_nome ? ' por ' + esc(p.cliente_nome) : ''}
              ${p.concluido_em ? ' · concluído em ' + formatarDataHora(p.concluido_em) : ''}</div>
          </div>
          ${badge(CLASSE_STATUS_PEDIDO[p.status] || '', RÓTULOS_STATUS_PEDIDO[p.status] || p.status)}
        </div>
        ${temResposta ? `
          <div class="pc-resposta">
            <div class="rotulo">Resposta do escritório</div>
            ${p.resposta_cliente ? `<div>${esc(p.resposta_cliente)}</div>` : ''}
            ${p.documento_resposta_id ? `<button type="button" class="link-acao" style="margin-top:var(--space-2);" data-baixar-resposta="${esc(p.documento_resposta_id)}" data-nome="${esc(p.documento_resposta_nome || '')}">Baixar ${esc(p.documento_resposta_nome || 'arquivo')}</button>` : ''}
          </div>` : ''}
      </div>`;
  }).join('');

  lista.querySelectorAll('[data-baixar-resposta]').forEach((btn) => btn.addEventListener('click', () => {
    baixarDocumento({ id: btn.dataset.baixarResposta, nome_original: btn.dataset.nome }, btn);
  }));
}

// ---------------- Conta ----------------
document.getElementById('form-senha').addEventListener('submit', async (e) => {
  e.preventDefault();
  const erroEl = document.getElementById('erro-senha');
  erroEl.textContent = '';
  try {
    const dados = await clienteFetch('/trocar-senha', {
      method: 'POST',
      semRedirecionar: true,
      body: { senhaAtual: document.getElementById('senha-atual').value, novaSenha: document.getElementById('senha-nova').value }
    });
    e.target.reset();
    notificar(dados.mensagem, 'sucesso');
  } catch (err) {
    erroEl.textContent = err.message;
  }
});

document.getElementById('btn-sair').addEventListener('click', sairCliente);
document.getElementById('btn-tema').addEventListener('click', alternarTemaCliente);

iniciar();
