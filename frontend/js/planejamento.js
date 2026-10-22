/**
 * Planejamento tributário — lista das análises (última de cada empresa),
 * radar da carteira, detalhe da análise, aprovação, envio ao cliente e
 * questionário por link.
 */
exigirLogin();
inicializarShell();

const usuario = getUsuario();
const $ = (id) => document.getElementById(id);
if (usuario && !pode('planejamento.ver')) {
  document.querySelector('main.conteudo').innerHTML = '<div class="painel"><p class="estado-vazio">O planejamento tributário é dos setores Contábil e Fiscal. Peça acesso ao administrador.</p></div>';
  throw new Error('sem acesso');
}
const ehGestor = pode('planejamento.gerenciar');
document.querySelectorAll('.somente-gestor').forEach((el) => { el.style.display = ehGestor ? '' : 'none'; });

const STATUS = {
  rascunho: { rotulo: 'Rascunho', badge: 'badge-pendente' },
  aprovado: { rotulo: 'Aprovada', badge: 'badge-em_andamento' },
  enviado: { rotulo: 'Enviada', badge: 'badge-concluido' },
  erro: { rotulo: 'Erro', badge: 'badge-vencida' }
};
const QUESTIONARIO = {
  respondido: { rotulo: 'Respondido', badge: 'badge-valida' },
  aguardando: { rotulo: 'Aguardando', badge: 'badge-a_vencer' },
  expirado: { rotulo: 'Expirado', badge: 'badge-vencida' }
};

const estado = { analises: [], filtroKpi: '', mesPadrao: '', detalhe: null, timerRadar: null, cnpjEscolhido: null };

