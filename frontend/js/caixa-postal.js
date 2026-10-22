exigirLogin();
inicializarShell();

const usuarioLogado = getUsuario();
if (usuarioLogado && !pode('caixa_postal.usar')) {
  window.location.href = '/pages/dashboard.html';
}

const $ = (id) => document.getElementById(id);
let empresas = [];
let configurado = false;
let verificando = false;
const abertas = new Set(); // empresas com a lista de mensagens expandida

const dataBR = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '');
const dataHoraBR = (v) => (v ? new Date(v).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');
const hojeISO = () => new Date().toISOString().slice(0, 10);

function filtradas() {
  const filtro = $('busca').value.trim().toLowerCase();
  const digitos = filtro.replace(/\D/g, '');
  return empresas.filter((e) =>
    (!filtro || e.razao_social.toLowerCase().includes(filtro) || (digitos.length >= 3 && e.cnpj.replace(/\D/g, '').includes(digitos)))
    && (!$('so-novas').checked || e.nao_lidas > 0));
}

function celulaNaoLidas(e) {
  if (e.erro) return `<span class="cp-erro">${esc(e.erro)}</span>`;
  if (e.nao_lidas === null || e.nao_lidas === undefined) return '<span class="cp-sub">—</span>';
  if (!e.nao_lidas) return '<span class="cp-num zero">Nenhuma</span>';
  return `<span class="cp-num">${e.nao_lidas}${e.nao_lidas >= 50 ? '+' : ''}</span>`;
}

function linhaMensagens(e) {
  const msgs = e.mensagens || [];
  if (!msgs.length) return '';
  return `<tr class="cp-detalhe"><td colspan="4"><ul class="cp-msgs">${msgs.map((m) => {
    const cienciaProxima = m.ciencia_em && m.ciencia_em >= hojeISO();
    return `<li>
      <div class="assunto">${m.relevante ? '<span class="badge badge-vencida">Relevante</span> ' : ''}${esc(m.assunto || '(sem assunto)')}
        ${m.origem ? `<div class="cp-sub">${esc(m.origem)}${m.anexos ? ' · com anexo' : ''}</div>` : ''}</div>
      <div class="datas">enviada em ${dataBR(m.enviada_em)}${m.ciencia_em ? `<br>${cienciaProxima ? '<strong>' : ''}ciência automática em ${dataBR(m.ciencia_em)}${cienciaProxima ? '</strong>' : ''}` : ''}</div>
      <button type="button" class="btn btn-secundario btn-sm" data-abrir="${esc(m.isn)}" data-empresa="${e.id}">Abrir</button>
    </li>`;
  }).join('')}</ul></td></tr>`;
}

function renderizar() {
  const lista = filtradas();
  const tbody = $('tabela');
  if (!lista.length) {
    tbody.innerHTML = `<tr><td colspan="4">${empresas.length ? 'Nenhuma empresa neste filtro.' : 'Nenhuma empresa ativa cadastrada.'}</td></tr>`;
  } else {
    tbody.innerHTML = lista.map((e) => `
      <tr>
        <td><strong>${esc(e.razao_social)}</strong><div class="cp-sub">${esc(e.cnpj)}</div></td>
        <td>${celulaNaoLidas(e)}</td>
        <td>${e.verificado_em ? `${dataHoraBR(e.verificado_em)}${e.verificado_por_nome ? `<div class="cp-sub">por ${esc(e.verificado_por_nome)}</div>` : ''}` : '<span class="cp-sub">nunca</span>'}</td>
        <td><div class="cp-acoes">
          ${(e.mensagens || []).length ? `<button type="button" class="btn btn-secundario btn-sm" data-expandir="${e.id}">${abertas.has(e.id) ? 'Esconder' : 'Ver assuntos'}</button>` : ''}
          <button type="button" class="btn btn-sm" data-verificar="${e.id}" ${configurado && !verificando ? '' : 'disabled'}>Verificar</button>
        </div></td>
      </tr>${abertas.has(e.id) ? linhaMensagens(e) : ''}`).join('');
  }
  tbody.querySelectorAll('[data-expandir]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.expandir;
    if (abertas.has(id)) abertas.delete(id); else abertas.add(id);
    renderizar();
  }));
  tbody.querySelectorAll('[data-verificar]').forEach((b) => b.addEventListener('click', () => verificarUma(b.dataset.verificar, true)));
  tbody.querySelectorAll('[data-abrir]').forEach((b) => b.addEventListener('click', () => abrirMensagem(b.dataset.empresa, b.dataset.abrir)));

  const n = lista.length;
  $('btn-verificar-todas').disabled = !configurado || verificando || !n;
  $('btn-verificar-todas').textContent = n === empresas.length ? `Verificar todas (${n})` : `Verificar as ${n} filtradas`;
}

