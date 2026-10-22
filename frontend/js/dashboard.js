exigirLogin();
inicializarShell();

// Cores de status (mesmas dos selos do sistema) — sempre acompanhadas de
// rótulo e número na legenda, nunca só a cor.
const COR_STATUS = {
  critico: 'var(--color-carmine)',
  alerta: 'var(--color-amber)',
  ok: 'var(--color-emerald)',
  neutro: 'var(--color-slate-info)',
  andamento: '#C1651F'
};

const ROTULOS_TIPO_CERTIDAO = {
  federal: 'CND Federal', estadual: 'CND Estadual', municipal: 'CND Municipal',
  trabalhista: 'CND Trabalhista', fgts: 'CRF do FGTS', outra: 'Certidão'
};
const ROTULOS_TIPO_LICENCA = {
  vigilancia_sanitaria: 'Vigilância Sanitária', bombeiros: 'Bombeiros',
  ambiental: 'Licença Ambiental', funcionamento: 'Alvará de Funcionamento', outra: 'Licença'
};

function formatarData(valor) {
  if (!valor) return '—';
  const [ano, mes, dia] = String(valor).slice(0, 10).split('-');
  return `${dia}/${mes}/${ano}`;
}

function plural(n, singular, pluralTexto) {
  return `${n} ${n === 1 ? singular : pluralTexto}`;
}

/**
 * Barra empilhada com a distribuição por status + legenda com os números.
 * itens: [{ rotulo, valor, cor }]
 */
function renderizarDistribuicao(el, itens) {
  const total = itens.reduce((soma, i) => soma + i.valor, 0);
  const segmentos = total
    ? itens.filter((i) => i.valor > 0).map((i) =>
        `<span style="width:${(i.valor / total) * 100}%; background:${i.cor};" title="${esc(i.rotulo)}: ${i.valor}"></span>`
      ).join('')
    : '';
  el.innerHTML = `
    <div class="barra-status" role="img" aria-label="${itens.map((i) => `${esc(i.rotulo)}: ${i.valor}`).join(', ')}">${segmentos}</div>
    <ul class="legenda-status">
      ${itens.map((i) => `
        <li><span class="ponto" style="background:${i.cor};"></span>${esc(i.rotulo)}<strong>${i.valor}</strong></li>
      `).join('')}
    </ul>
  `;
  return total;
}

function preencherKpi(id, numero, detalhe, classeAlerta) {
  document.getElementById(`kpi-${id}`).textContent = numero;
  document.getElementById(`kpi-${id}-detalhe`).textContent = detalhe;
  if (classeAlerta) document.getElementById(`card-kpi-${id}`).classList.add(classeAlerta);
}

async function carregarEmpresas() {
  const [ativas, todas] = await Promise.all([
    apiFetch('/empresas?situacao=ativa&limite=1'),
    apiFetch('/empresas?limite=1')
  ]);
  if (!ativas || !todas) return;
  document.getElementById('kpi-empresas').textContent = ativas.total;
  document.getElementById('kpi-empresas-detalhe').textContent = `${plural(todas.total, 'empresa cadastrada', 'empresas cadastradas')} no total`;
}

async function carregarProcessos() {
  const r = await apiFetch('/processos-legalizacao/resumo/status');
  if (!r) return;
  document.getElementById('kpi-processos').textContent = r.em_andamento || 0;
  document.getElementById('kpi-processos-detalhe').textContent =
    r.exigencia ? `${plural(r.exigencia, 'em exigência', 'em exigência')}` : 'Nenhum em exigência';
  const total = renderizarDistribuicao(document.getElementById('dist-processos'), [
    { rotulo: 'Em andamento', valor: r.em_andamento || 0, cor: COR_STATUS.andamento },
    { rotulo: 'Em exigência', valor: r.exigencia || 0, cor: COR_STATUS.alerta },
    { rotulo: 'Concluídos', valor: r.concluido || 0, cor: COR_STATUS.ok },
    { rotulo: 'Cancelados', valor: r.cancelado || 0, cor: COR_STATUS.neutro }
  ]);
  document.getElementById('total-processos').textContent = plural(total, 'processo registrado', 'processos registrados');
}

function distribuicaoVencimentos(r, rotulos) {
  return [
    { rotulo: rotulos[0], valor: r.valida || 0, cor: COR_STATUS.ok },
    { rotulo: rotulos[1], valor: r.a_vencer || 0, cor: COR_STATUS.alerta },
    { rotulo: rotulos[2], valor: r.vencida || 0, cor: COR_STATUS.critico },
    { rotulo: rotulos[3], valor: r.emissao_pendente || 0, cor: COR_STATUS.neutro }
  ];
}

async function carregarCertidoes() {
  const r = await apiFetch('/certidoes/resumo/status');
  if (!r) return;
  preencherKpi('certidoes', r.vencida || 0,
    r.a_vencer ? `${plural(r.a_vencer, 'vence', 'vencem')} em até 30 dias` : 'Nenhuma vencendo em 30 dias',
    r.vencida ? 'alerta' : (r.a_vencer ? 'aviso' : null));
  const total = renderizarDistribuicao(document.getElementById('dist-certidoes'),
    distribuicaoVencimentos(r, ['Válidas', 'A vencer', 'Vencidas', 'Emissão pendente']));
  document.getElementById('total-certidoes').textContent = plural(total, 'certidão controlada', 'certidões controladas');
}