const brl = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }));
const pct = (v) => (v == null ? '—' : (v * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%');
const cnpjFmt = (c) => String(c || '').replace(/^(\w{2})(\w{3})(\w{3})(\w{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const dataBR = (v) => (v ? new Date(v).toLocaleDateString('pt-BR') : '—');
const badge = (mapa, chave) => (mapa[chave] ? `<span class="badge ${mapa[chave].badge}">${esc(mapa[chave].rotulo)}</span>` : '<span class="pt-sub">—</span>');
/** Economia que vale a pena levar ao cliente (mesma regra do parecer). */
const economiaRelevante = (a) => a.economia > Math.max(10000, (a.regime_atual_total || 0) * 0.05) && a.melhor_regime !== 'Simples Nacional (atual)';

function abrirModal(id) { $(id).classList.add('aberto'); }
function fecharModal(id) { $(id).classList.remove('aberto'); }
document.querySelectorAll('.modal-fundo').forEach((fundo) => {
  fundo.addEventListener('click', (e) => { if (e.target === fundo || e.target.closest('[data-fechar-modal]')) fundo.classList.remove('aberto'); });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.querySelectorAll('.modal-fundo.aberto').forEach((m) => m.classList.remove('aberto'));
});

// ---------------- Lista ----------------
async function carregar() {
  try {
    const dados = await apiFetch('/planejamento/analises');
    estado.analises = dados.analises;
    estado.mesPadrao = dados.mesPadrao;
    renderizarKpis();
    renderizarTabela();
    acompanharRadar(dados.radar);
  } catch (err) { notificar(err.message, 'erro'); }
}

function renderizarKpis() {
  const a = estado.analises.filter((x) => x.status !== 'erro');
  const kpis = [
    { chave: '', rotulo: 'Empresas analisadas', numero: a.length, detalhe: 'última análise de cada uma' },
    { chave: 'economia', rotulo: 'Com economia relevante', numero: a.filter(economiaRelevante).length, detalhe: brl(a.filter(economiaRelevante).reduce((s, x) => s + x.economia, 0)) + '/ano no total' },
    { chave: 'rascunho', rotulo: 'Aguardando aprovação', numero: a.filter((x) => x.status === 'rascunho').length, detalhe: 'rascunhos' },
    { chave: 'enviado', rotulo: 'Enviadas ao cliente', numero: a.filter((x) => x.status === 'enviado').length, detalhe: 'com PDF aprovado' },
    { chave: 'hibrido', rotulo: 'Híbrido pode compensar', numero: a.filter((x) => x.hibrido_compensa).length, detalhe: 'Reforma 2027' }
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
  estado.filtroKpi = kpi.dataset.kpi;
  $('filtro').value = estado.filtroKpi;
  renderizarKpis();
  renderizarTabela();
});

function filtradas() {
  const termo = $('busca').value.trim().toLowerCase();
  const soDigitos = termo.replace(/[^0-9a-z]/g, '');
  const filtro = $('filtro').value;
  return estado.analises.filter((a) => {
    if (termo && !(String(a.nome || '').toLowerCase().includes(termo) || (soDigitos && a.cnpj.toLowerCase().includes(soDigitos)) || String(a.codigo_dominio || '') === termo)) return false;
    if (filtro === 'economia') return a.status !== 'erro' && economiaRelevante(a);
    if (filtro === 'hibrido') return a.hibrido_compensa;
    if (filtro) return a.status === filtro;
    return true;
  });
}

function renderizarTabela() {
  const lista = filtradas();
  $('tabela').innerHTML = lista.length ? lista.map((a) => {
    const erro = a.status === 'erro';
    const acoes = [
      { rotulo: 'Ver análise', dataset: { 'pt-ver': a.id } },
      ...(erro ? [] : [{ rotulo: 'Baixar PDF (rascunho)', dataset: { 'pt-pdf': a.id } }]),
      { rotulo: 'Analisar de novo', dataset: { 'pt-reanalisar': a.cnpj } },
      { rotulo: 'Mandar questionário', dataset: { 'pt-questionario': a.cnpj, nome: esc(a.nome || '') } }
    ];
    return `<tr class="pt-linha" data-pt-ver="${a.id}">
      <td><div class="pt-nome">${esc(a.nome || cnpjFmt(a.cnpj))}</div><div class="pt-sub">${cnpjFmt(a.cnpj)}${a.codigo_dominio ? ` · cód. ${a.codigo_dominio}` : ''} · ${dataBR(a.gerado_em)}</div>
        ${erro ? `<div class="pt-erro">${esc(a.erro || '')}</div>` : ''}</td>
      <td class="pt-num">${erro ? '—' : brl(a.receita)}</td>
      <td class="pt-num">${erro ? '—' : `${brl(a.regime_atual_total)}<div class="pt-sub">${pct(a.carga_atual)}</div>`}</td>
      <td>${erro ? '—' : esc(a.melhor_regime || '—')}</td>
      <td class="pt-num">${!erro && economiaRelevante(a) ? `<span class="pt-economia">${brl(a.economia)}</span>` : '<span class="pt-sub">—</span>'}</td>
      <td>${badge(QUESTIONARIO, a.questionario)}</td>
      <td>${badge(STATUS, a.status)}</td>
      <td onclick="event.stopPropagation()">${celulaAcoes(acoes)}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="8" class="estado-vazio">${estado.analises.length ? 'Nenhuma análise com esse filtro.' : 'Nenhuma análise ainda. Use "Analisar empresa" ou o "Radar da carteira".'}</td></tr>`;
  $('contagem').textContent = `${lista.length} de ${estado.analises.length} empresa(s).`;
}
$('busca').addEventListener('input', renderizarTabela);
$('filtro').addEventListener('change', () => { estado.filtroKpi = $('filtro').value; renderizarKpis(); renderizarTabela(); });

$('btn-exportar').addEventListener('click', () => {
  exportarExcel('planejamento-tributario', [
    { titulo: 'Empresa', valor: (a) => a.nome },
    { titulo: 'CNPJ', valor: (a) => cnpjFmt(a.cnpj) },
    { titulo: 'Código Domínio', valor: (a) => a.codigo_dominio },
    { titulo: 'Receita 12 meses', valor: (a) => (a.receita != null ? Math.round(a.receita) : '') },
    { titulo: 'Imposto atual (ano)', valor: (a) => (a.regime_atual_total != null ? Math.round(a.regime_atual_total) : '') },
    { titulo: 'Carga atual', valor: (a) => pct(a.carga_atual) },
    { titulo: 'Regime mais barato', valor: (a) => a.melhor_regime },
    { titulo: 'Economia/ano', valor: (a) => (economiaRelevante(a) ? Math.round(a.economia) : '') },
    { titulo: 'Híbrido 2027 compensa', valor: (a) => (a.hibrido_compensa ? 'Sim' : 'Não') },
    { titulo: 'Questionário', valor: (a) => (QUESTIONARIO[a.questionario] || {}).rotulo || '' },
    { titulo: 'Situação', valor: (a) => (STATUS[a.status] || {}).rotulo || a.status },
    { titulo: 'Analisada em', valor: (a) => dataBR(a.gerado_em) }
  ], filtradas());
});

// Ações (o menu de ações vai para o <body>; por isso a delegação no document)
document.addEventListener('click', (e) => {
  const ver = e.target.closest('[data-pt-ver]');
  const pdf = e.target.closest('[data-pt-pdf]');
  const re = e.target.closest('[data-pt-reanalisar]');
  const q = e.target.closest('[data-pt-questionario]');
  if (pdf) { baixarPdf(pdf.dataset.ptPdf, 'interno'); return; }
  if (re) { analisarCnpj(re.dataset.ptReanalisar); return; }
  if (q) { abrirQuestionario(q.dataset.ptQuestionario, q.dataset.nome); return; }
  if (ver && !e.target.closest('.dropdown-acoes')) abrirDetalhe(ver.dataset.ptVer);
});

async function baixarPdf(id, versao) {
  try {
    notificar('Preparando o PDF...', 'info');
    const resp = await fetch(`${API_BASE}/planejamento/analises/${encodeURIComponent(id)}/pdf?versao=${versao}`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!resp.ok) {
      const j = await resp.json().catch(() => ({}));
      throw new Error(j.erro || 'Não foi possível baixar o PDF.');
    }
    const nome = (/filename\*?=(?:UTF-8'')?"?([^";]+)/i.exec(resp.headers.get('content-disposition') || '') || [])[1];
    const url = URL.createObjectURL(await resp.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = nome ? decodeURIComponent(nome) : `planejamento-${id}.pdf`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) { notificar(err.message, 'erro'); }
}

async function analisarCnpj(cnpj, fim) {
  try {
    notificar('Analisando no Domínio... pode levar alguns segundos.', 'info');
    const a = await apiFetch('/planejamento/analisar', { method: 'POST', body: { cnpj, ...(fim ? { fim } : {}) } });
    if (a.status === 'erro') notificar(`A análise falhou: ${a.erro}`, 'erro');
    else notificar('Análise concluída.', 'sucesso');
    await carregar();
    if (a.status !== 'erro') abrirDetalhe(a.id);
  } catch (err) { notificar(err.message, 'erro'); }
}

// ---------------- Analisar empresa (busca no Domínio) ----------------
let timerBusca = null;
$('btn-analisar').addEventListener('click', () => {
  $('busca-dominio').value = '';
  $('resultados-dominio').style.display = 'none';
  $('resultados-dominio').innerHTML = '';
  $('mes-fim').value = estado.mesPadrao || '';
  estado.cnpjEscolhido = null;
  $('btn-confirmar-analise').disabled = true;
  abrirModal('modal-analisar');
  setTimeout(() => $('busca-dominio').focus(), 50);
});
$('busca-dominio').addEventListener('input', () => {
  clearTimeout(timerBusca);
  estado.cnpjEscolhido = null;
  $('btn-confirmar-analise').disabled = true;
  const termo = $('busca-dominio').value.trim();
  if (termo.length < 2) { $('resultados-dominio').style.display = 'none'; return; }
  timerBusca = setTimeout(async () => {
    try {
      const lista = await apiFetch(`/planejamento/dominio?q=${encodeURIComponent(termo)}`);
      $('resultados-dominio').style.display = '';
      $('resultados-dominio').innerHTML = lista.length ? lista.map((e) => `
        <div class="pt-resultado" data-cnpj="${esc(e.cnpj)}"><span><b>${esc(e.nome)}</b><div class="pt-sub">${cnpjFmt(e.cnpj)} · cód. ${e.codi} · ${esc(e.uf || '')}</div></span></div>`).join('')
        : '<p class="estado-vazio" style="margin:var(--space-3);">Nenhuma empresa encontrada no Domínio.</p>';
    } catch (err) { notificar(err.message, 'erro'); }
  }, 350);
});
$('resultados-dominio').addEventListener('click', (e) => {
  const r = e.target.closest('[data-cnpj]');
  if (!r) return;
  document.querySelectorAll('.pt-resultado.sel').forEach((x) => x.classList.remove('sel'));
  r.classList.add('sel');
  estado.cnpjEscolhido = r.dataset.cnpj;
  $('btn-confirmar-analise').disabled = false;
});
$('form-analisar').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!estado.cnpjEscolhido) return;
  fecharModal('modal-analisar');
  analisarCnpj(estado.cnpjEscolhido, $('mes-fim').value || undefined);
});

// ---------------- Radar ----------------
$('btn-radar').addEventListener('click', async () => {
  const ok = await confirmarAcao('O radar analisa todas as empresas ativas do Simples com movimento nos últimos 12 meses (pode levar vários minutos). Pode continuar usando o sistema enquanto isso.', 'Iniciar radar');
  if (!ok) return;
  try {
    acompanharRadar(await apiFetch('/planejamento/radar', { method: 'POST', body: {} }));
  } catch (err) { notificar(err.message, 'erro'); }
});

function acompanharRadar(r) {
  const caixa = $('radar');
  if (!r || (!r.emAndamento && !r.fim)) { caixa.style.display = 'none'; return; }
  caixa.style.display = '';
  const p = r.total ? Math.round((100 * r.feitos) / r.total) : 0;
  $('radar-barra').style.width = `${p}%`;
  $('radar-texto').textContent = r.emAndamento
    ? `Radar em andamento: ${r.feitos} de ${r.total} empresas (${p}%)${r.atual ? ` — analisando ${r.atual}` : ''}${r.erros ? ` · ${r.erros} com erro` : ''}`
    : `Radar concluído em ${new Date(r.fim).toLocaleString('pt-BR')}: ${r.feitos} empresas analisadas${r.erros ? `, ${r.erros} com erro` : ''}.`;
  clearTimeout(estado.timerRadar);
  if (r.emAndamento) {
    estado.timerRadar = setTimeout(async () => {
      try {
        const novo = await apiFetch('/planejamento/radar');
        if (!novo.emAndamento || novo.feitos % 10 === 0) await carregar();
        else acompanharRadar(novo);
      } catch (err) { /* tenta de novo no próximo ciclo */ acompanharRadar(r); }
    }, 4000);
  }
}

// ---------------- Detalhe ----------------
$('btn-voltar').addEventListener('click', () => {
  $('visao-analise').style.display = 'none';
  $('visao-lista').style.display = '';
  estado.detalhe = null;
  carregar();
});

async function abrirDetalhe(id) {
  try {
    const a = await apiFetch(`/planejamento/analises/${encodeURIComponent(id)}`);
    estado.detalhe = a;
    $('visao-lista').style.display = 'none';
    $('visao-analise').style.display = '';
    renderizarDetalhe(a);
    window.scrollTo(0, 0);
  } catch (err) { notificar(err.message, 'erro'); }
}

function renderizarDetalhe(a) {
  const r = a.resultado || {};
  const erro = a.status === 'erro';
  const botoes = [];
  if (!erro) botoes.push(`<button class="btn btn-secundario" type="button" id="det-pdf">PDF (rascunho)</button>`);
  if (!erro && a.status === 'rascunho' && ehGestor) botoes.push(`<button class="btn" type="button" id="det-aprovar">Aprovar</button>`);
  if (['aprovado', 'enviado'].includes(a.status)) botoes.push(`<button class="btn btn-secundario" type="button" id="det-pdf-cliente">PDF do cliente</button>`);
  if (['aprovado', 'enviado'].includes(a.status) && ehGestor) botoes.push(`<button class="btn" type="button" id="det-enviar">${a.status === 'enviado' ? 'Enviar de novo' : 'Enviar ao cliente'}</button>`);
  botoes.push(`<button class="btn btn-secundario" type="button" id="det-questionario">Mandar questionário</button>`);
  botoes.push(`<button class="btn btn-secundario" type="button" id="det-reanalisar">Analisar de novo</button>`);

  const rec = recomendacaoTexto(r);
  $('det-cabecalho').innerHTML = `
    <div class="pt-cab-linha">
      <div>
        <h2>${esc(a.nome || a.cnpj_formatado)}</h2>
        <div class="pt-sub">CNPJ ${esc(a.cnpj_formatado)}${a.codigo_dominio ? ` · cód. Domínio ${a.codigo_dominio}` : ''}${a.periodo_fim ? ` · 12 meses até ${esc(a.periodo_fim)}` : ''} · analisada em ${new Date(a.gerado_em).toLocaleString('pt-BR')}${a.gerado_por_nome ? ` por ${esc(a.gerado_por_nome)}` : ''} (${esc(a.origem)})</div>
        <div style="margin-top:8px;">${badge(STATUS, a.status)}
          ${a.aprovado_em ? `<span class="pt-sub"> · aprovada por ${esc(a.aprovado_por_nome || '')} em ${dataBR(a.aprovado_em)}</span>` : ''}
          ${a.enviado_em ? `<span class="pt-sub"> · enviada em ${dataBR(a.enviado_em)}${a.envio ? ` para ${esc([a.envio.email, a.envio.telefone].filter(Boolean).join(' / '))}` : ''}</span>` : ''}</div>
      </div>
      <div class="pt-acoes">${botoes.join('')}</div>
    </div>
    ${erro ? `<p class="pt-erro" style="font-size:var(--text-sm);">${esc(a.erro || '')}</p>` : `<div class="pt-recomendacao"><p>${rec.principal}</p><p>${rec.reforma}</p></div>`}`;

  const ligar = (idBotao, fn) => { const b = $(idBotao); if (b) b.addEventListener('click', fn); };
  ligar('det-pdf', () => baixarPdf(a.id, 'interno'));
  ligar('det-pdf-cliente', () => baixarPdf(a.id, 'cliente'));
  ligar('det-aprovar', aprovar);
  ligar('det-enviar', abrirEnvio);
  ligar('det-questionario', () => abrirQuestionario(a.cnpj, a.nome));
  ligar('det-reanalisar', () => { $('btn-voltar').click(); analisarCnpj(a.cnpj); });

  if (erro) { $('det-conteudo').innerHTML = historicoHtml(a); return; }

  const regimes = r.regimes_2026 || [];
  const melhor = r.melhor_2026 && r.melhor_2026.regime;
  const COMP = [['das', 'DAS (Simples)'], ['irpj', 'IRPJ'], ['csll', 'CSLL'], ['pis_cofins', 'PIS/COFINS'], ['icms', 'ICMS'], ['iss', 'ISS'], ['inss_patronal', 'INSS patronal']]
    .filter(([k]) => regimes.some((g) => g[k] > 0));
  const cls = (g) => (g.regime === melhor ? 'melhor' : '');
  const b = r.base_anual || {};
  const h = r.reforma_2027 || {};
  const resp = a.respostas;
  const ROTULOS_RESP = { publico: 'Para quem vende', regime_clientes: 'Regime dos clientes', fornecedores: 'Fornecedores', faturamento_previsto: 'Faturamento previsto', crescimento: 'Crescimento', margem_estimada_pct: 'Margem estimada', folha_planos: 'Planos para a folha', socio_outra_empresa: 'Sócio em outra empresa', mercado: 'Mercado', investimentos: 'Investimentos', observacoes: 'Observações', nome: 'Respondido por', email: 'E-mail' };

  $('det-conteudo').innerHTML = `
    <div class="painel">
      <h3 style="margin-top:0;">Comparativo anual (2026)</h3>
      <div class="tabela-wrap"><table class="pt-tabela">
        <thead><tr><th>Tributo</th>${regimes.map((g) => `<th class="pt-num ${cls(g)}">${esc(g.regime)}</th>`).join('')}</tr></thead>
        <tbody>
          ${COMP.map(([k, nome]) => `<tr><td>${nome}</td>${regimes.map((g) => `<td class="pt-num ${cls(g)}">${g.total == null ? '—' : brl(g[k] || 0)}</td>`).join('')}</tr>`).join('')}
          <tr><td><b>Total</b></td>${regimes.map((g) => `<td class="pt-num ${cls(g)}"><b>${brl(g.total)}</b></td>`).join('')}</tr>
          <tr><td>% da receita</td>${regimes.map((g) => `<td class="pt-num ${cls(g)}">${pct(g.carga_sobre_receita)}</td>`).join('')}</tr>
        </tbody>
      </table></div>
      ${regimes.some((g) => g.na_recomendacao === false) ? '<p class="pt-sub">Lucro Real: valor só indicativo, fora da recomendação (veja os pontos de atenção).</p>' : ''}
    </div>
    <div class="pt-grade2">
      <div class="painel">
        <h3 style="margin-top:0;">Dados da empresa (12 meses)</h3>
        <div class="pt-dados">
          <div><span>Receita bruta</span><b>${brl(b.rbt12)}</b></div>
          <div><span>Mercadorias</span><b>${brl(b.receita && b.receita.mercadoria)}</b></div>
          <div><span>Mercadorias com ST</span><b>${brl(b.receita && b.receita.mercadoria_st)}</b></div>
          <div><span>Serviços</span><b>${brl(b.receita && b.receita.servico)}</b></div>
          <div><span>Simples atual</span><b>Anexo ${[r.simples && r.simples.anexo_mercadoria, r.simples && r.simples.anexo_servico].filter(Boolean).map((n) => ['', 'I', 'II', 'III', 'IV', 'V'][n] || n).join(' e ') || '—'}, faixa ${r.simples ? r.simples.faixa : '—'}</b></div>
          <div><span>Alíquota efetiva</span><b>${pct(r.simples && r.simples.aliquota_efetiva)}</b></div>
          <div><span>Pró-labore</span><b>${brl(b.pro_labore)}</b></div>
          <div><span>Salários (CLT)</span><b>${brl(b.salarios_clt)}</b></div>
          <div><span>Fator R</span><b>${pct(b.fator_r)}</b></div>
          <div><span>Lucro antes do IR</span><b>${brl(b.lucro_antes_ir_real)}</b></div>
        </div>
        <p class="pt-sub">Lucro do Lucro Real: ${esc(b.fonte_lucro || '—')}.</p>
        ${r.simples && r.simples.validacao_dominio ? `<p class="pt-sub">Conferência: o Domínio apurou ${pct(r.simples.validacao_dominio.dominio)} em ${esc(r.simples.validacao_dominio.mes)}; o cálculo deu ${pct(r.simples.validacao_dominio.motor)}.</p>` : ''}
      </div>
      <div class="painel">
        <h3 style="margin-top:0;">Reforma Tributária — 2027</h3>
        ${h.simples_puro ? `<div class="tabela-wrap"><table class="pt-tabela">
          <thead><tr><th></th><th class="pt-num">Simples "puro"</th><th class="pt-num">Simples híbrido</th></tr></thead>
          <tbody>
            <tr><td>DAS</td><td class="pt-num">${brl(h.simples_puro.total)}</td><td class="pt-num">${brl(h.simples_hibrido.das)}</td></tr>
            <tr><td>CBS/IBS fora do DAS</td><td class="pt-num">—</td><td class="pt-num">${brl(h.simples_hibrido.cbs_ibs)}</td></tr>
            <tr><td><b>Custo para a empresa</b></td><td class="pt-num"><b>${brl(h.simples_puro.total)}</b></td><td class="pt-num"><b>${brl(h.simples_hibrido.total)}</b></td></tr>
            <tr><td>Crédito aos clientes empresas</td><td class="pt-num">${brl(h.credito_para_clientes.puro)}</td><td class="pt-num">${brl(h.credito_para_clientes.hibrido)}</td></tr>
          </tbody></table></div>
          <p class="pt-sub">Vendas a empresas consideradas: ${pct(h.credito_para_clientes.pct_vendas_pj)}${h.credito_para_clientes.clientes_aproveitam ? '' : ' · clientes não aproveitam crédito'}.</p>` : '<p class="pt-sub">—</p>'}
      </div>
    </div>
    <div class="pt-grade2">
      <div class="painel">
        <h3 style="margin-top:0;">Pontos de atenção</h3>
        ${(r.alertas || []).length ? `<ul class="pt-lista alerta">${r.alertas.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="pt-sub">Nenhum.</p>'}
        <h3>Premissas do cálculo</h3>
        ${(r.premissas || []).length ? `<ul class="pt-lista">${r.premissas.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="pt-sub">Nenhuma.</p>'}
      </div>
      <div class="painel">
        <h3 style="margin-top:0;">Respostas do cliente</h3>
        ${resp ? `<div class="pt-dados">${Object.entries(ROTULOS_RESP).filter(([k]) => resp[k] !== undefined && resp[k] !== '').map(([k, rot]) =>
          `<div><span>${rot}</span><b>${esc(k === 'faturamento_previsto' ? brl(resp[k]) : k === 'margem_estimada_pct' ? `${resp[k]}%` : resp[k])}</b></div>`).join('')}</div>`
          : '<p class="pt-sub">O cliente ainda não respondeu o questionário. A análise da Reforma usa premissas padrão (50% das vendas para empresas).</p>'}
      </div>
    </div>
    ${historicoHtml(a)}`;
}

/** Mesma regra do parecer em PDF. */
function recomendacaoTexto(r) {
  const atual = (r.regimes_2026 || [])[0] || {};
  const melhor = r.melhor_2026;
  const economia = melhor ? melhor.economia_vs_atual : 0;
  let principal;
  if (melhor && melhor.regime !== atual.regime && economia > Math.max(10000, (atual.total || 0) * 0.05)) {
    principal = `Avaliar a migração para o <b>${esc(melhor.regime)}</b>: economia estimada de <b>${brl(economia)} por ano</b> (${pct(economia / atual.total)} do imposto atual). A troca só vale a partir de janeiro.`;
  } else if (melhor && melhor.regime !== atual.regime) {
    principal = `Manter o <b>Simples Nacional</b>: o ${esc(melhor.regime)} seria só ${brl(economia)}/ano mais barato.`;
  } else {
    principal = 'Manter o <b>Simples Nacional</b>: é o regime de menor carga hoje.';
  }
  const h = r.reforma_2027;
  let reforma = '';
  if (h) {
    const ganho = h.credito_para_clientes.hibrido - h.credito_para_clientes.puro;
    if (!h.credito_para_clientes.clientes_aproveitam) reforma = '2027: manter o Simples "puro" — os clientes não aproveitam crédito.';
    else if (ganho > h.custo_extra_hibrido && !r.respostas_formulario) reforma = '2027: puro x híbrido depende das vendas para empresas — <b>mandar o questionário</b> (com as premissas padrão o híbrido poderia compensar).';
    else if (ganho > h.custo_extra_hibrido) reforma = `2027: <b>avaliar o Simples híbrido</b> — custa ${brl(h.custo_extra_hibrido)}/ano a mais, mas gera ${brl(ganho)}/ano a mais de crédito aos clientes.`;
    else reforma = `2027: manter o Simples "puro" — o híbrido custaria ${brl(h.custo_extra_hibrido)}/ano a mais e o crédito extra aos clientes (${brl(ganho)}) não compensa.`;
  }
  return { principal, reforma };
}

function historicoHtml(a) {
  const hist = a.historico || [];
  const qs = a.questionarios || [];
  return `<div class="pt-grade2">
    <div class="painel">
      <h3 style="margin-top:0;">Histórico de análises</h3>
      ${hist.length ? `<div class="tabela-wrap"><table><thead><tr><th>Data</th><th>Origem</th><th>Situação</th><th>Mais barato</th></tr></thead><tbody>
        ${hist.map((x) => `<tr class="pt-linha" data-pt-ver="${x.id}"><td>${new Date(x.gerado_em).toLocaleString('pt-BR')}${x.id === a.id ? ' <span class="pt-sub">(esta)</span>' : ''}</td><td>${esc(x.origem)}</td><td>${badge(STATUS, x.status)}</td><td>${esc(x.melhor_regime || '—')}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="pt-sub">—</p>'}
    </div>
    <div class="painel">
      <h3 style="margin-top:0;">Questionários enviados</h3>
      ${qs.length ? `<ul class="pt-lista">${qs.map((q) => `<li>${dataBR(q.criado_em)}${q.criado_por ? ` por ${esc(q.criado_por)}` : ''} — ${q.respondido_em ? `<b>respondido em ${dataBR(q.respondido_em)}</b>` : new Date(q.expira_em) < new Date() ? 'expirado' : `aguardando (vale até ${dataBR(q.expira_em)})`}${q.envio ? ` · ${esc([q.envio.email, q.envio.telefone].filter(Boolean).join(' / '))}` : ''}</li>`).join('')}</ul>` : '<p class="pt-sub">Nenhum.</p>'}
    </div>
  </div>`;
}

async function aprovar() {
  const ok = await confirmarAcao('Aprovar gera o PDF do cliente (sem a marca de rascunho e sem os termos técnicos). Confira os números antes.', 'Aprovar');
  if (!ok) return;
  try {
    notificar('Gerando o PDF do cliente...', 'info');
    await apiFetch(`/planejamento/analises/${estado.detalhe.id}/aprovar`, { method: 'POST' });
    notificar('Análise aprovada.', 'sucesso');
    abrirDetalhe(estado.detalhe.id);
  } catch (err) { notificar(err.message, 'erro'); }
}

async function preencherContatos(cnpj, idEmail, idTelefone) {
  $(idEmail).value = '';
  $(idTelefone).value = '';
  try {
    const c = await apiFetch(`/planejamento/contatos/${encodeURIComponent(cnpj)}`);
    $(idEmail).value = c.email || '';
    $(idTelefone).value = c.telefone || '';
  } catch (err) { /* sem sugestão: a equipe preenche */ }
}

async function abrirEnvio() {
  await preencherContatos(estado.detalhe.cnpj, 'env-email', 'env-telefone');
  abrirModal('modal-enviar');
}
$('form-enviar').addEventListener('submit', async (e) => {
  e.preventDefault();
  const botao = e.submitter || e.target.querySelector('[type=submit]');
  botao.disabled = true;
  try {
    const r = await apiFetch(`/planejamento/analises/${estado.detalhe.id}/enviar`, { method: 'POST', body: { email: $('env-email').value, telefone: $('env-telefone').value } });
    fecharModal('modal-enviar');
    const canais = r.envio && r.envio.canais ? Object.entries(r.envio.canais).map(([c, s]) => `${c === 'email' ? 'E-mail' : 'WhatsApp'}: ${s}`).join(' · ') : '';
    notificar(`Enviado. ${canais}`, 'sucesso');
    abrirDetalhe(estado.detalhe.id);
  } catch (err) { notificar(err.message, 'erro'); } finally { botao.disabled = false; }
});

// ---------------- Questionário ----------------
async function abrirQuestionario(cnpj, nome) {
  estado.cnpjQuestionario = cnpj;
  $('q-empresa').innerHTML = `<b>${esc(nome || '')}</b> · CNPJ ${cnpjFmt(cnpj)}`;
  $('q-resultado').style.display = 'none';
  $('q-enviar').checked = true;
  $('btn-gerar-q').disabled = false;
  await preencherContatos(cnpj, 'q-email', 'q-telefone');
  abrirModal('modal-questionario');
}
$('form-questionario').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('btn-gerar-q').disabled = true;
  try {
    const r = await apiFetch('/planejamento/questionarios', {
      method: 'POST',
      body: { cnpj: estado.cnpjQuestionario, enviar: $('q-enviar').checked, email: $('q-email').value, telefone: $('q-telefone').value }
    });
    $('q-link').value = r.link;
    $('q-canais').textContent = r.canais
      ? Object.entries(r.canais).map(([c, s]) => `${c === 'email' ? 'E-mail' : 'WhatsApp'}: ${s}`).join(' · ')
      : 'Link gerado (não enviado). Copie e mande ao cliente.';
    $('q-resultado').style.display = '';
    notificar('Questionário criado.', 'sucesso');
  } catch (err) {
    notificar(err.message, 'erro');
    $('btn-gerar-q').disabled = false;
  }
});
$('btn-copiar').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('q-link').value); notificar('Link copiado.', 'sucesso'); }
  catch (err) { $('q-link').select(); }
});

carregar().then(() => {
  // planejamento.html?analise=123 abre direto o detalhe (links de avisos)
  const id = new URLSearchParams(location.search).get('analise');
  if (id && /^\d+$/.test(id)) abrirDetalhe(id);
});
