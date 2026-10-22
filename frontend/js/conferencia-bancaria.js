/**
 * Conferência bancária — lista das empresas (situação de cada mês) e
 * ficha da empresa (conta a conta, o que falta, organização da pasta).
 */
exigirLogin();
inicializarShell();

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const STATUS = {
  ok: { rotulo: 'Conferido', curto: 'OK', dica: 'O extrato (OFX) bate com o Domínio' },
  lancado_sem_ofx: { rotulo: 'Lançado sem OFX', curto: 'Lançado', dica: 'Há lançamentos no Domínio, mas não há OFX na pasta para conferir' },
  falta_importar: { rotulo: 'Falta importar', curto: 'Importar', dica: 'O extrato está na pasta e ainda não foi lançado no Domínio' },
  diferenca: { rotulo: 'Diferença', curto: 'Diferença', dica: 'O extrato e o Domínio não batem' },
  falta_extrato: { rotulo: 'Falta extrato', curto: 'Sem extrato', dica: 'Não há extrato na pasta nem lançamento no Domínio' },
  nao_identificada: { rotulo: 'Conta não identificada', curto: 'Vincular', dica: 'Há extrato de uma conta que não foi ligada a nenhuma conta do Domínio' },
  sem_movimento: { rotulo: 'Sem movimento', curto: '—', dica: 'Nada a conferir' },
  encerrada: { rotulo: 'Conta encerrada', curto: 'Encerrada', dica: 'Conta encerrada: não precisa mais de extrato' }
};
const ORDEM_LEGENDA = ['ok', 'lancado_sem_ofx', 'falta_importar', 'diferenca', 'falta_extrato', 'nao_identificada', 'encerrada', 'sem_movimento'];
const GRUPOS_PENDENCIA = [
  { tipos: ['pasta'], titulo: 'Pasta da empresa', cor: 'var(--color-carmine)' },
  { tipos: ['diferenca'], titulo: 'Diferenças entre o extrato e o Domínio', cor: 'var(--color-carmine)' },
  { tipos: ['vincular'], titulo: 'Extratos sem conta no Domínio', cor: '#C1651F' },
  { tipos: ['importar'], titulo: 'Importar ou lançar no Domínio', cor: 'var(--color-amber)' },
  { tipos: ['extrato'], titulo: 'Pedir ao cliente', cor: 'var(--color-slate-info)' },
  { tipos: ['encerrada', 'verificar_encerrada'], titulo: 'Contas encerradas', cor: 'var(--color-amber)' },
  { tipos: ['aplicacao', 'emprestimo', 'cartao', 'desconto'], titulo: 'Aplicações, empréstimos e cartões', cor: 'var(--color-amber)' },
  { tipos: ['conciliar'], titulo: 'Avisos', cor: 'var(--color-text-faint)' }
];
const TIPO_CONTA = { aplicacao: 'Aplicação', emprestimo: 'Empréstimo', cartao: 'Cartão', desconto: 'Desconto de títulos' };

const estado = { ano: new Date().getFullYear(), mesLimite: 0, empresas: [], filtroKpi: '', ficha: null, timerLote: null };
const $ = (id) => document.getElementById(id);

const usuario = getUsuario();
if (usuario && !pode('conferencia_bancaria.usar')) {
  document.querySelector('main.conteudo').innerHTML = '<div class="painel"><p class="estado-vazio">A conferência bancária é do setor Contábil. Peça acesso ao administrador.</p></div>';
  throw new Error('sem acesso');
}

// ------------------------------------------------------------------
// Utilidades
// ------------------------------------------------------------------
const moeda = (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const cnpjFormatado = (c) => (c && c.length === 14 ? c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : (c || ''));
const listaMeses = (ms) => ms.map((m) => MESES[m - 1].toLowerCase()).join(', ');

function copiar(texto, aviso = 'Copiado.') {
  const feito = () => notificar(aviso, 'sucesso');
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(texto).then(feito, () => copiarAntigo(texto) && feito());
  } else if (copiarAntigo(texto)) {
    feito();
  }
}
function copiarAntigo(texto) {
  const t = document.createElement('textarea');
  t.value = texto;
  t.style.position = 'fixed';
  t.style.opacity = '0';
  document.body.appendChild(t);
  t.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  t.remove();
  if (!ok) notificar('Não foi possível copiar. Selecione o texto e copie com Ctrl+C.', 'erro');
  return ok;
}

function abrirModal(id) { $(id).classList.add('aberto'); }
function fecharModal(id) { $(id).classList.remove('aberto'); }
document.querySelectorAll('.modal-fundo').forEach((fundo) => {
  fundo.addEventListener('click', (e) => {
    if (e.target === fundo || e.target.closest('[data-fechar-modal]')) fundo.classList.remove('aberto');
  });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.querySelectorAll('.modal-fundo.aberto').forEach((m) => m.classList.remove('aberto'));
});

function situacaoDaEmpresa(e) {
  const meses = (e.meses || []).map((m) => m.status);
  return {
    conferida: !!(e.conferido_em && !e.erro && e.meses),
    diferenca: meses.includes('diferenca') || meses.includes('nao_identificada'),
    importar: meses.includes('falta_importar'),
    extrato: meses.includes('falta_extrato'),
    semCadastro: !e.codigo_dominio || !e.pasta
  };
}

// ------------------------------------------------------------------
// Lista
// ------------------------------------------------------------------
function preencherAnos() {
  const atual = new Date().getFullYear();
  $('ano').innerHTML = [atual, atual - 1, atual - 2, atual - 3].map((a) => `<option value="${a}">${a}</option>`).join('');
  $('ano').value = String(estado.ano);
  $('btn-painel').href = `/pages/painel-conferencia.html?ano=${estado.ano}`;
}

function montarLegenda() {
  $('legenda').innerHTML = ORDEM_LEGENDA.map((s) => `<span title="${esc(STATUS[s].dica)}"><i class="st-${s}"></i>${esc(STATUS[s].rotulo)}</span>`).join('');
}

async function carregarLista() {
  try {
    const dados = await apiFetch(`/conferencia-bancaria/empresas?ano=${estado.ano}`);
    if (!dados) return;
    estado.empresas = dados.empresas;
    estado.mesLimite = dados.mesLimite;
    const responsaveis = [...new Set(dados.empresas.map((e) => e.responsavel).filter(Boolean))].sort();
    const sel = $('filtro-responsavel');
    const escolhido = sel.value;
    sel.innerHTML = '<option value="">Todos os responsáveis</option>' + responsaveis.map((r) => `<option value="${esc(r)}">${esc(nomeResponsavel(r))}</option>`).join('');
    sel.value = responsaveis.includes(escolhido) ? escolhido : '';
    montarKpis();
    renderizarLista();
    mostrarLote(dados.lote);
  } catch (err) {
    $('tabela-empresas').innerHTML = `<tr><td colspan="7" class="estado-vazio">${esc(err.message)}</td></tr>`;
  }
}

