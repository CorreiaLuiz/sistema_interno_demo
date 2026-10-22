exigirLogin();
inicializarShell();

// Controle dos e-mails enviados aos clientes: quem abriu, quem baixou e por onde.
const $ = (id) => document.getElementById(id);
const POR_PAGINA = 50;
let pagina = 1;
let emailsCarregados = [];

const dataHora = (v) => (v ? new Date(v).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const ROTULO_ORIGEM = { email: 'E-mail', portal: 'Área do Cliente' };

function parametros() {
  const p = new URLSearchParams({ dias: $('periodo').value, limite: POR_PAGINA, pagina });
  if ($('busca').value.trim()) p.set('busca', $('busca').value.trim());
  if ($('situacao').value) p.set('situacao', $('situacao').value);
  return p;
}

function celulaAbertura(e) {
  if (e.status === 'falhou') {
    return `<span class="ee-sit erro" title="${esc(e.erro || '')}"><span class="ponto"></span>Não entregue</span>
      <span class="ee-sub">${esc((e.erro || '').slice(0, 80))}</span>`;
  }
  if (e.status === 'simulado') return '<span class="ee-sit nao"><span class="ponto"></span>Simulado (e-mail desligado)</span>';
  if (!e.aberto_em) return '<span class="ee-sit nao"><span class="ponto"></span>Ainda não</span>';
  return `<span class="ee-sit ok"><span class="ponto"></span>Abriu</span>
    <span class="ee-sub">${dataHora(e.aberto_em)}${e.aberturas > 1 ? ` · ${e.aberturas} vezes` : ''}</span>`;
}

function celulaDownload(e) {
  if (!e.documentos.length) return '<span class="ee-sub">Sem arquivo</span>';
  if (!e.downloads.length) return '<span class="ee-sit nao"><span class="ponto"></span>Ainda não</span>';
  return e.downloads.map((d) => `
    <div class="ee-download">
      <span class="ee-origem ${d.origem === 'email' ? 'email' : 'portal'}">${ROTULO_ORIGEM[d.origem] || d.origem}</span>${dataHora(d.quando)}
      <span class="ee-sub">${esc(d.documento || '')}${d.origem === 'portal' && d.quem ? ` · por ${esc(d.quem)}` : ''}</span>
    </div>`).join('');
}

function linha(e) {
  return `
    <tr>
      <td style="white-space:nowrap;">${dataHora(e.enviado_em)}<span class="ee-sub">${esc(e.enviado_por_nome || 'automático')}</span></td>
      <td>${e.empresa_id ? linkEmpresa(e.empresa_id, e.empresa_nome) : '—'}</td>
      <td>${esc(e.destinatario)}</td>
      <td class="ee-assunto">${esc(e.assunto || '')}${e.documentos.length ? `<span class="ee-sub">${e.documentos.length} arquivo${e.documentos.length > 1 ? 's' : ''}</span>` : ''}</td>
      <td>${celulaAbertura(e)}</td>
      <td>${celulaDownload(e)}</td>
    </tr>`;
}

function mostrarResumo(r) {
  $('k-total').textContent = r.total;
  $('k-abertos').textContent = r.abertos;
  $('k-abertos-p').textContent = r.total - r.falhou > 0 ? `${Math.round((r.abertos / (r.total - r.falhou)) * 100)}% dos entregues` : ' ';
  $('k-baixados').textContent = r.baixados;
  $('k-nao').textContent = r.nao_abertos;
  $('k-falhou').textContent = r.falhou;
}

async function carregar(acrescentar = false) {
  if (!acrescentar) pagina = 1;
  try {
    const dados = await apiFetch(`/emails-enviados?${parametros()}`);
    $('aviso-local').style.display = dados.somente_rede_local ? '' : 'none';
    mostrarResumo(dados.resumo);
    emailsCarregados = acrescentar ? emailsCarregados.concat(dados.emails) : dados.emails;
    $('tabela-emails').innerHTML = emailsCarregados.length
      ? emailsCarregados.map(linha).join('')
      : `<tr><td colspan="6" style="text-align:center; color:var(--color-text-muted); padding:var(--space-6);">
           Nenhum e-mail encontrado com esses filtros.</td></tr>`;
    $('area-mais').style.display = emailsCarregados.length < dados.total ? '' : 'none';
    iniciarRotulosTabelas();
  } catch (err) {
    $('tabela-emails').innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--color-carmine); padding:var(--space-6);">${esc(err.message)}</td></tr>`;
  }
}

function marcarKpi() {
  document.querySelectorAll('#kpis .kpi').forEach((k) => k.setAttribute('aria-pressed', String(k.dataset.situacao === $('situacao').value)));
}

document.querySelectorAll('#kpis .kpi').forEach((k) => k.addEventListener('click', () => {
  $('situacao').value = k.dataset.situacao;
  marcarKpi();
  carregar();
}));
$('situacao').addEventListener('change', () => { marcarKpi(); carregar(); });
$('periodo').addEventListener('change', () => carregar());
let esperaBusca = null;
$('busca').addEventListener('input', () => { clearTimeout(esperaBusca); esperaBusca = setTimeout(() => carregar(), 350); });
$('btn-mais').addEventListener('click', () => { pagina += 1; carregar(true); });

$('btn-exportar').addEventListener('click', async () => {
  try {
    // Exporta tudo que bate com os filtros (não só o que está na tela)
    const p = parametros();
    p.set('limite', 200);
    let todos = [];
    for (let n = 1; n <= 50; n++) {
      p.set('pagina', n);
      const dados = await apiFetch(`/emails-enviados?${p}`);
      todos = todos.concat(dados.emails);
      if (todos.length >= dados.total || !dados.emails.length) break;
    }
    const downloadsDe = (e, origem) => e.downloads.filter((d) => d.origem === origem).map((d) => dataHora(d.quando)).join(' | ');
    exportarExcel('emails-enviados', [
      { titulo: 'Enviado em', valor: (e) => dataHora(e.enviado_em) },
      { titulo: 'Empresa', valor: (e) => e.empresa_nome },
      { titulo: 'Para', valor: (e) => e.destinatario },
      { titulo: 'Assunto', valor: (e) => e.assunto },
      { titulo: 'Envio', valor: (e) => ({ enviado: 'Entregue ao servidor', simulado: 'Simulado', falhou: 'Falhou' }[e.status] || e.status) },
      { titulo: 'Abriu em', valor: (e) => dataHora(e.aberto_em) },
      { titulo: 'Vezes aberto', valor: (e) => e.aberturas },
      { titulo: 'Baixou pelo e-mail', valor: (e) => downloadsDe(e, 'email') },
      { titulo: 'Baixou pela Área do Cliente', valor: (e) => downloadsDe(e, 'portal') },
      { titulo: 'Enviado por', valor: (e) => e.enviado_por_nome || 'automático' }
    ], todos);
  } catch (err) {
    notificar(err.message, 'erro');
  }
});

// Abre já filtrado por empresa quando vem da ficha (?busca=...)
const buscaInicial = new URLSearchParams(location.search).get('busca');
if (buscaInicial) $('busca').value = buscaInicial;
carregar();
