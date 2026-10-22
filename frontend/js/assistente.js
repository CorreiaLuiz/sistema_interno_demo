/**
 * Assistente "Dúvidas?" — botão no canto da tela que responde como usar o sistema,
 * com o passo a passo e as imagens do manual.
 *
 * Funciona sozinho em qualquer página (basta incluir o script):
 *  - telas da equipe (login da equipe)     → /api/ajuda/equipe/...
 *  - Área do Cliente (login do cliente)    → /api/ajuda/cliente/...
 *  - telas de entrada do cliente (sem login) → só busca no manual do cliente
 */
(function () {
  if (window.__assistenteAjuda) return;
  window.__assistenteAjuda = true;

  const caminho = window.location.pathname;
  const ehCliente = /\/pages\/(cliente-|portal-cliente)/.test(caminho);
  const ler = (chave) => { try { return localStorage.getItem(chave); } catch (e) { return null; } };
  const token = ehCliente ? ler('cliente_token') : ler('token');
  if (!ehCliente && !token) return; // login da equipe: sem assistente
  const publico = ehCliente ? 'cliente' : 'equipe';
  const logado = Boolean(token);
  const PAGINA_MANUAL = ehCliente ? '/pages/cliente-ajuda.html' : '/pages/ajuda.html';
  const CHAVE_HISTORICO = `assistente_${publico}`;

  const SUGESTOES = ehCliente
    ? ['Onde baixo a minha guia?', 'Como peço a 2ª via do DAS?', 'Esqueci minha senha', 'Como envio um documento?']
    : ['Como mando as guias para os clientes?', 'Como libero a Área do Cliente?', 'Como vejo a situação fiscal?', 'Como crio uma tarefa?'];

  // ---------- estilo ----------
  if (!document.querySelector('link[href$="/css/ajuda.css"], link[href$="../css/ajuda.css"]')) {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = '/css/ajuda.css';
    document.head.appendChild(css);
  }

  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /** Texto simples → HTML: **negrito**, listas "1." e "-", parágrafos. */
  function formatar(texto) {
    const linhas = String(texto || '').split(/\r?\n/);
    const html = [];
    let lista = null;
    let sub = false; // sub-itens recuados dentro do passo atual
    const fecharSub = () => { if (sub) { html.push('</ul>'); sub = false; } };
    const fechar = () => { if (lista) { fecharSub(); html.push(`</li></${lista}>`); lista = null; } };
    const inline = (t) => esc(t).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    for (const l of linhas) {
      const item = /^(\s*)(\d+[.)]|[-•*])\s+(.*)$/.exec(l);
      if (item && item[1].length >= 2 && lista) {
        if (!sub) { html.push('<ul>'); sub = true; }
        html.push(`<li>${inline(item[3])}</li>`);
      } else if (item) {
        const tipo = /\d/.test(item[2]) ? 'ol' : 'ul';
        if (lista !== tipo) { fechar(); html.push(`<${tipo}>`); lista = tipo; } else { fecharSub(); html.push('</li>'); }
        html.push(`<li>${inline(item[3])}`);
      } else if (l.trim()) { fechar(); html.push(`<p>${inline(l.trim())}</p>`); } else fechar();
    }
    fechar();
    return html.join('');
  }

  // ---------- montagem ----------
  const botao = document.createElement('button');
  botao.type = 'button';
  botao.className = 'assist-botao';
  botao.setAttribute('aria-label', 'Dúvidas? Abrir o assistente');
  // Robozinho do assistente (antena, cabeça, olhos e boca)
  const ROBO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="2.5" x2="12" y2="5.5"/><circle cx="12" cy="2.5" r="0.6" fill="currentColor"/><rect x="4" y="5.5" width="16" height="13" rx="4"/><line x1="2" y1="11" x2="4" y2="11"/><line x1="20" y1="11" x2="22" y2="11"/><circle cx="9" cy="11" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="11" r="1.4" fill="currentColor" stroke="none"/><path d="M9.5 15h5"/><path d="M8 18.5 7 21.5M16 18.5l1 3"/></svg>';
  botao.innerHTML = `${ROBO}<span class="texto">Dúvidas?</span>`;

  const painel = document.createElement('section');
  painel.className = 'assist-painel';
  painel.setAttribute('role', 'dialog');
  painel.setAttribute('aria-label', 'Assistente de dúvidas');
  painel.innerHTML = `
    <div class="assist-topo">
      <div class="assist-avatar">${ROBO}</div>
      <div class="assist-titulo"><strong>Assistente de dúvidas</strong><span>${ehCliente ? 'Área do Cliente · Privilege' : 'Aprende com cada pergunta'}</span></div>
      <a href="${PAGINA_MANUAL}" target="_blank" rel="noopener">Manual</a>
      <button type="button" aria-label="Fechar">×</button>
    </div>
    <div class="assist-msgs" aria-live="polite"></div>
    <form class="assist-form">
      <textarea rows="1" placeholder="Escreva a sua dúvida…" aria-label="Sua dúvida" maxlength="1500"></textarea>
      <button type="submit" aria-label="Enviar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>
    </form>`;
  document.body.appendChild(painel);
  document.body.appendChild(botao);

  const msgs = painel.querySelector('.assist-msgs');
  const form = painel.querySelector('.assist-form');
  const campo = form.querySelector('textarea');
  const enviar = form.querySelector('button');

  let historico = [];
  try { historico = JSON.parse(sessionStorage.getItem(CHAVE_HISTORICO) || '[]'); } catch (e) { historico = []; }
  const guardar = () => { try { sessionStorage.setItem(CHAVE_HISTORICO, JSON.stringify(historico.slice(-20))); } catch (e) { /* sem armazenamento */ } };

  function rolar() { msgs.scrollTop = msgs.scrollHeight; }

  function adicionarUsuario(texto) {
    const div = document.createElement('div');
    div.className = 'assist-msg usuario';
    div.textContent = texto;
    msgs.appendChild(div);
    rolar();
  }

  function adicionarResposta(r) {
    const div = document.createElement('div');
    div.className = 'assist-msg assistente';
    const secoes = (r.secoes || []).map((s) => `
      <a class="assist-secao" href="${PAGINA_MANUAL}#${encodeURIComponent(s.id)}" target="_blank" rel="noopener">
        📖 Ver passo a passo: ${esc(s.titulo)}
        ${(s.imagens || []).length ? `<div class="miniaturas">${s.imagens.map((i) => `<img src="${esc(i.url)}" alt="${esc(i.legenda)}" loading="lazy">`).join('')}</div>` : ''}
      </a>`).join('');
    div.innerHTML = `${formatar(r.resposta)}
      ${secoes ? `<div class="assist-secoes">${secoes}</div>` : ''}
      ${{ busca: '<div class="assist-modo">Resposta pela busca no manual.</div>',
    ia: '<div class="assist-modo">Resposta gerada por IA a partir do manual — confira no passo a passo.</div>',
    memoria: `<div class="assist-modo">Resposta ensinada pela equipe ${ehCliente ? 'do escritório' : 'do sistema'}.</div>` }[r.modo] || ''}
      ${r.id ? '<div class="assist-avaliar">Ajudou? <button type="button" data-util="1" aria-pressed="false">👍</button><button type="button" data-util="0" aria-pressed="false">👎</button></div>' : ''}`;
    div.querySelectorAll('[data-util]').forEach((b) => b.addEventListener('click', async () => {
      div.querySelectorAll('[data-util]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      const aviso = div.querySelector('.assist-obrigado') || div.appendChild(Object.assign(document.createElement('div'), { className: 'assist-modo assist-obrigado' }));
      aviso.textContent = b.dataset.util === '1'
        ? 'Obrigado! 😊'
        : `Obrigado por avisar. ${ehCliente ? 'O escritório vai ver a sua pergunta' : 'O administrador vai ver essa pergunta e me ensinar a resposta certa'} — da próxima vez eu acerto.`;
      try {
        await fetch(`/api/ajuda/${publico}/avaliar/${r.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ util: b.dataset.util === '1' }) });
      } catch (e) { /* sem conexão: tudo bem */ }
    }));
    msgs.appendChild(div);
    rolar();
  }

  function boasVindas() {
    msgs.innerHTML = '';
    const div = document.createElement('div');
    div.className = 'assist-msg assistente';
    div.innerHTML = `<p>Olá! 🤖 Pergunte como fazer qualquer coisa ${ehCliente ? 'na Área do Cliente' : 'no sistema'} — eu respondo com o passo a passo e as imagens do manual.</p>
      ${ehCliente ? '' : '<p>Se a resposta não ajudar, clique em 👎: o administrador me ensina a resposta certa e eu passo a acertar.</p>'}
      ${!logado ? '<p>Se não conseguir entrar, pergunte aqui também.</p>' : ''}
      <div class="assist-sugestoes">${SUGESTOES.map((s) => `<button type="button">${esc(s)}</button>`).join('')}</div>`;
    div.querySelectorAll('.assist-sugestoes button').forEach((b) => b.addEventListener('click', () => perguntar(b.textContent)));
    msgs.appendChild(div);
    for (const h of historico) {
      if (h.papel === 'usuario') adicionarUsuario(h.texto);
      else adicionarResposta({ resposta: h.texto, secoes: h.secoes, modo: null, id: null });
    }
  }

  async function perguntar(texto) {
    texto = String(texto || '').trim();
    if (!texto || enviar.disabled) return;
    adicionarUsuario(texto);
    campo.value = '';
    enviar.disabled = true;
    const digitando = document.createElement('div');
    digitando.className = 'assist-digitando';
    digitando.textContent = 'Procurando a resposta…';
    msgs.appendChild(digitando);
    rolar();
    try {
      const url = logado ? `/api/ajuda/${publico}/perguntar` : '/api/ajuda/cliente/buscar';
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(logado ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ pergunta: texto, pagina: caminho, historico: historico.map((h) => ({ papel: h.papel, texto: h.texto })) })
      });
      const dados = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(dados.erro || 'Não consegui responder agora. Tente de novo.');
      adicionarResposta(dados);
      historico.push({ papel: 'usuario', texto }, { papel: 'assistente', texto: dados.resposta, secoes: dados.secoes });
      guardar();
    } catch (err) {
      adicionarResposta({ resposta: err.message, secoes: [], modo: null, id: null });
    } finally {
      digitando.remove();
      enviar.disabled = false;
      campo.focus();
    }
  }

  function abrir() {
    painel.classList.add('aberto');
    if (!msgs.childElementCount) boasVindas();
    setTimeout(() => campo.focus(), 50);
  }
  function fechar() { painel.classList.remove('aberto'); botao.focus(); }

  botao.addEventListener('click', () => (painel.classList.contains('aberto') ? fechar() : abrir()));
  painel.querySelector('.assist-topo button').addEventListener('click', fechar);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && painel.classList.contains('aberto')) fechar(); });
  form.addEventListener('submit', (e) => { e.preventDefault(); perguntar(campo.value); });
  campo.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); perguntar(campo.value); } });
  campo.addEventListener('input', () => { campo.style.height = 'auto'; campo.style.height = `${Math.min(campo.scrollHeight, 120)}px`; });
})();