function montarKpis() {
  const lista = estado.empresas.filter((e) => e.na_planilha);
  const s = lista.map(situacaoDaEmpresa);
  const conferidas = s.filter((x) => x.conferida).length;
  const kpis = [
    { chave: 'nao_conferidas', rotulo: 'Ainda não conferidas', numero: lista.length - conferidas, detalhe: `${conferidas} de ${lista.length} já conferidas` },
    { chave: 'diferenca', rotulo: 'Com diferença', numero: s.filter((x) => x.diferenca).length, detalhe: 'extrato não bate com o Domínio' },
    { chave: 'falta_importar', rotulo: 'Falta importar', numero: s.filter((x) => x.importar).length, detalhe: 'extrato na pasta, sem lançamento' },
    { chave: 'falta_extrato', rotulo: 'Falta extrato', numero: s.filter((x) => x.extrato).length, detalhe: 'pedir ao cliente' }
  ];
  $('kpis').innerHTML = kpis.map((k) => `
    <button type="button" class="kpi" data-kpi="${k.chave}" aria-pressed="${estado.filtroKpi === k.chave}">
      <span class="kpi-rotulo">${esc(k.rotulo)}</span>
      <span class="kpi-numero">${k.numero}</span>
      <span class="kpi-detalhe">${esc(k.detalhe)}</span>
    </button>`).join('');
}

$('kpis').addEventListener('click', (e) => {
  const kpi = e.target.closest('[data-kpi]');
  if (!kpi) return;
  estado.filtroKpi = estado.filtroKpi === kpi.dataset.kpi ? '' : kpi.dataset.kpi;
  $('filtro-situacao').value = estado.filtroKpi;
  montarKpis();
  renderizarLista();
});

function filtrarEmpresas() {
  const busca = $('busca').value.trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const buscaNum = busca.replace(/\D/g, '');
  const resp = $('filtro-responsavel').value;
  const sit = $('filtro-situacao').value;
  return estado.empresas.filter((e) => {
    if (resp && e.responsavel !== resp) return false;
    if (busca) {
      const texto = `${e.nome} ${e.nome_dominio || ''} ${e.pasta || ''}`.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      const achou = texto.includes(busca) || (buscaNum && ((e.cnpj || '').includes(buscaNum) || String(e.codigo_dominio || '') === buscaNum));
      if (!achou) return false;
    }
    const s = situacaoDaEmpresa(e);
    switch (sit) {
      case 'pendentes': return s.conferida && e.pendencias > 0;
      case 'diferenca': return s.diferenca;
      case 'falta_importar': return s.importar;
      case 'falta_extrato': return s.extrato;
      case 'em_dia': return s.conferida && e.pendencias === 0;
      case 'nao_conferidas': return !s.conferida;
      case 'sem_cadastro': return s.semCadastro;
      default: return true;
    }
  });
}

function htmlMeses(meses) {
  const porMes = new Map((meses || []).map((m) => [m.m, m.status]));
  return `<div class="cb-meses">${MESES.map((nome, i) => {
    const m = i + 1;
    if (m > estado.mesLimite) return `<span class="cb-mes fora" title="${nome}: mês ainda não fechado"></span>`;
    const st = porMes.get(m);
    return st
      ? `<span class="cb-mes st-${st}" title="${nome}: ${esc(STATUS[st].rotulo)}"></span>`
      : `<span class="cb-mes" title="${nome}: não conferido"></span>`;
  }).join('')}</div>`;
}

function renderizarLista() {
  const lista = filtrarEmpresas();
  const tbody = $('tabela-empresas');
  if (!estado.empresas.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="estado-vazio">Nenhuma empresa cadastrada ainda. Clique em <strong>Atualizar da planilha</strong> para trazer as empresas da planilha Controle Extratos CC.</td></tr>';
    $('contagem').textContent = '';
    return;
  }
  if (!lista.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="estado-vazio">Nenhuma empresa com esses filtros.</td></tr>';
    $('contagem').textContent = '';
    return;
  }
  tbody.innerHTML = lista.map((e) => {
    const sub = [
      e.codigo_dominio ? `Domínio ${e.codigo_dominio}` : '<span class="cb-erro">sem código do Domínio</span>',
      e.cnpj ? cnpjFormatado(e.cnpj) : null,
      !e.pasta ? '<span class="cb-erro">pasta não encontrada</span>' : null,
      !e.na_planilha ? 'fora da planilha' : null
    ].filter(Boolean).join(' · ');
    let pend = '<span class="cb-sub">—</span>';
    if (e.erro) pend = `<span class="cb-erro" title="${esc(e.erro)}">Erro</span>`;
    else if (e.meses) pend = `<span class="cb-qtd ${e.pendencias ? '' : 'zero'}">${e.pendencias || 'Em dia'}</span>`;
    const quando = e.conferido_em ? `${esc(tempoRelativo(e.conferido_em))}<div class="cb-sub">${esc(e.conferido_por || '')}</div>` : '<span class="cb-sub">nunca</span>';
    const podeConferir = e.codigo_dominio && e.pasta;
    return `
      <tr class="cb-linha" data-id="${e.id}">
        <td><div class="cb-nome">${esc(e.nome)}</div><div class="cb-sub">${sub}</div></td>
        <td>${esc(nomeResponsavel(e.responsavel) || '—')}</td>
        <td><div>${esc(e.bancos || '—')}</div>${e.na_pasta ? `<div class="cb-sub">Planilha: ${esc(e.na_pasta)}</div>` : ''}</td>
        <td>${htmlMeses(e.meses)}</td>
        <td>${pend}</td>
        <td>${quando}</td>
        <td class="celula-acoes"><div class="acoes-linha">
          <button type="button" class="link-acao" data-conferir="${e.id}" ${podeConferir ? '' : 'disabled title="Falta o código do Domínio ou a pasta"'}>Conferir</button>
          <button type="button" class="link-acao" data-abrir="${e.id}">Abrir</button>
        </div></td>
      </tr>`;
  }).join('');
  $('contagem').textContent = `${lista.length} empresa(s) na lista.`;
}

$('tabela-empresas').addEventListener('click', async (e) => {
  const btnConferir = e.target.closest('[data-conferir]');
  if (btnConferir) {
    e.stopPropagation();
    await conferirEmpresa(Number(btnConferir.dataset.conferir), btnConferir);
    return;
  }
  const linha = e.target.closest('tr[data-id]');
  if (linha) abrirFicha(Number(linha.dataset.id));
});

