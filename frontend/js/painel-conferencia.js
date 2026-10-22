/**
 * Painel da conferência bancária: resumo do escritório, situação mês a mês,
 * carteira por responsável, maiores diferenças em R$ e contas encerradas.
 * Os números vêm das conferências já gravadas (/conferencia-bancaria/painel).
 */
exigirLogin();
inicializarShell();

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
// Ordem de baixo para cima na coluna (e na legenda)
const SERIES = [
  { chave: 'conferido', rotulo: 'Conferido', cor: 'var(--pb-conferido)' },
  { chave: 'importar', rotulo: 'Falta importar', cor: 'var(--pb-importar)' },
  { chave: 'extrato', rotulo: 'Falta extrato', cor: 'var(--pb-extrato)' },
  { chave: 'diferenca', rotulo: 'Diferença', cor: 'var(--pb-diferenca)' }
];
const MOTIVOS = {
  manual: 'Marcada pela equipe', dominio: 'Inativada no Domínio', arquivo: 'Arquivo de encerramento',
  planilha: 'Planilha fala em encerramento', parada: 'Parada e com saldo'
};

const $ = (id) => document.getElementById(id);
const estado = { ano: new Date().getFullYear(), responsavel: '', dados: null, aba: 'todas' };

const usuario = getUsuario();
if (usuario && !pode('conferencia_bancaria.usar')) {
  $('painel-conteudo').innerHTML = '<div class="painel"><p class="estado-vazio">O painel bancário é do setor Contábil. Peça acesso ao administrador.</p></div>';
  throw new Error('sem acesso');
}

