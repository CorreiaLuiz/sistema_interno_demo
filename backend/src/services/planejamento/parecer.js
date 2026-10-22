/**
 * Planejamento tributário — parecer em PDF com a identidade da Privilege.
 *
 *   gerarPdf({ resultado, respostas, versao, destino, aprovacao }) → caminho do PDF
 *     versao 'interno' : rascunho para a equipe (marca d'água, premissas, alertas, campo de aprovação)
 *     versao 'cliente' : só depois de aprovado — sem termos técnicos, com "revisado por"
 *
 * O PDF é impresso pelo Edge (ou Chrome) do próprio Windows, sem instalar nada.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');

const NAVEGADORES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];

const brl = (v) => (v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }));
const pct = (v) => (v == null ? '—' : (v * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cnpjFmt = (c) => c.replace(/^(\w{2})(\w{3})(\w{3})(\w{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const mesAno = (m) => { const [a, b] = m.split('-'); return `${['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'][b - 1]}/${a}`; };

const LOGO = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'logo-300.png')).toString('base64');

const COMPONENTES = [
  ['das', 'DAS (Simples)'], ['irpj', 'IRPJ'], ['csll', 'CSLL'], ['pis_cofins', 'PIS/COFINS'],
  ['icms', 'ICMS'], ['iss', 'ISS'], ['inss_patronal', 'INSS patronal'],
];

// Recomendacao por regras fixas (auditavel)
function recomendar(r) {
  const atual = r.regimes_2026[0];
  const melhor = r.melhor_2026;
  const itens = [];
  let principal;
  const economia = melhor ? melhor.economia_vs_atual : 0;
  const relevante = economia > Math.max(10000, atual.total * 0.05);
  if (melhor && melhor.regime !== atual.regime && relevante) {
    principal = `Avaliar a migração para o <b>${esc(melhor.regime)}</b>, com economia estimada de <b>${brl(economia)} por ano</b> (${pct(economia / atual.total)} do imposto atual).`;
    itens.push('A troca de regime só vale a partir de janeiro do ano seguinte (exclusão do Simples por opção e escolha do novo regime no início do ano).');
    itens.push('Considerar também o custo das obrigações acessórias do novo regime (SPED Fiscal, EFD-Contribuições, ECD/ECF).');
  } else if (melhor && melhor.regime !== atual.regime) {
    principal = `Manter o <b>Simples Nacional</b>. O ${esc(melhor.regime)} seria ${brl(economia)}/ano mais barato, diferença pequena demais para compensar o aumento de obrigações e o risco das estimativas.`;
  } else {
    principal = `Manter o <b>Simples Nacional</b>: é o regime de menor carga tributária para a empresa hoje.`;
  }
  const h = r.reforma_2027;
  const ganhoClientes = h.credito_para_clientes.hibrido - h.credito_para_clientes.puro;
  let reforma;
  if (!h.credito_para_clientes.clientes_aproveitam) {
    reforma = 'Para 2027, manter o <b>Simples "puro"</b> (IBS/CBS dentro do DAS): os clientes não aproveitam crédito, então o regime híbrido só aumentaria o custo.';
  } else if (ganhoClientes > h.custo_extra_hibrido && !r.respostas_formulario) {
    reforma = 'Para 2027, a escolha entre o Simples "puro" e o <b>Simples híbrido</b> depende de para quem a empresa vende e do regime dos clientes. Com as premissas padrão o híbrido poderia compensar — confirmar com o questionário do cliente.';
  } else if (ganhoClientes > h.custo_extra_hibrido) {
    reforma = `Para 2027, <b>avaliar o Simples híbrido</b> (IBS/CBS fora do DAS): custa ${brl(h.custo_extra_hibrido)}/ano a mais para a empresa, mas gera ${brl(ganhoClientes)}/ano a mais de crédito para os clientes empresas, o que pode ser repassado no preço ou evitar perda de clientes.`;
  } else {
    reforma = `Para 2027, manter o <b>Simples "puro"</b>: o híbrido custaria ${brl(h.custo_extra_hibrido)}/ano a mais e o crédito extra gerado aos clientes (${brl(ganhoClientes)}/ano) não compensa.`;
  }
  if (!r.respostas_formulario) itens.push('O cliente ainda não respondeu o formulário: a análise da Reforma usa premissas padrão (50% das vendas para empresas).');
  return { principal, reforma, itens };
}

function montarHtml(r, resp, { versao = 'interno', aprovacao = null } = {}) {
  const cliente = versao === 'cliente';
  const rec = recomendar(r);
  if (cliente) rec.itens = rec.itens.filter((i) => !/formulário/.test(i));
  const b = r.base_anual;
  // Lucro Real fora da recomendação (lucro estimado/prejuízo): o cliente não vê; a equipe vê com aviso
  const realFora = r.regimes_2026.some((g) => g.na_recomendacao === false);
  const regimes = cliente ? r.regimes_2026.filter((g) => g.na_recomendacao !== false) : r.regimes_2026;
  const maxTotal = Math.max(...regimes.map((x) => x.total || 0));
  const melhorNome = r.melhor_2026 && r.melhor_2026.regime;
  const linhas = COMPONENTES.filter(([k]) => regimes.some((x) => x[k] > 0));
  const hoje = new Date();
  const anexos = [r.simples.anexo_mercadoria, r.simples.anexo_servico].filter(Boolean).map((a) => ['', 'I', 'II', 'III', 'IV', 'V'][a]).join(' e ');
  const h = r.reforma_2027;
  const respLinhas = resp ? [
    ['Para quem vende', resp.publico], ['Regime dos clientes', resp.regime_clientes], ['Regime dos fornecedores', resp.fornecedores],
    ['Faturamento previsto (12 meses)', brl(resp.faturamento_previsto)], ['Crescimento esperado', resp.crescimento],
    ['Margem de lucro estimada', resp.margem_estimada_pct ? resp.margem_estimada_pct + '%' : '—'], ['Planos para a folha', resp.folha_planos],
    ['Sócio em outra empresa', resp.socio_outra_empresa], ['Mercado', resp.mercado], ['Investimentos previstos', resp.investimentos],
    ['Observações', resp.observacoes],
  ].filter(([, v]) => v) : [];

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Planejamento Tributário - ${esc(r.empresa)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap');
  @page { size: A4; margin: 12mm 0 14mm; }
  @page :first { margin-top: 0; }
  :root { --bordo: #660000; --bordo-esc: #430A0D; --preto: #180608; --dourado: #C99B59; --terracota: #B3714A; --creme: #F7F1E7; --texto: #2B1B1C; --suave: #6B5B55; --linha: #EADFD0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: 'Inter', 'Segoe UI', Arial, sans-serif; color: var(--texto); font-size: 10.3pt; line-height: 1.5; margin: 0; }
  .pagina { padding: 0 14mm; }
  .rascunho { position: fixed; top: 42%; left: 0; right: 0; text-align: center; transform: rotate(-30deg); font-family: 'Montserrat', sans-serif; font-size: 70pt; color: rgba(179,113,74,.09); font-weight: 800; letter-spacing: 6px; z-index: -1; }
  header { background: linear-gradient(120deg, var(--preto) 0%, var(--bordo-esc) 55%, var(--bordo) 100%); color: #fff; padding: 11mm 14mm 9mm; display: flex; align-items: center; gap: 14px; border-bottom: 4px solid var(--dourado); margin-bottom: 7mm; }
  header .logo { width: 54px; height: 54px; border-radius: 50%; background: #fff; padding: 3px; flex: none; }
  header .logo img { width: 100%; height: 100%; display: block; }
  header .titulo { flex: 1; }
  header .marca { font-family: 'Montserrat', sans-serif; font-size: 8.5pt; letter-spacing: 3.5px; color: var(--dourado); font-weight: 700; }
  header h1 { font-family: 'Montserrat', sans-serif; font-size: 20pt; margin: 2px 0 0; font-weight: 800; letter-spacing: -.2px; }
  header .data { text-align: right; font-size: 8.5pt; color: #E9D9C2; }
  .empresa { font-family: 'Montserrat', sans-serif; font-size: 12.5pt; font-weight: 700; color: var(--bordo); margin: 0; }
  .empresa-sub { color: var(--suave); font-size: 9pt; margin: 1px 0 0; }
  h2 { font-family: 'Montserrat', sans-serif; font-size: 10.5pt; text-transform: uppercase; letter-spacing: 1.4px; color: var(--terracota); margin: 20px 0 8px; padding-bottom: 4px; border-bottom: 1px solid var(--linha); }
  .muted { color: var(--suave); font-size: 8.8pt; }
  .caixa { background: var(--creme); border-left: 4px solid var(--bordo); padding: 11px 14px; margin: 8px 0; border-radius: 0 6px 6px 0; }
  .caixa p { margin: 4px 0; }
  .caixa b { color: var(--bordo); }
  table { width: 100%; border-collapse: collapse; margin: 6px 0; font-size: 9.6pt; }
  th, td { padding: 5px 8px; border-bottom: 1px solid #F0E8DC; text-align: right; }
  th:first-child, td:first-child { text-align: left; }
  thead th { background: var(--bordo); color: #fff; font-weight: 600; font-family: 'Montserrat', sans-serif; font-size: 8.8pt; }
  tr.total td { font-weight: 700; border-top: 2px solid var(--bordo); }
  td.melhor { background: #FBF5EA; }
  thead th.melhor { background: var(--dourado); color: var(--preto); }
  .barras { margin: 8px 0 10px; }
  .barra { display: flex; align-items: center; margin: 5px 0; }
  .barra span.nome { width: 170px; font-size: 9.3pt; }
  .barra .trilho { flex: 1; background: #F4EEE5; height: 15px; border-radius: 3px; }
  .barra .valor { height: 15px; background: #C9B8A6; border-radius: 3px; }
  .barra .valor.melhor { background: var(--bordo); }
  .barra span.num { width: 125px; text-align: right; font-size: 9.3pt; padding-left: 6px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 3px 20px; }
  .grid div { display: flex; justify-content: space-between; border-bottom: 1px dotted var(--linha); padding: 3px 0; }
  .grid b { color: var(--texto); }
  ul { margin: 4px 0; padding-left: 18px; }
  li { margin: 2px 0; }
  li::marker { color: var(--dourado); }
  .alerta li { color: #8C1D18; }
  .aprovacao { margin-top: 22px; border: 1px solid var(--linha); border-top: 3px solid var(--dourado); padding: 10px 14px; border-radius: 4px; font-size: 9.3pt; background: #FFFCF7; }
  .aprovacao .linha { margin-top: 26px; border-top: 1px solid var(--suave); width: 60%; padding-top: 2px; color: var(--suave); }
  footer { margin-top: 14px; font-size: 8pt; color: #8A7B72; border-top: 1px solid var(--linha); padding-top: 6px; }
  table, .grid, .caixa, .aprovacao, .barras, ul { break-inside: avoid; }
  h2 { break-after: avoid; }
</style></head><body>
${cliente ? '' : '<div class="rascunho">RASCUNHO</div>'}
<header>
  <div class="logo"><img src="${LOGO}" alt=""></div>
  <div class="titulo"><div class="marca">PRIVILEGE CONTABILIDADE</div><h1>Planejamento Tributário</h1></div>
  <div class="data">${hoje.toLocaleDateString('pt-BR')}</div>
</header>
<div class="pagina">
<p class="empresa">${esc(r.empresa)}</p>
<p class="empresa-sub">CNPJ ${cnpjFmt(r.cnpj)} · ${esc(r.uf)} · base ${mesAno(r.periodo.inicio)} a ${mesAno(r.periodo.fim)} (dados do sistema contábil Domínio${r.respostas_formulario ? ' e respostas do cliente' : ''}) · valores anuais estimados</p>

<h2>Recomendação</h2>
<div class="caixa"><p>${rec.principal}</p><p>${rec.reforma}</p></div>
${rec.itens.length ? `<ul>${rec.itens.map((i) => `<li>${i}</li>`).join('')}</ul>` : ''}

<h2>Comparativo anual dos regimes</h2>
<div class="barras">${regimes.map((x) => `<div class="barra"><span class="nome">${esc(x.regime)}</span><div class="trilho">${x.total != null ? `<div class="valor ${x.regime === melhorNome ? 'melhor' : ''}" style="width:${(100 * x.total / maxTotal).toFixed(1)}%"></div>` : ''}</div><span class="num">${x.total != null ? `${brl(x.total)} (${pct(x.carga_sobre_receita)})` : 'não calculado'}</span></div>`).join('')}</div>
<table><thead><tr><th>Tributo</th>${regimes.map((x) => `<th class="${x.regime === melhorNome ? 'melhor' : ''}">${esc(x.regime)}</th>`).join('')}</tr></thead><tbody>
${linhas.map(([k, nome]) => `<tr><td>${nome}</td>${regimes.map((x) => `<td class="${x.regime === melhorNome ? 'melhor' : ''}">${x.total == null ? '—' : brl(x[k] || 0)}</td>`).join('')}</tr>`).join('')}
<tr class="total"><td>Total</td>${regimes.map((x) => `<td class="${x.regime === melhorNome ? 'melhor' : ''}">${brl(x.total)}</td>`).join('')}</tr>
<tr><td>% da receita</td>${regimes.map((x) => `<td class="${x.regime === melhorNome ? 'melhor' : ''}">${pct(x.carga_sobre_receita)}</td>`).join('')}</tr>
</tbody></table>
${!cliente && realFora ? '<p class="muted">Lucro Real: valor apenas indicativo, fora da recomendação (veja os pontos de atenção).</p>' : ''}

<h2>Dados da empresa (12 meses)</h2>
<div class="grid">
  <div><span>Receita bruta</span><b>${brl(b.rbt12)}</b></div>
  <div><span>Simples atual</span><b>Anexo ${anexos}, faixa ${r.simples.faixa}</b></div>
  ${b.receita.mercadoria ? `<div><span>Venda de mercadorias</span><b>${brl(b.receita.mercadoria)}</b></div>` : ''}
  ${b.receita.mercadoria_st ? `<div><span>Mercadorias com ICMS-ST</span><b>${brl(b.receita.mercadoria_st)}</b></div>` : ''}
  ${b.receita.servico ? `<div><span>Prestação de serviços</span><b>${brl(b.receita.servico)}</b></div>` : ''}
  <div><span>Alíquota efetiva do Simples</span><b>${pct(r.simples.aliquota_efetiva)}</b></div>
  <div><span>Pró-labore</span><b>${brl(b.pro_labore)}</b></div>
  <div><span>Salários (CLT)</span><b>${brl(b.salarios_clt)}</b></div>
  <div><span>Fator R</span><b>${pct(b.fator_r)}</b></div>
  <div><span>Lucro antes do IR (Lucro Real)</span><b>${brl(b.lucro_antes_ir_real)}</b></div>
</div>
${cliente ? '' : `<p class="muted">Lucro considerado no Lucro Real: ${esc(b.fonte_lucro)}.</p>`}

<h2>Reforma Tributária — 2027</h2>
<table><thead><tr><th></th><th>Simples "puro"</th><th>Simples híbrido</th></tr></thead><tbody>
<tr><td>DAS</td><td>${brl(h.simples_puro.total)}</td><td>${brl(h.simples_hibrido.das)}</td></tr>
<tr><td>CBS/IBS recolhidos fora do DAS</td><td>—</td><td>${brl(h.simples_hibrido.cbs_ibs)}</td></tr>
<tr class="total"><td>Custo para a empresa</td><td>${brl(h.simples_puro.total)}</td><td>${brl(h.simples_hibrido.total)}</td></tr>
<tr><td>Crédito gerado aos clientes empresas</td><td>${brl(h.credito_para_clientes.puro)}</td><td>${brl(h.credito_para_clientes.hibrido)}</td></tr>
</tbody></table>
<p class="muted">Vendas a empresas consideradas: ${pct(h.credito_para_clientes.pct_vendas_pj)}. Alíquotas de CBS/IBS de 2027 ainda são estimativas.</p>

${respLinhas.length ? `<h2>Respostas do cliente</h2><div class="grid">${respLinhas.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>` : ''}

${!cliente && r.alertas.length ? `<h2>Pontos de atenção</h2><ul class="alerta">${r.alertas.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
${!cliente && r.premissas.length ? `<h2>Premissas do cálculo</h2><ul>${r.premissas.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}

${cliente
  ? `<div class="aprovacao"><b>Análise revisada</b>${aprovacao ? ` por ${esc(aprovacao.por)} em ${new Date(aprovacao.em).toLocaleDateString('pt-BR')}` : ''} — Privilege Contabilidade e Consultoria. Em caso de dúvidas, fale com a nossa equipe.</div>`
  : `<div class="aprovacao"><b>Aprovação do contador</b> — este documento é um rascunho gerado automaticamente e só deve ser enviado ao cliente após revisão.
  <div class="linha">Assinatura / data</div></div>`}
<footer>Estimativa elaborada com base nos dados escriturados no sistema Domínio e nas informações prestadas pelo cliente. Os valores não substituem a apuração oficial dos tributos e podem variar conforme a legislação e os dados efetivos do período.</footer>
</div>
</body></html>`;
}

const executar = promisify(execFile);

/** Gera o PDF em `destino` (pasta criada se faltar) e devolve o caminho. */
async function gerarPdf({ resultado, respostas = null, versao = 'interno', destino, aprovacao = null }) {
  const nav = NAVEGADORES.find((p) => fs.existsSync(p));
  if (!nav) throw new Error('Edge/Chrome não encontrado para gerar o PDF.');
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'parecer-'));
  const html = path.join(temp, 'parecer.html');
  fs.writeFileSync(html, montarHtml(resultado, respostas, { versao, aprovacao }), 'utf8');
  try {
    await executar(nav, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', `--user-data-dir=${path.join(temp, 'perfil')}`,
      `--print-to-pdf=${path.resolve(destino)}`, 'file:///' + html.replace(/\\/g, '/')], { timeout: 90000, windowsHide: true });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
  if (!fs.existsSync(destino)) throw new Error('O PDF do parecer não foi gerado.');
  return destino;
}

module.exports = { gerarPdf, montarHtml, recomendar };