['busca', 'filtro-responsavel', 'filtro-situacao'].forEach((id) => $(id).addEventListener('input', () => {
  if (id === 'filtro-situacao') { estado.filtroKpi = $(id).value; montarKpis(); }
  renderizarLista();
}));

$('ano').addEventListener('change', () => {
  estado.ano = Number($('ano').value);
  $('btn-painel').href = `/pages/painel-conferencia.html?ano=${estado.ano}`;
  if (estado.ficha) abrirFicha(estado.ficha.id); else carregarLista();
});

$('btn-exportar').addEventListener('click', () => {
  const colunasMeses = MESES.slice(0, estado.mesLimite).map((nome, i) => ({
    titulo: nome,
    valor: (e) => { const m = (e.meses || []).find((x) => x.m === i + 1); return m ? STATUS[m.status].rotulo : ''; }
  }));
  exportarExcel(`conferencia-bancaria-${estado.ano}`, [
    { titulo: 'Empresa', valor: (e) => e.nome },
    { titulo: 'Código Domínio', valor: (e) => e.codigo_dominio || '' },
    { titulo: 'CNPJ', valor: (e) => cnpjFormatado(e.cnpj) },
    { titulo: 'Responsável', valor: (e) => nomeResponsavel(e.responsavel) },
    { titulo: 'Bancos (planilha)', valor: (e) => e.bancos || '' },
    { titulo: 'Pendências', valor: (e) => (e.erro ? `Erro: ${e.erro}` : (e.meses ? e.pendencias : 'não conferida')) },
    ...colunasMeses,
    { titulo: 'Conferida em', valor: (e) => (e.conferido_em ? new Date(e.conferido_em).toLocaleString('pt-BR') : '') }
  ], filtrarEmpresas());
});

$('btn-planilha').addEventListener('click', async () => {
  const btn = $('btn-planilha');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner escuro"></span> Lendo a planilha...';
  try {
    const r = await apiFetch('/conferencia-bancaria/planilha', { method: 'POST' });
    notificar(`Planilha lida: ${r.lidas} empresas (${r.novas} novas). ${r.semCodigo} sem código do Domínio, ${r.semPasta} sem pasta encontrada.`, 'sucesso');
    await carregarLista();
  } catch (err) {
    notificar(err.message, 'erro');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Atualizar da planilha';
  }
});

$('btn-conferir-todas').addEventListener('click', async () => {
  const lista = filtrarEmpresas().filter((e) => e.codigo_dominio && e.pasta);
  if (!lista.length) { notificar('Nenhuma empresa da lista tem código do Domínio e pasta para conferir.', 'erro'); return; }
  const filtrada = lista.length !== estado.empresas.filter((e) => e.codigo_dominio && e.pasta).length;
  const ok = await confirmarAcao(`Conferir ${lista.length} empresa(s)${filtrada ? ' (as da lista filtrada)' : ''} em ${estado.ano}? Leva alguns minutos e roda em segundo plano — pode continuar usando o sistema.`, 'Conferir');
  if (!ok) return;
  try {
    const status = await apiFetch('/conferencia-bancaria/lote', { method: 'POST', body: { ano: estado.ano, ids: lista.map((e) => e.id) } });
    mostrarLote(status);
  } catch (err) {
    notificar(err.message, 'erro');
  }
});

function mostrarLote(lote) {
  clearTimeout(estado.timerLote);
  const caixa = $('lote');
  if (!lote || (!lote.rodando && !lote.fim)) { caixa.style.display = 'none'; return; }
  const pct = lote.total ? Math.round((lote.feitos / lote.total) * 100) : 0;
  caixa.style.display = '';
  $('lote-barra').style.width = `${pct}%`;
  $('btn-conferir-todas').disabled = !!lote.rodando;
  if (lote.rodando) {
    $('lote-texto').textContent = `Conferindo ${lote.ano}: ${lote.feitos} de ${lote.total} empresa(s)${lote.comErro ? ` (${lote.comErro} com erro)` : ''}. Iniciado por ${lote.usuario}.`;
    estado.timerLote = setTimeout(async () => {
      try {
        const novo = await apiFetch('/conferencia-bancaria/lote');
        if (novo && !novo.rodando) { await carregarLista(); notificar('Conferência terminada.', 'sucesso'); } else mostrarLote(novo);
      } catch (e) { estado.timerLote = setTimeout(() => mostrarLote(lote), 5000); }
    }, 3000);
  } else {
    $('lote-texto').textContent = `Última conferência em lote: ${lote.feitos} de ${lote.total} empresa(s)${lote.comErro ? `, ${lote.comErro} com erro` : ''} — terminou ${tempoRelativo(lote.fim)}.`;
  }
}

async function conferirEmpresa(id, botao) {
  const textoOriginal = botao ? botao.innerHTML : '';
  if (botao) { botao.disabled = true; botao.innerHTML = '<span class="spinner escuro"></span> Conferindo...'; }
  try {
    await apiFetch(`/conferencia-bancaria/empresas/${id}/conferir`, { method: 'POST', body: { ano: estado.ano } });
    if (estado.ficha && estado.ficha.id === id) await abrirFicha(id);
    else { await carregarLista(); notificar('Conferência atualizada.', 'sucesso'); }
  } catch (err) {
    notificar(err.message, 'erro');
    if (estado.ficha && estado.ficha.id === id) await abrirFicha(id); else await carregarLista();
  } finally {
    if (botao && document.body.contains(botao)) { botao.disabled = false; botao.innerHTML = textoOriginal; }
  }
}

// ------------------------------------------------------------------
// Ficha da empresa
// ------------------------------------------------------------------
function mostrarVisao(qual) {
  $('visao-lista').style.display = qual === 'lista' ? '' : 'none';
  $('visao-empresa').style.display = qual === 'empresa' ? '' : 'none';
  window.scrollTo({ top: 0 });
}

function atualizarUrl(id) {
  const url = new URL(window.location.href);
  if (id) { url.searchParams.set('empresa', id); url.searchParams.set('ano', estado.ano); } else { url.searchParams.delete('empresa'); }
  history.pushState({ empresa: id || null }, '', url);
}

$('btn-voltar').addEventListener('click', () => {
  estado.ficha = null;
  atualizarUrl(null);
  mostrarVisao('lista');
  carregarLista();
});
window.addEventListener('popstate', () => {
  const id = Number(new URL(window.location.href).searchParams.get('empresa'));
  if (id) abrirFicha(id, false);
  else { estado.ficha = null; mostrarVisao('lista'); carregarLista(); }
});