async function carregarLicencas() {
  const r = await apiFetch('/licencas/resumo/status');
  if (!r) return;
  preencherKpi('licencas', r.vencida || 0,
    r.a_vencer ? `${plural(r.a_vencer, 'vence', 'vencem')} em até 30 dias` : 'Nenhuma vencendo em 30 dias',
    r.vencida ? 'alerta' : (r.a_vencer ? 'aviso' : null));
  const total = renderizarDistribuicao(document.getElementById('dist-licencas'),
    distribuicaoVencimentos(r, ['Válidas', 'A vencer', 'Vencidas', 'Emissão pendente']));
  document.getElementById('total-licencas').textContent = plural(total, 'licença controlada', 'licenças controladas');
}

async function carregarCertificados() {
  const r = await apiFetch('/certificados-digitais/resumo/status');
  if (!r) return;
  const total = renderizarDistribuicao(document.getElementById('dist-certificados'),
    distribuicaoVencimentos(r, ['Válidos', 'A vencer', 'Vencidos', 'Não cadastrados']));
  document.getElementById('total-certificados').textContent = plural(total, 'certificado', 'certificados');
}

/** Lista única com certidões e licenças vencidas / a vencer, das mais urgentes para as menos. */
async function carregarAtencao() {
  const buscas = await Promise.all([
    apiFetch('/certidoes?status=vencida&limite=50'),
    apiFetch('/certidoes?status=a_vencer&limite=50'),
    apiFetch('/licencas?status=vencida&limite=50'),
    apiFetch('/licencas?status=a_vencer&limite=50')
  ]);
  const [cv, ca, lv, la] = buscas.map((r) => (r && r.dados) || []);
  const itens = [
    ...cv.map((c) => ({ ...c, rotuloTipo: ROTULOS_TIPO_CERTIDAO[c.tipo] || c.tipo, link: '/pages/certidoes.html' })),
    ...ca.map((c) => ({ ...c, rotuloTipo: ROTULOS_TIPO_CERTIDAO[c.tipo] || c.tipo, link: '/pages/certidoes.html' })),
    ...lv.map((l) => ({ ...l, rotuloTipo: ROTULOS_TIPO_LICENCA[l.tipo] || l.tipo, link: '/pages/licencas.html' })),
    ...la.map((l) => ({ ...l, rotuloTipo: ROTULOS_TIPO_LICENCA[l.tipo] || l.tipo, link: '/pages/licencas.html' }))
  ].sort((a, b) => String(a.data_validade).localeCompare(String(b.data_validade)));

  const lista = document.getElementById('lista-atencao');
  if (!itens.length) {
    lista.innerHTML = '<li class="estado-vazio">Tudo em dia — nenhuma certidão ou licença vencida ou perto de vencer.</li>';
    return;
  }

  const MAXIMO = 8;
  lista.innerHTML = itens.slice(0, MAXIMO).map((i) => `
    <li data-empresa="${esc(i.empresa_id)}" style="cursor:pointer;" title="Abrir a ficha da empresa">
      <span class="empresa">${esc(i.razao_social)}<span class="detalhe">${esc(i.rotuloTipo)}${i.orgao_emissor ? ' · ' + esc(i.orgao_emissor) : ''}</span></span>
      <span class="data">${i.status === 'vencida' ? 'Venceu em' : 'Vence em'} ${formatarData(i.data_validade)}</span>
      <span class="badge badge-${i.status}">${i.status === 'vencida' ? 'Vencida' : 'A vencer'}</span>
    </li>
  `).join('') + (itens.length > MAXIMO
    ? `<li class="estado-vazio" style="padding:var(--space-3) 0 0;">E mais ${itens.length - MAXIMO} — veja nas telas de Certidões e Licenças.</li>`
    : '');
}

/** Pedidos de clientes sem resposta, por setor (só aparece para quem acompanha algum setor). */
async function carregarPedidosCliente() {
  const setores = await apiFetch('/tarefas-setor/pedidos-cliente/resumo');
  if (!setores || !setores.length) return;
  const total = setores.reduce((soma, s) => soma + s.abertos, 0);
  document.getElementById('painel-pedidos-cliente').style.display = '';
  document.getElementById('lista-pedidos-cliente').innerHTML = total
    ? setores.filter((s) => s.abertos).map((s) => `
      <li>
        <span class="empresa"><a class="link-empresa" href="${esc(s.pagina)}">${esc(s.rotulo)}</a><span class="detalhe">${plural(s.abertos, 'pedido aguardando resposta', 'pedidos aguardando resposta')}</span></span>
        <span class="data"><a class="link-acao" href="${esc(s.pagina)}">Responder</a></span>
        <span class="badge badge-a_vencer">${s.abertos}</span>
      </li>`).join('')
    : '<li class="estado-vazio">Nenhum pedido de cliente aguardando resposta.</li>';
}

// Nome da empresa nos itens de "Precisa de atenção" leva à ficha dela
document.getElementById('lista-atencao').addEventListener('click', (e) => {
  const item = e.target.closest('[data-empresa]');
  if (item) window.location.href = `/pages/empresa.html?id=${encodeURIComponent(item.dataset.empresa)}#vencimentos`;
});

Promise.all([
  carregarEmpresas(), carregarProcessos(), carregarCertidoes(),
  carregarLicencas(), carregarCertificados(), carregarAtencao(), carregarPedidosCliente()
]).catch((err) => notificar(err.message, 'erro'));