const moeda = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const moedaCurta = (v) => {
  const n = Math.abs(v);
  if (n >= 1e6) return `R$ ${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (n >= 1e3) return `R$ ${(v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil`;
  return moeda(v);
};
const numero = (v) => Number(v || 0).toLocaleString('pt-BR');
const linkFicha = (id) => `/pages/conferencia-bancaria.html?empresa=${encodeURIComponent(id)}&ano=${estado.ano}`;

// ------------------------------------------------------------------
// Dica (tooltip) — montada com textContent: nomes vêm de dados
// ------------------------------------------------------------------
const dica = $('pb-dica');
function mostrarDica(evento, titulo, linhas) {
  dica.replaceChildren();
  const t = document.createElement('div');
  t.className = 'titulo';
  t.textContent = titulo;
  dica.appendChild(t);
  for (const l of linhas) {
    const linha = document.createElement('div');
    linha.className = 'linha';
    const chave = document.createElement('i');
    chave.className = 'chave';
    chave.style.background = l.cor || 'transparent';
    const valor = document.createElement('strong');
    valor.textContent = l.valor;
    const rotulo = document.createElement('span');
    rotulo.textContent = l.rotulo;
    linha.append(chave, rotulo, valor);
    dica.appendChild(linha);
  }
  dica.style.display = 'block';
  posicionarDica(evento);
}
function posicionarDica(evento) {
  const alvo = evento.currentTarget || evento.target;
  let x; let y;
  if (evento.clientX !== undefined && evento.type !== 'focus') { x = evento.clientX; y = evento.clientY; } else {
    const r = alvo.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top;
  }
  const w = dica.offsetWidth; const h = dica.offsetHeight;
  dica.style.left = `${Math.min(window.innerWidth - w - 8, Math.max(8, x + 14))}px`;
  dica.style.top = `${Math.max(8, y - h - 12)}px`;
}
const esconderDica = () => { dica.style.display = 'none'; };

// ------------------------------------------------------------------
// Carregar
// ------------------------------------------------------------------
async function carregar() {
  const conteudo = $('painel-conteudo');
  conteudo.classList.add('pb-carregando');
  try {
    const q = new URLSearchParams({ ano: estado.ano });
    if (estado.responsavel) q.set('responsavel', estado.responsavel);
    const d = await apiFetch(`/conferencia-bancaria/painel?${q}`);
    if (!d) return;
    estado.dados = d;
    montarFiltros(d);
    renderizar();
  } catch (err) {
    notificar(err.message, 'erro');
  } finally {
    conteudo.classList.remove('pb-carregando');
  }
}

function montarFiltros(d) {
  const anos = [...new Set([new Date().getFullYear(), ...d.anos])].sort((a, b) => b - a);
  $('pb-ano').innerHTML = anos.map((a) => `<option value="${a}">${a}</option>`).join('');
  $('pb-ano').value = String(estado.ano);
  $('pb-responsavel').innerHTML = '<option value="">Todos os responsáveis</option>'
    + d.responsaveis.map((r) => `<option value="${esc(r)}">${esc(nomeResponsavel(r))}</option>`).join('');
  $('pb-responsavel').value = estado.responsavel;
  $('pb-link-conferencia').href = `/pages/conferencia-bancaria.html?ano=${estado.ano}`;
}

$('pb-ano').addEventListener('change', () => { estado.ano = Number($('pb-ano').value); salvarUrl(); carregar(); });
$('pb-responsavel').addEventListener('change', () => { estado.responsavel = $('pb-responsavel').value; salvarUrl(); carregar(); });

function salvarUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set('ano', estado.ano);
  if (estado.responsavel) url.searchParams.set('responsavel', estado.responsavel); else url.searchParams.delete('responsavel');
  history.replaceState(null, '', url);
}

function renderizar() {
  const d = estado.dados;
  $('pb-quando').textContent = d.mesLimite
    ? `${d.ano}, de janeiro a ${MESES_LONGOS[d.mesLimite - 1]}${d.responsavel ? ` · ${nomeResponsavel(d.responsavel)}` : ''}. Números das conferências já feitas (extrato da pasta × Domínio).`
    : `${d.ano}: ainda não há mês fechado para conferir.`;
  renderizarKpis(d);
  renderizarMeses(d);
  renderizarResponsaveis(d);
  renderizarRanking(d);
  renderizarContas(d);
}

// ------------------------------------------------------------------
// Resumo (números)
// ------------------------------------------------------------------
function renderizarKpis(d) {
  const t = d.totais;
  const pct = t.conferidas ? Math.round((t.emDia / t.conferidas) * 100) : 0;
  const encerradasComSaldo = d.contas.filter((c) => c.situacao === 'encerrada' && Math.abs(c.saldo) > 0.01);
  const tiles = [
    { rotulo: 'Empresas conferidas', valor: `${numero(t.conferidas)} de ${numero(t.empresas)}`, detalhe: t.naoConferidas ? `${t.naoConferidas} sem conferência (falta código ou pasta)` : 'todas conferidas' },
    { rotulo: 'Com diferença', valor: numero(t.comDiferenca), detalhe: 'extrato não bate com o Domínio', cor: 'var(--pb-diferenca)' },
    { rotulo: 'Falta importar', valor: numero(t.faltaImportar), detalhe: 'extrato na pasta, sem lançamento', cor: 'var(--pb-importar)' },
    { rotulo: 'Falta extrato', valor: numero(t.faltaExtrato), detalhe: 'pedir ao cliente', cor: 'var(--pb-extrato)' },
    { rotulo: 'Diferenças em R$', valor: moedaCurta(t.somaDiferencas), detalhe: `soma de ${numero(d.totalEmpresasComDiferencaEmReais)} empresa(s)` },
    { rotulo: 'Contas encerradas com saldo', valor: numero(encerradasComSaldo.length), detalhe: `${numero(d.contas.filter((c) => c.situacao === 'suspeita').length)} suspeita(s) de encerramento` }
  ];
  $('pb-kpis').innerHTML = `
    <div class="pb-kpi heroi">
      <div class="rotulo">Empresas em dia</div>
      <div class="valor">${pct}%</div>
      <div class="detalhe">${numero(t.emDia)} de ${numero(t.conferidas)} conferidas sem pendência</div>
      <div class="pb-meter" role="img" aria-label="${pct}% das empresas em dia"><span style="width:${pct}%"></span></div>
    </div>
    ${tiles.map((k) => `
      <div class="pb-kpi">
        <div class="rotulo">${k.cor ? `<span class="marca" style="background:${k.cor}"></span>` : ''}${esc(k.rotulo)}</div>
        <div class="valor">${esc(k.valor)}</div>
        <div class="detalhe">${esc(k.detalhe)}</div>
      </div>`).join('')}`;
}

// ------------------------------------------------------------------
// Colunas empilhadas: situação mês a mês
// ------------------------------------------------------------------
function escalaLimpa(max) {
  if (max <= 0) return { topo: 10, passo: 5 };
  const bruto = max / 4;
  const potencia = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 2.5, 5, 10].map((f) => f * potencia).find((p) => p >= bruto);
  return { topo: Math.ceil(max / passo) * passo, passo };
}

function renderizarMeses(d) {
  $('pb-legenda-meses').innerHTML = SERIES.map((s) => `<span><i style="background:${s.cor}"></i>${esc(s.rotulo)}</span>`).join('');
  const alvo = $('pb-grafico-meses');
  if (!d.porMes.length) { alvo.innerHTML = '<p class="estado-vazio">Nenhum mês fechado neste ano.</p>'; $('pb-tabela-meses').innerHTML = ''; return; }
  const totais = d.porMes.map((m) => SERIES.reduce((s, x) => s + m[x.chave], 0));
  const { topo, passo } = escalaLimpa(Math.max(...totais));
  const ticks = [];
  for (let v = 0; v <= topo; v += passo) ticks.push(v);
  const altura = 240;
  const px = (v) => (v / topo) * (altura - 22); // espaço para o total em cima

  alvo.innerHTML = `
    <div class="pb-colunas">
      <div class="pb-eixo-y" aria-hidden="true">${ticks.map((v) => `<span style="bottom:${px(v)}px">${numero(v)}</span>`).join('')}</div>
      <div class="pb-area">
        ${ticks.slice(1).map((v) => `<div class="pb-grid" style="bottom:${px(v)}px"></div>`).join('')}
        <div class="pb-meses">
          ${d.porMes.map((m, i) => `
            <div class="pb-mes" tabindex="0" data-i="${i}" aria-label="${MESES_LONGOS[m.m - 1]}: ${SERIES.map((s) => `${s.rotulo} ${m[s.chave]}`).join(', ')}">
              <div class="pb-total">${totais[i] ? numero(totais[i]) : ''}</div>
              <div class="pb-pilha">${SERIES.filter((s) => m[s.chave] > 0).map((s) => `<div style="height:${Math.max(px(m[s.chave]) - 2, 1)}px; background:${s.cor}"></div>`).join('')}</div>
            </div>`).join('')}
        </div>
      </div>
      <div class="pb-rotulos-x" aria-hidden="true">${d.porMes.map((m) => `<span>${MESES[m.m - 1]}</span>`).join('')}</div>
    </div>`;

  alvo.querySelectorAll('.pb-mes').forEach((el) => {
    const m = d.porMes[Number(el.dataset.i)];
    const linhas = SERIES.slice().reverse().map((s) => ({ cor: s.cor, rotulo: s.rotulo, valor: numero(m[s.chave]) }));
    const abrir = (ev) => mostrarDica(ev, `${MESES_LONGOS[m.m - 1]} de ${d.ano} · ${numero(totais[Number(el.dataset.i)])} empresa(s)`, linhas);
    el.addEventListener('pointerenter', abrir);
    el.addEventListener('pointermove', posicionarDica);
    el.addEventListener('pointerleave', esconderDica);
    el.addEventListener('focus', abrir);
    el.addEventListener('blur', esconderDica);
  });

  $('pb-tabela-meses').innerHTML = d.porMes.map((m) => `<tr><td>${MESES_LONGOS[m.m - 1]}</td>${SERIES.map((s) => `<td class="pb-num">${numero(m[s.chave])}</td>`).join('')}</tr>`).join('');
}

// ------------------------------------------------------------------
// Por responsável
// ------------------------------------------------------------------
function renderizarResponsaveis(d) {
  const partes = [
    { chave: 'emDia', rotulo: 'Em dia', cor: 'var(--pb-conferido)' },
    { chave: 'comPendencia', rotulo: 'Com pendência', cor: 'var(--pb-importar)' },
    { chave: 'naoConferidas', rotulo: 'Não conferida', cor: 'var(--pb-nao-conferida)' }
  ];
  const tbody = $('pb-tabela-resp');
  if (!d.porResponsavel.length) { tbody.innerHTML = '<tr><td colspan="6" class="estado-vazio">Nenhuma empresa.</td></tr>'; return; }
  tbody.innerHTML = d.porResponsavel.map((r, i) => `
    <tr>
      <td><strong>${esc(r.responsavel === '—' ? 'Sem responsável' : nomeResponsavel(r.responsavel))}</strong></td>
      <td class="pb-num">${numero(r.empresas)}</td>
      <td><div class="pb-empilhada" tabindex="0" data-i="${i}" aria-label="${partes.map((p) => `${p.rotulo} ${r[p.chave]}`).join(', ')}">
        ${partes.filter((p) => r[p.chave] > 0).map((p) => `<div style="flex:${r[p.chave]}; background:${p.cor}"></div>`).join('')}
      </div><div class="cb-sub" style="font-size:var(--text-xs); color:var(--color-text-muted); margin-top:3px;">${numero(r.emDia)} em dia · ${numero(r.comPendencia)} com pendência</div></td>
      <td class="pb-num">${numero(r.diferenca)}</td>
      <td class="pb-num">${numero(r.importar)}</td>
      <td class="pb-num">${numero(r.extrato)}</td>
    </tr>`).join('');
  tbody.querySelectorAll('.pb-empilhada').forEach((el) => {
    const r = d.porResponsavel[Number(el.dataset.i)];
    const abrir = (ev) => mostrarDica(ev, `${r.responsavel === '—' ? 'Sem responsável' : nomeResponsavel(r.responsavel)} · ${numero(r.empresas)} empresa(s)`, partes.map((p) => ({ cor: p.cor, rotulo: p.rotulo, valor: numero(r[p.chave]) })));
    el.addEventListener('pointerenter', abrir);
    el.addEventListener('pointermove', posicionarDica);
    el.addEventListener('pointerleave', esconderDica);
    el.addEventListener('focus', abrir);
    el.addEventListener('blur', esconderDica);
  });
}

// ------------------------------------------------------------------
// Ranking das diferenças em R$
// ------------------------------------------------------------------
function renderizarRanking(d) {
  const lista = $('pb-ranking');
  $('pb-sub-dif').textContent = d.totalEmpresasComDiferencaEmReais > d.diferencas.length
    ? `As ${d.diferencas.length} maiores de ${numero(d.totalEmpresasComDiferencaEmReais)} empresas com diferença. Soma das diferenças de entradas e saídas entre o extrato e o Domínio. Clique para abrir a empresa.`
    : 'Soma das diferenças de entradas e saídas entre o extrato e o Domínio, por empresa. Clique para abrir a empresa.';
  if (!d.diferencas.length) { lista.innerHTML = '<li class="estado-vazio" style="display:block;">Nenhuma diferença em R$ neste filtro.</li>'; return; }
  const max = d.diferencas[0].soma;
  lista.innerHTML = d.diferencas.map((x) => `
    <li>
      <div class="nome"><a href="${linkFicha(x.id)}" title="${esc(x.nome)}">${esc(x.nome)}</a>
        <small>${esc(x.contas.join(', '))} · ${x.meses} mês(es)${x.responsavel ? ` · ${esc(nomeResponsavel(x.responsavel))}` : ''}</small></div>
      <div class="pb-trilha"><div class="pb-barra" style="width:calc((100% - 96px) * ${(x.soma / max).toFixed(4)})"></div><span class="valor">${esc(moedaCurta(x.soma))}</span></div>
    </li>`).join('');
}

// ------------------------------------------------------------------
// Contas encerradas e suspeitas
// ------------------------------------------------------------------
$('pb-abas-contas').addEventListener('click', (ev) => {
  const aba = ev.target.closest('[data-aba]');
  if (!aba) return;
  estado.aba = aba.dataset.aba;
  document.querySelectorAll('#pb-abas-contas .pb-aba').forEach((b) => b.setAttribute('aria-pressed', String(b === aba)));
  renderizarContas(estado.dados);
});

function renderizarContas(d) {
  let contas = d.contas;
  if (estado.aba === 'encerrada_saldo') contas = contas.filter((c) => c.situacao === 'encerrada' && Math.abs(c.saldo) > 0.01);
  if (estado.aba === 'suspeita') contas = contas.filter((c) => c.situacao === 'suspeita');
  const tbody = $('pb-tabela-contas');
  if (!contas.length) { tbody.innerHTML = '<tr><td colspan="5" class="estado-vazio">Nenhuma conta neste filtro.</td></tr>'; return; }
  tbody.innerHTML = contas.map((c) => {
    const quando = c.mes === null || c.mes === undefined ? '' : (c.mes === 0 ? (c.situacao === 'encerrada' ? ` · antes de ${d.ano}` : ` · sem movimento em ${d.ano}`) : ` · ${c.situacao === 'encerrada' ? 'último mês' : 'parada desde'} ${MESES_LONGOS[c.mes - 1]}`);
    const detalhe = c.situacao === 'suspeita' && c.detalhe ? `<div class="cb-sub" style="font-size:var(--text-xs); color:var(--color-text-muted);">"${esc(c.detalhe)}"</div>` : '';
    return `<tr>
      <td><a class="link-empresa" href="${linkFicha(c.id)}">${esc(c.empresa)}</a>${c.responsavel ? `<div style="font-size:var(--text-xs); color:var(--color-text-muted);">${esc(nomeResponsavel(c.responsavel))}</div>` : ''}</td>
      <td>${esc(c.conta)}<div style="font-size:var(--text-xs); color:var(--color-text-muted);">conta ${c.codi}</div></td>
      <td><span class="pb-situacao ${c.situacao}">${c.situacao === 'encerrada' ? 'Encerrada' : 'Suspeita'}</span></td>
      <td>${esc(MOTIVOS[c.motivo] || c.motivo)}${esc(quando)}${detalhe}</td>
      <td class="pb-num">${moeda(c.saldo)}</td>
    </tr>`;
  }).join('');
}

// ------------------------------------------------------------------
(function iniciar() {
  const p = new URL(window.location.href).searchParams;
  const ano = Number(p.get('ano'));
  if (ano >= 2015 && ano <= new Date().getFullYear()) estado.ano = ano;
  estado.responsavel = p.get('responsavel') || '';
  carregar();
})();