async function abrirFicha(id, mudarUrl = true) {
  if (mudarUrl) atualizarUrl(id);
  mostrarVisao('empresa');
  $('ficha-cabecalho').innerHTML = '<div class="estado-vazio"><span class="spinner escuro"></span></div>';
  $('ficha-conteudo').innerHTML = '';
  try {
    const e = await apiFetch(`/conferencia-bancaria/empresas/${id}?ano=${estado.ano}`);
    if (!e) return;
    estado.ficha = e;
    renderizarFicha();
  } catch (err) {
    $('ficha-cabecalho').innerHTML = `<p class="estado-vazio">${esc(err.message)}</p>`;
  }
}

function caminhoCompleto(relativo) {
  const r = estado.ficha.resultado;
  return r && r.pasta && r.pasta.caminho ? `${r.pasta.caminho}\\${relativo}` : relativo;
}

function htmlArquivo(relativo) {
  return `<span class="cb-caminho" role="button" tabindex="0" title="Clique para copiar o caminho completo" data-copiar="${esc(caminhoCompleto(relativo))}">${esc(relativo)}</span>`;
}

function renderizarFicha() {
  const e = estado.ficha;
  const r = e.resultado;
  const pastaAno = r && r.pasta && r.pasta.caminho;
  const pastaEmpresa = e.pasta ? `${e.pastaBase}\\${e.pasta}` : null;
  const planilha = [e.extratos, e.solicitado && `Pedido: ${e.solicitado}`, e.na_pasta && `Na pasta: ${e.na_pasta}`].filter(Boolean).join(' · ');

  $('ficha-cabecalho').innerHTML = `
    <div class="cb-topo">
      <div>
        <h2>${esc(e.nome)}</h2>
        <div class="cb-sub">${e.codigo_dominio ? `Domínio ${e.codigo_dominio}${e.nome_dominio ? ` — ${esc(e.nome_dominio)}` : ''}` : '<span class="cb-erro">Sem código do Domínio</span>'}${e.cnpj ? ` · CNPJ ${cnpjFormatado(e.cnpj)}` : ''}${e.empresa_id ? ` · ${linkEmpresa(e.empresa_id, 'ficha no sistema')}` : ''}</div>
      </div>
      <div class="cb-acoes">
        <button class="btn btn-secundario" type="button" id="btn-corrigir">Corrigir cadastro</button>
        <button class="btn" type="button" id="btn-conferir-agora" ${e.codigo_dominio && e.pasta ? '' : 'disabled title="Falta o código do Domínio ou a pasta"'}>${r ? 'Conferir de novo' : 'Conferir agora'}</button>
      </div>
    </div>
    <div class="cb-dados">
      <div class="cb-dado"><span class="rotulo">Responsável</span><span class="valor">${esc(nomeResponsavel(e.responsavel) || '—')}${e.regime ? ` · ${esc(e.regime)}` : ''}</span></div>
      <div class="cb-dado"><span class="rotulo">Bancos (planilha)</span><span class="valor">${esc(e.bancos || '—')}${e.formato ? ` · ${esc(e.formato)}` : ''}</span></div>
      <div class="cb-dado"><span class="rotulo">Extratos (planilha)</span><span class="valor">${esc(planilha || '—')}</span></div>
      <div class="cb-dado"><span class="rotulo">Contato</span><span class="valor">${esc(e.contato || '—')}${e.malote ? ` · ${esc(e.malote)}` : ''}</span></div>
      <div class="cb-dado" style="grid-column: 1 / -1;"><span class="rotulo">Pasta ${estado.ano}</span><span class="valor">${
        pastaEmpresa ? `${htmlCaminhoAbsoluto(pastaAno || pastaEmpresa)}` : '<span class="cb-erro">Pasta não encontrada — use "Corrigir cadastro"</span>'}${e.pasta_manual ? ' <span class="cb-sub">(escolhida à mão)</span>' : ''}</span></div>
      <div class="cb-dado"><span class="rotulo">Última conferência</span><span class="valor">${e.conferido_em ? `${new Date(e.conferido_em).toLocaleString('pt-BR')}${e.conferido_por ? ` · ${esc(e.conferido_por)}` : ''}` : 'Nunca conferida'}</span></div>
      ${e.obs ? `<div class="cb-dado"><span class="rotulo">Observação (planilha)</span><span class="valor">${esc(e.obs)}</span></div>` : ''}
    </div>`;

  $('btn-conferir-agora').addEventListener('click', (ev) => conferirEmpresa(e.id, ev.currentTarget));
  $('btn-corrigir').addEventListener('click', abrirCorrecao);

  const conteudo = $('ficha-conteudo');
  if (e.erro) {
    conteudo.innerHTML = `<div class="painel"><p class="cb-erro" style="font-size:var(--text-sm);">A última conferência falhou: ${esc(e.erro)}</p></div>`;
    return;
  }
  if (!r) {
    conteudo.innerHTML = `<div class="painel"><p class="estado-vazio">Esta empresa ainda não foi conferida em ${estado.ano}. Clique em <strong>Conferir agora</strong>.</p></div>`;
    return;
  }
  conteudo.innerHTML = [painelPendencias(r), painelContas(r), painelAplicacoes(r), painelOrganizacao(r), painelSemLancamento(r)].join('');
}

function htmlCaminhoAbsoluto(caminho) {
  return `<span class="cb-caminho" role="button" tabindex="0" title="Clique para copiar" data-copiar="${esc(caminho)}">${esc(caminho)}</span>`;
}

function painelPendencias(r) {
  const pend = r.pendencias || [];
  const principais = pend.filter((p) => p.gravidade !== 'baixa');
  let corpo;
  if (!principais.length) {
    corpo = `<div class="cb-ok-geral"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>Nada em aberto até ${MESES_LONGOS[r.mesLimite - 1] || '—'} de ${r.ano}.</div>`;
  } else {
    corpo = '';
  }
  corpo += GRUPOS_PENDENCIA.map((g) => {
    const itens = pend.filter((p) => g.tipos.includes(p.tipo));
    if (!itens.length) return '';
    return `<div class="cb-grupo-pend">${esc(g.titulo)} (${itens.length})</div><ul class="cb-pendencias">${itens.map((p) => htmlPendencia(p, p.gravidade === 'baixa' ? 'var(--color-text-faint)' : g.cor)).join('')}</ul>`;
  }).join('');
  const temPedido = pend.some((p) => p.tipo === 'extrato');
  return `
    <div class="painel">
      <div class="painel-cabecalho">
        <div><h2>O que falta</h2><p class="subtitulo-painel" style="margin:2px 0 0;">Conferência de ${r.ano} até ${MESES_LONGOS[r.mesLimite - 1] || '—'}, feita ${esc(tempoRelativo(r.geradoEm))}.</p></div>
        <div class="cb-acoes">
          ${temPedido ? '<button class="btn btn-secundario" type="button" id="btn-copiar-pedido" title="Mensagem pronta para mandar ao cliente pelo WhatsApp ou e-mail">Copiar pedido de extratos</button>' : ''}
          ${pend.length ? '<button class="btn btn-secundario" type="button" id="btn-copiar-pendencias">Copiar lista</button>' : ''}
        </div>
      </div>
      ${corpo}
    </div>`;
}