async function verificarUma(empresaId, sozinha) {
  const empresa = empresas.find((x) => x.id === empresaId);
  if (sozinha) { verificando = true; renderizar(); }
  try {
    const r = await apiFetch(`/caixa-postal/${empresaId}/verificar`, { method: 'POST' });
    Object.assign(empresa, r);
    if (r.nao_lidas > 0) abertas.add(empresaId);
    if (sozinha) notificar(r.erro ? `Não deu para verificar: ${r.erro}` : r.nao_lidas ? `${r.nao_lidas} mensagem(ns) não lida(s).` : 'Nenhuma mensagem nova.', r.erro ? 'erro' : 'sucesso');
  } catch (err) {
    empresa.erro = err.message;
    if (sozinha) notificar(err.message, 'erro');
  } finally {
    if (sozinha) { verificando = false; renderizar(); }
  }
}

$('btn-verificar-todas').addEventListener('click', async () => {
  const lista = filtradas();
  if (!lista.length) return;
  if (!(await confirmarAcao(`Verificar a Caixa Postal de ${lista.length} empresa(s) na Receita? Cada verificação é cobrada pelo SERPRO. Nada é marcado como lido.`, 'Verificar'))) return;
  verificando = true;
  renderizar();
  $('area-progresso').style.display = '';
  for (let i = 0; i < lista.length; i++) {
    $('texto-progresso').textContent = `Verificando… ${i + 1} de ${lista.length} — ${lista[i].razao_social}`;
    await verificarUma(lista[i].id, false);
    $('barra-progresso').style.width = `${Math.round(((i + 1) / lista.length) * 100)}%`;
  }
  verificando = false;
  $('area-progresso').style.display = 'none';
  $('barra-progresso').style.width = '0';
  empresas.sort((a, b) => (b.nao_lidas || 0) - (a.nao_lidas || 0) || a.razao_social.localeCompare(b.razao_social));
  const comNovas = lista.filter((e) => e.nao_lidas > 0).length;
  const comErro = lista.filter((e) => e.erro).length;
  notificar(`Pronto: ${comNovas} empresa(s) com mensagens não lidas${comErro ? `, ${comErro} sem verificar (veja o motivo na lista)` : ''}.`, comErro ? 'erro' : 'sucesso');
  renderizar();
});

async function abrirMensagem(empresaId, isn) {
  const empresa = empresas.find((x) => x.id === empresaId);
  const msg = (empresa.mensagens || []).find((m) => m.isn === isn) || {};
  const aviso = 'Abrir esta mensagem conta como LEITURA na Receita (igual abrir no e-CAC). Se for uma intimação, o prazo começa a contar a partir de agora. A abertura também é cobrada pelo SERPRO. Abrir mesmo assim?';
  if (!(await confirmarAcao(aviso, 'Abrir mensagem'))) return;
  try {
    const m = await apiFetch(`/caixa-postal/${empresaId}/mensagens/${encodeURIComponent(isn)}`, { method: 'POST' });
    $('msg-assunto').textContent = m.assunto || msg.assunto || 'Mensagem';
    $('msg-info').textContent = `${empresa.razao_social} · enviada em ${dataBR(m.enviada_em || msg.enviada_em)}${m.origem ? ' · ' + m.origem : ''}`;
    // Conteúdo vem em HTML da Receita: mostrado isolado (sem scripts); links abrem em outra aba
    $('msg-corpo').srcdoc = `<!doctype html><meta charset="utf-8"><base target="_blank"><body style="font:14px/1.6 system-ui,sans-serif;color:#222;padding:12px;">${m.corpo_html || '<p>(mensagem sem texto)</p>'}</body>`;
    $('modal-mensagem').classList.add('aberto');
    // Saiu das não lidas
    empresa.mensagens = (empresa.mensagens || []).filter((x) => x.isn !== isn);
    empresa.nao_lidas = Math.max((empresa.nao_lidas || 1) - 1, 0);
    renderizar();
  } catch (err) {
    notificar(err.message, 'erro');
  }
}

$('btn-fechar-mensagem').addEventListener('click', () => $('modal-mensagem').classList.remove('aberto'));
$('busca').addEventListener('input', renderizar);
$('so-novas').addEventListener('change', renderizar);

(async () => {
  try {
    const r = await apiFetch('/caixa-postal');
    configurado = !!r.configurado;
    empresas = r.empresas || [];
    $('nao-configurado').style.display = configurado ? 'none' : '';
    renderizar();
  } catch (err) {
    $('tabela').innerHTML = `<tr><td colspan="4">${esc(err.message)}</td></tr>`;
  }
})();