function htmlPendencia(p, cor) {
  const extras = [];
  const v = p.valores || {};
  if (p.tipo === 'importar' && v.movimentos !== undefined) extras.push(`${v.movimentos} movimento(s) · entradas ${moeda(v.entradas)} · saídas ${moeda(v.saidas)}`);
  if (p.tipo === 'diferenca') {
    if (v.difEntradas) extras.push(`Entradas: extrato ${moeda(v.entradasExtrato)} × Domínio ${moeda(v.entradasDominio)} (dif. ${moeda(v.difEntradas)})`);
    if (v.difSaidas) extras.push(`Saídas: extrato ${moeda(v.saidasExtrato)} × Domínio ${moeda(v.saidasDominio)} (dif. ${moeda(v.difSaidas)})`);
  }
  if (p.tipo === 'conciliar') extras.push(`Saldo: ${moeda(v.saldo)}`);
  if ((p.tipo === 'encerrada' || p.tipo === 'verificar_encerrada') && v.saldo !== undefined) extras.push(`Saldo no Domínio: ${moeda(v.saldo)}`);
  const botaoEncerrar = p.tipo === 'verificar_encerrada' && p.codi ? `<button type="button" class="cb-link" style="margin:0;" data-encerrar="${p.codi}">Marcar como encerrada</button>` : '';
  if (p.tipo === 'vincular' && p.meses) extras.push(`Extratos de ${listaMeses(p.meses)} — escolha a conta na tabela abaixo`);
  const arquivos = (p.arquivos || []).map(htmlArquivo).join(' ');
  return `<li style="--cor:${cor}">
    <div>
      ${p.conta ? `<div class="conta">${esc(p.conta)}</div>` : ''}
      <div class="titulo">${esc(p.texto)}</div>
      ${extras.length || arquivos || botaoEncerrar ? `<div class="extra">${extras.map((x) => `<span>${esc(x)}</span>`).join('')}${arquivos}${botaoEncerrar}</div>` : ''}
    </div>
  </li>`;
}

function painelContas(r) {
  const meses = Array.from({ length: r.mesLimite }, (_, i) => i + 1);
  if (!r.contas.length && !r.naoIdentificadas.length) {
    return '<div class="painel"><h2>Conta corrente mês a mês</h2><p class="estado-vazio">Nenhuma conta bancária com movimento no Domínio nem extrato OFX na pasta.</p></div>';
  }
  const ORIGEM = { valores: 'ligado pelos valores', nome: 'ligado pelo nome do banco', unica: 'única conta', manual: 'ligado à mão' };
  const linhas = r.contas.map((c) => {
    const ofx = c.chavesOfx.map((k) => `OFX banco ${esc(k.banco)} · conta ${esc(k.conta || '?')} (${esc(ORIGEM[k.origem] || k.origem)}) <button type="button" class="cb-link" data-trocar="${esc(k.chave)}">trocar</button>`).join('<br>');
    return `<tr>
      <td><div class="cb-nome">${esc(c.nome)}</div><div class="cb-vinculo">Conta ${c.codi}${ofx ? ` · ${ofx}` : ' · sem OFX na pasta'}</div>${htmlEncerramento(c, r.ano)}</td>
      ${c.meses.map((mm) => `<td><button type="button" class="cb-celula st-${mm.status}" data-conta="${c.codi}" data-mes="${mm.m}" title="${esc(STATUS[mm.status].dica)}" ${mm.status === 'sem_movimento' || mm.status === 'encerrada' ? 'tabindex="-1"' : ''}>${esc(STATUS[mm.status].curto)}</button></td>`).join('')}
    </tr>`;
  });
  const opcoes = (r.contasDominio || []).map((c) => `<option value="${c.codi}">${c.codi} — ${esc(c.nome)}${c.grupo === 'aplicacao' ? ' (aplicação)' : ''}</option>`).join('');
  r.naoIdentificadas.forEach((n) => {
    linhas.push(`<tr>
      <td><div class="cb-nome">${esc(n.instituicao || `Banco ${n.banco}`)} · conta ${esc(n.conta || '?')}</div>
        <div class="cb-vinculo">Qual conta do Domínio é esta?<br>
          <select data-vincular="${esc(n.chave)}" aria-label="Conta do Domínio para este extrato">
            <option value="">Escolha a conta...</option>${opcoes}<option value="ignorar">Ignorar este extrato</option>
          </select></div></td>
      ${n.meses.map((mm) => `<td>${mm.ofx ? `<button type="button" class="cb-celula st-nao_identificada" data-nao-ident="${esc(n.chave)}" data-mes="${mm.m}" title="${esc(STATUS.nao_identificada.dica)}">Vincular</button>` : '<span class="cb-celula st-sem_movimento">—</span>'}</td>`).join('')}
    </tr>`);
  });
  return `
    <div class="painel">
      <div class="painel-cabecalho"><div><h2>Conta corrente mês a mês</h2><p class="subtitulo-painel" style="margin:2px 0 0;">Entradas e saídas do OFX × débitos e créditos da conta no Domínio. Clique num mês para ver os valores.</p></div></div>
      <div class="cb-legenda">${ORDEM_LEGENDA.map((s) => `<span title="${esc(STATUS[s].dica)}"><i class="st-${s}"></i>${esc(STATUS[s].rotulo)}</span>`).join('')}</div>
      <div class="cb-grade-wrap"><table class="cb-grade">
        <thead><tr><th>Conta</th>${meses.map((m) => `<th>${MESES[m - 1]}</th>`).join('')}</tr></thead>
        <tbody>${linhas.join('')}</tbody>
      </table></div>
    </div>`;
}

/** Situação de encerramento da conta na grade (encerrada, suspeita ou botão para marcar). */
function htmlEncerramento(c, ano) {
  if (c.grupo && c.grupo !== 'banco') return '';
  const e = c.encerramento;
  if (e) {
    const quando = e.mes === 0 ? `antes de ${ano}` : `${MESES[e.mes - 1].toLowerCase()}/${ano}`;
    const fonte = { manual: 'marcada pela equipe', dominio: 'inativada no Domínio', arquivo: 'pelo arquivo de encerramento' }[e.origem] || '';
    return `<div class="cb-aviso-conta" title="${esc(e.arquivo || '')}">Encerrada · último mês ${esc(quando)} (${esc(fonte)})</div>
      <div class="cb-vinculo">${e.origem === 'manual' ? `<button type="button" class="cb-link" style="margin:0;" data-desencerrar="${c.codi}">desfazer</button>` : `<button type="button" class="cb-link" style="margin:0;" data-encerrar="${c.codi}">corrigir o mês</button>`}</div>`;
  }
  const suspeita = c.suspeita ? `<div class="cb-aviso-conta suspeita">${c.suspeita.motivo === 'planilha' ? 'Planilha fala em encerramento' : 'Parada e com saldo'}: foi encerrada?</div>` : '';
  return `${suspeita}<div class="cb-vinculo"><button type="button" class="cb-link" style="margin:0;" data-encerrar="${c.codi}">marcar como encerrada</button></div>`;
}

function abrirEncerrar(codi) {
  const r = estado.ficha.resultado;
  const c = r.contas.find((x) => x.codi === codi);
  if (!c) return;
  const atual = c.encerramento && c.encerramento.mes !== undefined ? c.encerramento.mes : null;
  const opcoes = [`<option value="${r.ano - 1}-12">Antes de ${r.ano} (sem movimento no ano)</option>`]
    .concat(Array.from({ length: Math.max(r.mesLimite, 1) }, (_, i) => i + 1)
      .map((m) => `<option value="${r.ano}-${String(m).padStart(2, '0')}">${MESES_LONGOS[m - 1]} de ${r.ano}</option>`));
  $('encerrar-mes').innerHTML = opcoes.join('');
  const ultimoComMovimento = [...c.meses].reverse().find((mm) => ['ok', 'lancado_sem_ofx', 'diferenca', 'falta_importar'].includes(mm.status));
  const sugerido = atual !== null ? atual : (ultimoComMovimento ? ultimoComMovimento.m : 0);
  $('encerrar-mes').value = sugerido === 0 ? `${r.ano - 1}-12` : `${r.ano}-${String(sugerido).padStart(2, '0')}`;
  $('encerrar-conta').textContent = `${c.nome} (conta ${c.codi} no Domínio)`;
  $('form-encerrar').dataset.codi = codi;
  abrirModal('modal-encerrar');
}

async function salvarEncerramento(codi, mes) {
  try {
    await apiFetch(`/conferencia-bancaria/empresas/${estado.ficha.id}/encerramentos`, { method: 'PUT', body: { codi_cta: codi, mes } });
    notificar(mes ? 'Conta marcada como encerrada. Conferindo de novo...' : 'Encerramento desfeito. Conferindo de novo...', 'info');
    await conferirEmpresa(estado.ficha.id, null);
  } catch (err) {
    notificar(err.message, 'erro');
  }
}

$('form-encerrar').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  fecharModal('modal-encerrar');
  await salvarEncerramento(Number(ev.target.dataset.codi), $('encerrar-mes').value);
});

function painelAplicacoes(r) {
  const docs = (r.outrosArquivos || []).filter((a) => a.tipo !== 'extrato');
  if (!r.aplicacoes.length && !docs.length) return '';
  const linhas = r.aplicacoes.map((a) => `<tr>
      <td><div class="cb-nome">${esc(a.nome)}</div><div class="cb-sub">Conta ${a.codi}</div></td>
      <td>${esc(TIPO_CONTA[a.grupo] || a.grupo)}</td>
      <td class="cb-num">${moeda(a.saldoInicial)}</td>
      <td class="cb-num">${moeda(a.saldoFinal)}</td>
      <td>${a.ultimoMes ? MESES_LONGOS[a.ultimoMes - 1] : '<span class="cb-sub">nenhum no ano</span>'}</td>
      <td>${a.mesesSemLancamento.length ? `<span class="badge badge-a_vencer">${esc(listaMeses(a.mesesSemLancamento))}</span>` : '<span class="cb-sub">—</span>'}</td>
    </tr>`).join('');
  const TIPO_DOC = { aplicacao: 'Aplicação', emprestimo: 'Empréstimo', cartao: 'Cartão', desconto: 'Desconto' };
  return `
    <div class="painel">
      <div class="painel-cabecalho"><div><h2>Aplicações, empréstimos e cartões</h2><p class="subtitulo-painel" style="margin:2px 0 0;">Saldos no Domínio. "Sem lançamento" = meses com saldo e nenhum lançamento (até o último mês com banco lançado).</p></div></div>
      ${r.aplicacoes.length ? `<div class="tabela-wrap"><table>
        <thead><tr><th>Conta</th><th>Tipo</th><th>Saldo em 01/01</th><th>Saldo atual</th><th>Último lançamento</th><th>Sem lançamento</th></tr></thead>
        <tbody>${linhas}</tbody></table></div>` : ''}
      ${docs.length ? `<details class="cb-detalhes" style="margin-top:var(--space-4);"><summary>Documentos de aplicação, empréstimo e cartão na pasta (${docs.length})</summary>
        <div class="cb-org"><ul>${docs.map((d) => `<li>${esc(TIPO_DOC[d.tipo] || d.tipo)}${d.mes ? ` · ${MESES[d.mes - 1]}` : ''}: ${htmlArquivo(d.arquivo)}</li>`).join('')}</ul></div></details>` : ''}
    </div>`;
}

function painelOrganizacao(r) {
  const o = r.organizacao;
  const blocos = [];
  if (o.duplicados.length) blocos.push({ titulo: `Arquivos repetidos (${o.duplicados.length})`, dica: 'Mesmo extrato em mais de um arquivo. Confira e apague a cópia (ou, se for o mês errado, falta o extrato certo).', itens: o.duplicados.map((g) => g.map(htmlArquivo).join(' = ')) });
  if (o.ofxPastaErrada.length) blocos.push({ titulo: `Extrato na pasta de outro mês (${o.ofxPastaErrada.length})`, dica: 'O OFX é de um mês, mas está guardado na pasta de outro.', itens: o.ofxPastaErrada.map((x) => `${htmlArquivo(x.arquivo)} → é de ${esc(x.mesDoExtrato)}`) });
  if (o.nomeMesDiferente.length) blocos.push({ titulo: `Nome com mês diferente da pasta (${o.nomeMesDiferente.length})`, itens: o.nomeMesDiferente.map(htmlArquivo) });
  if (o.soltos.length) blocos.push({ titulo: `Arquivos soltos na pasta do ano (${o.soltos.length})`, dica: 'Deveriam estar dentro da pasta do mês ("AAAA MM").', itens: o.soltos.map(htmlArquivo) });
  if (o.pastasForaPadrao.length) blocos.push({ titulo: `Pastas fora do padrão "AAAA MM" (${o.pastasForaPadrao.length})`, itens: o.pastasForaPadrao.map((p) => esc(p)) });
  if (o.errosLeitura.length) blocos.push({ titulo: `OFX que não abriram (${o.errosLeitura.length})`, itens: o.errosLeitura.map((x) => `${htmlArquivo(x.arquivo)} — ${esc(x.erro)}`) });
  const corpo = blocos.length
    ? `<div class="cb-org">${blocos.map((b) => `<div><h3>${esc(b.titulo)}</h3>${b.dica ? `<p class="dica">${esc(b.dica)}</p>` : ''}<ul>${b.itens.map((i) => `<li>${i}</li>`).join('')}</ul></div>`).join('')}</div>`
    : '<p class="cb-vazio">Pasta organizada: nenhum arquivo solto, repetido ou fora do lugar.</p>';
  return `
    <div class="painel">
      <div class="painel-cabecalho"><div><h2>Organização da pasta</h2><p class="subtitulo-painel" style="margin:2px 0 0;">Só aponta — nada é movido ou apagado. Clique no nome do arquivo para copiar o caminho.</p></div></div>
      ${corpo}
    </div>`;
}

function painelSemLancamento(r) {
  const itens = r.semLancamento || [];
  if (!itens.length) return '';
  const nomes = new Map((r.contasDominio || []).map((c) => [c.codi, c.nome]));
  return `
    <div class="painel">
      <details class="cb-detalhes"><summary>Linhas do extrato importado que não viraram lançamento (${itens.length}${itens.length >= 400 ? '+' : ''})</summary>
        <p class="subtitulo-painel">Normalmente são transferências entre contas da própria empresa, lançadas pela outra conta. Confira se alguma ficou esquecida.</p>
        <div class="tabela-wrap"><table>
          <thead><tr><th>Data</th><th>Conta</th><th>Histórico</th><th>Valor</th></tr></thead>
          <tbody>${itens.map((i) => `<tr>
            <td>${esc(formatarDataBR(i.data))}</td><td>${esc(nomes.get(i.codi) || i.codi)}</td><td>${esc(i.historico)}</td>
            <td class="cb-num ${i.entrada ? 'cb-positivo' : 'cb-negativo'}">${i.entrada ? '+' : '−'} ${moeda(i.valor)}</td></tr>`).join('')}</tbody>
        </table></div>
      </details>
    </div>`;
}

// Eventos da ficha (registrados uma vez; o conteúdo é redesenhado a cada conferência)
(function ligarEventosFicha() {
  const conteudo = $('ficha-conteudo');
  conteudo.addEventListener('click', (ev) => {
    const cel = ev.target.closest('[data-conta][data-mes]');
    if (cel) { abrirDetalheMes(Number(cel.dataset.conta), Number(cel.dataset.mes)); return; }
    const ni = ev.target.closest('[data-nao-ident]');
    if (ni) { abrirDetalheNaoIdentificada(ni.dataset.naoIdent, Number(ni.dataset.mes)); return; }
    const encerrar = ev.target.closest('[data-encerrar]');
    if (encerrar) { abrirEncerrar(Number(encerrar.dataset.encerrar)); return; }
    const desencerrar = ev.target.closest('[data-desencerrar]');
    if (desencerrar) {
      confirmarAcao('Desfazer o encerramento desta conta? O sistema volta a pedir o extrato dela.', 'Desfazer')
        .then((ok) => { if (ok) salvarEncerramento(Number(desencerrar.dataset.desencerrar), null); });
      return;
    }
    const trocar = ev.target.closest('[data-trocar]');
    if (trocar) { trocarVinculo(trocar); return; }
    if (ev.target.closest('#btn-copiar-pedido')) { copiar(textoPedidoCliente(), 'Pedido copiado. Cole no WhatsApp ou no e-mail do cliente.'); return; }
    if (ev.target.closest('#btn-copiar-pendencias')) { copiar(textoPendencias(), 'Lista copiada.'); }
  });
  conteudo.addEventListener('change', async (ev) => {
    const sel = ev.target.closest('select[data-vincular]');
    if (!sel || !sel.value) return;
    await salvarVinculo(sel.dataset.vincular, sel.value === 'ignorar' ? null : Number(sel.value), sel.value === 'auto' ? 'auto' : undefined);
  });
}());

// Copiar caminho (em qualquer lugar da ficha)
document.addEventListener('click', (ev) => {
  const alvo = ev.target.closest('[data-copiar]');
  if (alvo) copiar(alvo.dataset.copiar, 'Caminho copiado. Cole na barra de endereço do Explorador de Arquivos.');
});
document.addEventListener('keydown', (ev) => {
  if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches && ev.target.matches('[data-copiar]')) {
    ev.preventDefault();
    copiar(ev.target.dataset.copiar, 'Caminho copiado.');
  }
});

function trocarVinculo(botao) {
  const r = estado.ficha.resultado;
  const opcoes = (r.contasDominio || []).map((c) => `<option value="${c.codi}">${c.codi} — ${esc(c.nome)}${c.grupo === 'aplicacao' ? ' (aplicação)' : ''}</option>`).join('');
  const span = document.createElement('span');
  span.innerHTML = `<select data-vincular="${esc(botao.dataset.trocar)}" aria-label="Trocar a conta deste extrato"><option value="">Escolha...</option>${opcoes}<option value="auto">Deixar o sistema escolher</option><option value="ignorar">Ignorar este extrato</option></select>`;
  botao.replaceWith(span);
  span.querySelector('select').focus();
}

async function salvarVinculo(chave, codi, modo) {
  try {
    await apiFetch(`/conferencia-bancaria/empresas/${estado.ficha.id}/vinculos`, { method: 'PUT', body: { chave_ofx: chave, codi_cta: modo === 'auto' ? 'auto' : codi } });
    notificar('Conta ligada. Conferindo de novo...', 'info');
    await conferirEmpresa(estado.ficha.id, null);
  } catch (err) {
    notificar(err.message, 'erro');
  }
}

function linhaValores(rotulo, ofx, dom, imp) {
  const dif = ofx !== null && dom !== null && Math.abs(ofx - dom) > 0.011;
  return `<tr><td>${rotulo}</td><td>${ofx === null ? '—' : moeda(ofx)}</td><td class="${dif ? 'cb-negativo' : ''}">${dom === null ? '—' : moeda(dom)}</td><td>${imp === null ? '—' : moeda(imp)}</td></tr>`;
}

function abrirDetalheMes(codi, m) {
  const r = estado.ficha.resultado;
  const c = r.contas.find((x) => x.codi === codi);
  if (!c) return;
  const mm = c.meses[m - 1];
  const st = STATUS[mm.status];
  $('modal-mes-titulo').textContent = `${c.nome} — ${MESES_LONGOS[m - 1]} de ${r.ano}`;
  const ofx = mm.ofx;
  const imp = mm.imp;
  const arquivos = [...(ofx ? ofx.arquivos : []), ...(mm.outros || [])];
  $('modal-mes-corpo').innerHTML = `
    <p style="margin:0 0 var(--space-4);"><span class="cb-celula st-${mm.status}" style="cursor:default;">${esc(st.rotulo)}</span> <span class="cb-sub">${esc(st.dica)}</span></p>
    <table class="cb-modal-tabela">
      <thead><tr><th></th><th>Extrato (OFX)</th><th>Domínio (razão)</th><th>Importado no Domínio</th></tr></thead>
      <tbody>
        ${linhaValores('Entradas', ofx ? ofx.ent : null, mm.dom.deb, imp ? imp.ent : null)}
        ${linhaValores('Saídas', ofx ? ofx.sai : null, mm.dom.cre, imp ? imp.sai : null)}
        <tr><td>Movimentos</td><td>${ofx ? ofx.qtd : '—'}</td><td>${mm.dom.qtd}</td><td>${imp ? imp.qtd : '—'}</td></tr>
      </tbody>
    </table>
    <p class="cb-sub" style="margin-top:var(--space-3);">Saldo da conta no Domínio no fim do mês: <strong>${moeda(mm.saldo)}</strong>${imp && imp.semLanc ? ` · ${imp.semLanc} linha(s) importada(s) sem lançamento` : ''}</p>
    ${arquivos.length ? `<div class="cb-modal-arquivos"><strong>Arquivos</strong>${arquivos.map(htmlArquivo).join('')}</div>` : '<p class="cb-sub">Nenhum arquivo desta conta na pasta do mês.</p>'}`;
  abrirModal('modal-mes');
}

function abrirDetalheNaoIdentificada(chave, m) {
  const r = estado.ficha.resultado;
  const n = r.naoIdentificadas.find((x) => x.chave === chave);
  if (!n) return;
  const ofx = n.meses[m - 1].ofx;
  $('modal-mes-titulo').textContent = `${n.instituicao || `Banco ${n.banco}`} · conta ${n.conta || '?'} — ${MESES_LONGOS[m - 1]}`;
  $('modal-mes-corpo').innerHTML = `
    <p class="cb-sub" style="margin:0 0 var(--space-3);">Este extrato não foi ligado a nenhuma conta do Domínio. Escolha a conta na tabela (coluna "Conta") e a conferência roda de novo.</p>
    <table class="cb-modal-tabela"><tbody>
      <tr><td>Entradas</td><td>${moeda(ofx.ent)}</td></tr><tr><td>Saídas</td><td>${moeda(ofx.sai)}</td></tr><tr><td>Movimentos</td><td>${ofx.qtd}</td></tr>
    </tbody></table>
    <div class="cb-modal-arquivos"><strong>Arquivos</strong>${ofx.arquivos.map(htmlArquivo).join('')}</div>`;
  abrirModal('modal-mes');
}

function textoPedidoCliente() {
  const r = estado.ficha.resultado;
  const itens = r.pendencias.filter((p) => p.tipo === 'extrato');
  const linhas = itens.flatMap((p) => (p.contas || [p.conta]).map((conta) => `• ${conta}: ${p.meses.map((m) => MESES_LONGOS[m - 1]).join(', ')}/${r.ano}`));
  return `Olá! Para fecharmos a contabilidade da ${estado.ficha.nome}, precisamos dos extratos bancários abaixo (de preferência em OFX, e também em PDF):\n\n${linhas.join('\n')}\n\nObrigado!`;
}

function textoPendencias() {
  const r = estado.ficha.resultado;
  const partes = [`${estado.ficha.nome} — conferência bancária ${r.ano} (até ${MESES_LONGOS[r.mesLimite - 1]})`];
  GRUPOS_PENDENCIA.forEach((g) => {
    const itens = r.pendencias.filter((p) => g.tipos.includes(p.tipo));
    if (!itens.length) return;
    partes.push('', `${g.titulo}:`);
    itens.forEach((p) => partes.push(`- ${p.conta ? `${p.conta}: ` : ''}${p.texto}`));
  });
  return partes.join('\n');
}

// ------------------------------------------------------------------
// Correção do cadastro (código do Domínio e pasta)
// ------------------------------------------------------------------
let pastasCarregadas = false;
async function abrirCorrecao() {
  const e = estado.ficha;
  $('cad-codigo').value = e.codigo_dominio || '';
  $('cad-pasta').value = e.pasta || '';
  abrirModal('modal-cadastro');
  if (!pastasCarregadas) {
    try {
      const pastas = await apiFetch('/conferencia-bancaria/pastas');
      $('lista-pastas').innerHTML = pastas.map((p) => `<option value="${esc(p)}">`).join('');
      pastasCarregadas = true;
    } catch (err) { notificar(err.message, 'erro'); }
  }
}

$('form-cadastro').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const e = estado.ficha;
  const body = {};
  const codigo = $('cad-codigo').value.trim();
  const pasta = $('cad-pasta').value.trim();
  if (String(e.codigo_dominio || '') !== codigo) body.codigo_dominio = codigo ? Number(codigo) : null;
  if ((e.pasta || '') !== pasta) body.pasta = pasta || null;
  const botao = ev.submitter || ev.target.querySelector('[type="submit"]');
  botao.disabled = true;
  try {
    if (Object.keys(body).length) await apiFetch(`/conferencia-bancaria/empresas/${e.id}`, { method: 'PUT', body });
    fecharModal('modal-cadastro');
    await abrirFicha(e.id, false);
    if (estado.ficha.codigo_dominio && estado.ficha.pasta) await conferirEmpresa(e.id, $('btn-conferir-agora'));
  } catch (err) {
    notificar(err.message, 'erro');
  } finally {
    botao.disabled = false;
  }
});

// ------------------------------------------------------------------
// Início
// ------------------------------------------------------------------
(function iniciar() {
  const params = new URL(window.location.href).searchParams;
  const anoUrl = Number(params.get('ano'));
  if (anoUrl && anoUrl <= new Date().getFullYear() && anoUrl >= new Date().getFullYear() - 3) estado.ano = anoUrl;
  preencherAnos();
  montarLegenda();
  const id = Number(params.get('empresa'));
  if (id) {
    // A lista também carrega (para voltar rápido e para o mês limite)
    carregarLista();
    abrirFicha(id, false);
  } else {
    carregarLista();
  }
})();
