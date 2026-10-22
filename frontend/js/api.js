/**
 * Helper central de comunicação com a API do back-end.
 * Todas as chamadas passam por aqui para manter o token JWT e o
 * tratamento de erros consistentes em todo o front-end.
 */
// Normalmente as páginas são servidas pelo próprio back-end (mesmo
// endereço), então o caminho relativo funciona em qualquer porta. Só no
// Live Server de desenvolvimento (porta 5500) a API fica na porta 3000.
const API_BASE = window.location.port === '5500' ? 'http://localhost:3000/api' : '/api';

function getToken() {
  return localStorage.getItem('token');
}

function setSessao(token, usuario, permissoes) {
  localStorage.setItem('token', token);
  localStorage.setItem('usuario', JSON.stringify(usuario));
  if (Array.isArray(permissoes)) localStorage.setItem('permissoes', JSON.stringify(permissoes));
}

function limparSessao() {
  localStorage.removeItem('token');
  localStorage.removeItem('usuario');
  localStorage.removeItem('permissoes');
}

/**
 * A pessoa logada tem a permissão? (lista em backend/src/config/permissoes.js; o
 * administrador muda em Usuários → "Permissões dos perfis"). Só esconde botões —
 * quem decide de verdade é o servidor.
 */
function pode(chave) {
  const usuario = getUsuario();
  if (usuario && usuario.role === 'administrador') return true;
  // Sessão aberta antes das permissões existirem: ainda não sabemos — mostra e deixa o
  // servidor decidir (atualizarPermissoes() busca a lista e recarrega a tela)
  const guardadas = localStorage.getItem('permissoes');
  if (guardadas === null) return true;
  try { return JSON.parse(guardadas).includes(chave); } catch (e) { return false; }
}

/** Esconde o que a pessoa não pode usar: data-permissao="chave" (ou "a,b" = qualquer uma). */
function aplicarPermissoesNaTela() {
  document.querySelectorAll('[data-permissao]').forEach((el) => {
    const ok = el.dataset.permissao.split(',').some((c) => pode(c.trim()));
    el.style.display = ok ? '' : 'none';
  });
}

/** Atualiza as permissões guardadas (o administrador pode ter mudado). Recarrega a tela se mudou algo. */
async function atualizarPermissoes() {
  if (!getToken()) return;
  try {
    const { permissoes } = await apiFetch('/permissoes/minhas');
    const nova = JSON.stringify(permissoes);
    const antiga = localStorage.getItem('permissoes');
    localStorage.setItem('permissoes', nova);
    if (antiga !== nova) {
      aplicarPermissoesNaTela();
      // Telas que decidem o acesso ao carregar precisam ler de novo (1 vez só)
      if (!sessionStorage.getItem('permissoes_recarregou')) { sessionStorage.setItem('permissoes_recarregou', '1'); window.location.reload(); }
    } else {
      sessionStorage.removeItem('permissoes_recarregou');
    }
  } catch (e) { /* sem conexão: fica o que estava guardado */ }
}

function getUsuario() {
  const raw = localStorage.getItem('usuario');
  return raw ? JSON.parse(raw) : null;
}

async function apiFetch(caminho, opcoes = {}) {
  const token = getToken();
  const headers = {
    ...(opcoes.body && !(opcoes.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(opcoes.headers || {})
  };

  const resp = await fetch(`${API_BASE}${caminho}`, {
    ...opcoes,
    headers,
    body: opcoes.body && !(opcoes.body instanceof FormData) ? JSON.stringify(opcoes.body) : opcoes.body
  });

  if (resp.status === 401 && caminho !== '/auth/login') {
    limparSessao();
    window.location.href = '/pages/login.html';
    return null;
  }

  const contentType = resp.headers.get('content-type') || '';
  const dados = contentType.includes('application/json') ? await resp.json() : null;

  if (!resp.ok) {
    const mensagem = (dados && dados.erro) || 'Erro na comunicação com o servidor.';
    throw new Error(mensagem);
  }

  return dados;
}

/**
 * Escapa texto vindo do servidor antes de colocá-lo em innerHTML.
 * Sem isso, um nome de arquivo ou descrição contendo HTML/JS (ex: enviado
 * pelo portal do cliente) seria executado na tela de quem estiver logado.
 */
function esc(valor) {
  if (valor === null || valor === undefined) return '';
  return String(valor).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function exigirLogin() {
  if (!getToken()) {
    window.location.href = '/pages/login.html';
  }
}

/**
 * Mostra uma notificação temporária no canto da tela.
 * tipo: 'sucesso' | 'erro' | 'info'
 */
function notificar(mensagem, tipo = 'info') {
  let wrap = document.querySelector('.toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'toast-wrap';
    document.body.appendChild(wrap);
  }
  const toast = document.createElement('div');
  toast.className = `toast ${tipo}`;
  toast.textContent = mensagem;
  wrap.appendChild(toast);
  setTimeout(() => toast.remove(), 4500);
}

/**
 * Modal de confirmação estilizado, substituindo o confirm() nativo do
 * navegador. Uso: if (!(await confirmarAcao('Excluir isto?'))) return;
 * Retorna uma Promise<boolean> — true se o usuário confirmou.
 */
function confirmarAcao(mensagem, tituloBotaoConfirmar = 'Excluir') {
  return new Promise((resolve) => {
    const fundo = document.createElement('div');
    fundo.className = 'modal-fundo aberto';
    fundo.innerHTML = `
      <div class="modal" style="max-width:400px;">
        <h2>Confirmar ação</h2>
        <p style="font-size:var(--text-sm); color:var(--color-text-muted);">${mensagem}</p>
        <div class="acoes-modal">
          <button type="button" class="btn btn-secundario" data-cancelar>Cancelar</button>
          <button type="button" class="btn btn-perigo" data-confirmar>${tituloBotaoConfirmar}</button>
        </div>
      </div>
    `;
    document.body.appendChild(fundo);

    function fechar(resultado) {
      fundo.remove();
      resolve(resultado);
    }

    fundo.querySelector('[data-cancelar]').addEventListener('click', () => fechar(false));
    fundo.querySelector('[data-confirmar]').addEventListener('click', () => fechar(true));
    fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(false); });
  });
}

/**
 * Tema claro/escuro — aplicado via atributo data-theme no <html>,
 * persistido em localStorage. Chamado imediatamente ao carregar
 * o script para evitar "flash" do tema errado.
 */
(function inicializarTema() {
  const salvo = localStorage.getItem('tema');
  const preferSistema = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const tema = salvo || (preferSistema ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', tema);
})();

function alternarTema() {
  const atual = document.documentElement.getAttribute('data-theme');
  const novo = atual === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', novo);
  localStorage.setItem('tema', novo);
}

/**
 * Sidebar mobile — abre/fecha via classe "aberta", usada em telas
 * estreitas (ver media query em style.css).
 */
function alternarSidebarMobile() {
  const sidebar = document.querySelector('.sidebar');
  if (sidebar) sidebar.classList.toggle('aberta');
}

const ROTULOS_PAPEL = {
  administrador: 'Administrador',
  analista_legalizacao: 'Analista de Legalização',
  analista_certidoes: 'Analista de Certidões',
  analista_licencas: 'Analista de Licenças',
  visualizador: 'Visualizador',
  supervisor_fiscal: 'Supervisor Fiscal',
  supervisor_contabilidade: 'Supervisor Contábil',
  supervisor_folha_pagamento: 'Supervisor de Folha',
  colaborador_fiscal: 'Colaborador Fiscal',
  colaborador_contabilidade: 'Colaborador Contábil',
  colaborador_folha_pagamento: 'Colaborador de Folha'
};

/**
 * Organiza o menu lateral em grupos com título (Principal, Setores,
 * Administração). O HTML de cada página continua com a lista simples de
 * links — aqui eles só são reordenados. Grupos cujos links estão todos
 * escondidos para o papel do usuário não mostram o título.
 */
function agruparMenuLateral() {
  const nav = document.querySelector('.sidebar-nav');
  if (!nav || nav.dataset.agrupado) return;
  nav.dataset.agrupado = '1';

  const GRUPOS = [
    ['Principal', ['dashboard', 'empresas', 'processos', 'certidoes', 'licencas', 'emails-enviados']],
    ['Setores', ['fiscal', 'contabilidade', 'folha-pagamento']],
    ['Administração', ['usuarios', 'auditoria', 'contatos-site']],
    ['Ajuda', ['ajuda']]
  ];
  const links = Array.from(nav.querySelectorAll('a'));
  const paginaDoLink = (a) => (a.getAttribute('href') || '').split('/').pop().replace('.html', '');

  GRUPOS.forEach(([titulo, paginas]) => {
    const doGrupo = paginas
      .map((pg) => links.find((a) => paginaDoLink(a) === pg))
      .filter(Boolean);
    if (!doGrupo.length) return;

    const rotulo = document.createElement('div');
    rotulo.className = 'sidebar-grupo';
    rotulo.textContent = titulo;
    if (doGrupo.every((a) => a.style.display === 'none')) rotulo.style.display = 'none';

    nav.appendChild(rotulo);
    doGrupo.forEach((a) => nav.appendChild(a));
  });
}

/**
 * Marca o link do menu correspondente à página atual como ativo,
 * e conecta os botões de tema/menu mobile se estiverem presentes
 * na página. Chamar no final de cada página após o DOM carregar.
 */
function inicializarShell() {
  garantirBuscaGlobal();
  const caminhoAtual = window.location.pathname;
  document.querySelectorAll('.sidebar-nav a').forEach((link) => {
    const href = link.getAttribute('href');
    if (href && caminhoAtual.endsWith(href.split('/').pop())) {
      link.classList.add('ativo');
    }
  });

  const btnTema = document.getElementById('btn-tema');
  if (btnTema) btnTema.addEventListener('click', alternarTema);

  const btnMenu = document.getElementById('btn-menu-mobile');
  if (btnMenu) btnMenu.addEventListener('click', alternarSidebarMobile);

  // No celular, tocar fora do menu aberto fecha o menu
  document.addEventListener('click', (e) => {
    const sidebar = document.querySelector('.sidebar.aberta');
    if (sidebar && !sidebar.contains(e.target) && !(btnMenu && btnMenu.contains(e.target))) {
      sidebar.classList.remove('aberta');
    }
  });

  const usuario = getUsuario();
  const nomeEl = document.getElementById('nome-usuario');
  const papelEl = document.getElementById('papel-usuario');
  const avatarEl = document.getElementById('avatar-usuario');
  if (usuario) {
    if (nomeEl) nomeEl.textContent = usuario.nome;
    if (avatarEl) avatarEl.textContent = usuario.nome.trim().charAt(0).toUpperCase();

    // Esconde itens de menu restritos a administrador para os demais papéis
    if (usuario.role !== 'administrador') {
      document.querySelectorAll('.somente-admin').forEach((el) => { el.style.display = 'none'; });
    }
    // Itens que dependem de permissão (data-permissao="chave")
    aplicarPermissoesNaTela();
    atualizarPermissoes();

    // Esconde itens de menu restritos a papéis específicos (ex: supervisores
    // de setor) — qualquer elemento com data-roles="papel1,papel2" só
    // aparece se o papel do usuário estiver nessa lista.
    document.querySelectorAll('[data-roles]').forEach((el) => {
      const papeisPermitidos = el.dataset.roles.split(',').map((p) => p.trim());
      if (!papeisPermitidos.includes(usuario.role)) {
        el.style.display = 'none';
      }
    });

    if (papelEl) papelEl.textContent = ROTULOS_PAPEL[usuario.role] || usuario.role.replace(/_/g, ' ');
  }

  agruparMenuLateral();
  // No menu compacto (telas médias) só aparecem os ícones: o nome vai no "title"
  document.querySelectorAll('.sidebar-nav a, .sidebar-acao').forEach((el) => {
    if (!el.title) el.title = el.textContent.trim();
  });
  inicializarSino();
  preencherEsqueletos();
  iniciarContagemNumeros();
  iniciarRotulosTabelas();

  const btnSair = document.getElementById('btn-sair');
  if (btnSair) {
    btnSair.addEventListener('click', () => {
      limparSessao();
      window.location.href = '/pages/login.html';
    });
  }

  const btnAlterarSenha = document.getElementById('btn-alterar-senha');
  if (btnAlterarSenha) {
    btnAlterarSenha.addEventListener('click', abrirModalAlterarSenha);
  }

  // Busca global no topo — leva para a tela de Empresas já filtrada
  const formBuscaGlobal = document.getElementById('form-busca-global');
  if (formBuscaGlobal) {
    formBuscaGlobal.addEventListener('submit', (e) => {
      e.preventDefault();
      const termo = document.getElementById('busca-global').value.trim();
      if (termo) {
        window.location.href = `/pages/empresas.html?busca=${encodeURIComponent(termo)}`;
      }
    });
  }
}

// ============================================================
// Animações sutis: esqueleto de carregamento e números contando
// ============================================================
const PREFERE_MENOS_MOVIMENTO = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Tabelas ainda vazias mostram linhas "esqueleto" até os dados chegarem. */
function preencherEsqueletos() {
  document.querySelectorAll('table tbody').forEach((tbody) => {
    if (tbody.children.length) return;
    const colunas = tbody.closest('table').querySelectorAll('thead th').length || 1;
    const larguras = ['72%', '55%', '64%'];
    tbody.innerHTML = larguras.map((largura) => `
      <tr class="esqueleto-linha" aria-hidden="true"><td colspan="${colunas}"><span class="esqueleto-barra" style="width:${largura};"></span></td></tr>`).join('');
  });
}

/**
 * Números dos painéis (KPIs, cards de resumo, ficha da empresa) contam de
 * 0 até o valor quando aparecem. Observa a página, então vale para
 * qualquer tela sem precisar mexer em cada script.
 */
function iniciarContagemNumeros() {
  if (PREFERE_MENOS_MOVIMENTO || !window.MutationObserver) return;
  const SELETOR = '.kpi-numero, .resumo-card .numero, .fe-numero strong';
  let agendado = false;

  function animar(el) {
    const alvo = Number(el.textContent.trim());
    if (!Number.isInteger(alvo) || alvo <= 0 || el.dataset.contando || el.dataset.contado === String(alvo)) return;
    el.dataset.contando = '1';
    const duracao = Math.min(700, 300 + alvo * 20);
    const inicio = performance.now();
    function passo(agora) {
      const t = Math.min(1, (agora - inicio) / duracao);
      const suave = 1 - Math.pow(1 - t, 3);
      el.textContent = String(Math.round(alvo * suave));
      if (t < 1) requestAnimationFrame(passo);
      else {
        el.textContent = String(alvo);
        el.dataset.contado = String(alvo);
        delete el.dataset.contando;
      }
    }
    requestAnimationFrame(passo);
  }

  new MutationObserver(() => {
    if (agendado) return;
    agendado = true;
    requestAnimationFrame(() => {
      agendado = false;
      document.querySelectorAll(SELETOR).forEach(animar);
    });
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
}

/**
 * Em telas estreitas (celular/tablet) cada linha de tabela vira um cartão
 * e cada célula mostra o nome da coluna ao lado (CSS usa data-label).
 * Rotula todas as tabelas, inclusive as que são montadas depois.
 */
function iniciarRotulosTabelas() {
  function rotular() {
    document.querySelectorAll('table').forEach((tabela) => {
      const titulos = [...tabela.querySelectorAll('thead th')].map((th) => th.textContent.trim());
      if (!titulos.length) return;
      tabela.querySelectorAll('tbody tr').forEach((tr) => {
        [...tr.children].forEach((td, i) => {
          if (td.hasAttribute('colspan') || td.hasAttribute('data-label')) return;
          td.setAttribute('data-label', titulos[i] || '');
        });
      });
    });
  }
  rotular();
  if (!window.MutationObserver) return;
  let agendado = false;
  new MutationObserver(() => {
    if (agendado) return;
    agendado = true;
    requestAnimationFrame(() => { agendado = false; rotular(); });
  }).observe(document.body, { childList: true, subtree: true });
}

/** Coloca a busca de empresas no topo das telas que ainda não têm (mesma em todas). */
function garantirBuscaGlobal() {
  const acoes = document.querySelector('.topbar-acoes');
  if (!acoes || document.getElementById('form-busca-global')) return;
  const form = document.createElement('form');
  form.id = 'form-busca-global';
  form.style.margin = '0';
  form.innerHTML = '<input type="text" id="busca-global" placeholder="Buscar empresa por nome ou CNPJ…" aria-label="Buscar empresa">';
  acoes.insertBefore(form, acoes.firstChild);
}

// ============================================================
// Avisos (sininho) — busca a cada minuto e ao voltar para a aba
// ============================================================
const ICONE_SINO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';

function tempoRelativo(dataIso) {
  const segundos = Math.max(0, (Date.now() - new Date(dataIso).getTime()) / 1000);
  if (segundos < 60) return 'agora';
  if (segundos < 3600) return `há ${Math.floor(segundos / 60)} min`;
  if (segundos < 86400) return `há ${Math.floor(segundos / 3600)} h`;
  if (segundos < 7 * 86400) return `há ${Math.floor(segundos / 86400)} dia(s)`;
  return new Date(dataIso).toLocaleDateString('pt-BR');
}

function inicializarSino() {
  const acoes = document.querySelector('.topbar-acoes');
  if (!acoes || !getToken() || document.getElementById('sino-wrap')) return;

  const wrap = document.createElement('div');
  wrap.className = 'sino-wrap';
  wrap.id = 'sino-wrap';
  wrap.innerHTML = `
    <button type="button" class="theme-toggle sino-btn" id="btn-sino" title="Avisos" aria-label="Avisos" aria-expanded="false">
      ${ICONE_SINO}<span class="sino-contador" id="sino-contador" hidden></span>
    </button>
    <div class="sino-painel" id="sino-painel" role="dialog" aria-label="Avisos">
      <div class="sino-cabecalho"><strong>Avisos</strong><button type="button" id="btn-sino-todas">Marcar todos como lidos</button></div>
      <div class="sino-lista" id="sino-lista"><div class="sino-vazio">Carregando…</div></div>
    </div>`;
  const btnTema = document.getElementById('btn-tema');
  acoes.insertBefore(wrap, btnTema && btnTema.parentElement === acoes ? btnTema : null);

  const btn = document.getElementById('btn-sino');
  const painel = document.getElementById('sino-painel');
  let avisos = [];

  function renderizar(dados) {
    avisos = dados.dados;
    const contador = document.getElementById('sino-contador');
    contador.hidden = !dados.nao_lidas;
    contador.textContent = dados.nao_lidas > 99 ? '99+' : dados.nao_lidas;
    btn.title = dados.nao_lidas ? `${dados.nao_lidas} aviso(s) novo(s)` : 'Avisos';
    document.getElementById('btn-sino-todas').hidden = !dados.nao_lidas;

    const lista = document.getElementById('sino-lista');
    if (!avisos.length) {
      lista.innerHTML = '<div class="sino-vazio">Nenhum aviso por enquanto.</div>';
      return;
    }
    lista.innerHTML = avisos.map((a) => `
      <button type="button" class="sino-item ${a.lida ? '' : 'nao-lida'}" data-aviso="${esc(a.id)}">
        <span class="titulo">${esc(a.titulo)}</span>
        ${a.mensagem ? `<span class="mensagem" style="display:block;">${esc(a.mensagem)}</span>` : ''}
        <span class="quando" style="display:block;">${tempoRelativo(a.criado_em)}</span>
      </button>`).join('');
  }

  async function carregar() {
    try {
      const dados = await apiFetch('/notificacoes');
      if (dados) renderizar(dados);
    } catch (e) { /* sem conexão: tenta de novo no próximo ciclo */ }
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const abrir = !painel.classList.contains('aberto');
    painel.classList.toggle('aberto', abrir);
    btn.setAttribute('aria-expanded', String(abrir));
    if (abrir) carregar();
  });
  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) { painel.classList.remove('aberto'); btn.setAttribute('aria-expanded', 'false'); }
  });

  document.getElementById('sino-lista').addEventListener('click', async (e) => {
    const item = e.target.closest('[data-aviso]');
    if (!item) return;
    const aviso = avisos.find((a) => a.id === item.dataset.aviso);
    if (aviso && !aviso.lida) {
      try { await apiFetch(`/notificacoes/${encodeURIComponent(aviso.id)}/lida`, { method: 'PATCH' }); } catch (err) { /* segue */ }
    }
    if (aviso && aviso.link) window.location.href = aviso.link;
    else carregar();
  });

  document.getElementById('btn-sino-todas').addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await apiFetch('/notificacoes/marcar-todas-lidas', { method: 'POST' });
      carregar();
    } catch (err) { notificar(err.message, 'erro'); }
  });

  carregar();
  setInterval(carregar, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) carregar(); });
}

/**
 * Responsáveis da conferência bancária: a planilha "Controle Extratos CC"
 * usa a inicial de cada um na coluna "Resp.".
 */
const RESPONSAVEIS_CONFERENCIA = { A: 'Analista A', B: 'Analista B', C: 'Analista C', D: 'Analista D' };
function nomeResponsavel(letra) {
  if (!letra) return '';
  return RESPONSAVEIS_CONFERENCIA[String(letra).trim().toUpperCase()] || letra;
}

/** Nome da empresa como link para a ficha completa dela. */
function linkEmpresa(id, nome) {
  return `<a class="link-empresa" href="/pages/empresa.html?id=${encodeURIComponent(id)}">${esc(nome)}</a>`;
}

/**
 * Exporta uma lista para Excel (CSV com ";" e acentos corretos).
 * colunas: [{ titulo, valor: (linha) => texto }]
 */
function exportarExcel(nomeArquivo, colunas, linhas) {
  const celula = (v) => {
    let texto = v === null || v === undefined ? '' : String(v);
    // Texto digitado por fora (cliente, site) começando com = + @ ou - vira fórmula no Excel: neutraliza
    if (typeof v === 'string' && /^([=+@\t\r]|-(?![\d.,]+$))/.test(texto)) texto = `'${texto}`;
    return /[";\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
  };
  const conteudo = [colunas.map((c) => celula(c.titulo)).join(';')]
    .concat(linhas.map((l) => colunas.map((c) => celula(c.valor(l))).join(';')))
    .join('\r\n');
  // BOM no início: o Excel reconhece UTF-8 e mostra os acentos certos
  const blob = new Blob(['﻿' + conteudo], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${nomeArquivo}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formatarDataBR(valor) {
  if (!valor) return '';
  const [ano, mes, dia] = String(valor).slice(0, 10).split('-');
  return `${dia}/${mes}/${ano}`;
}

/**
 * Janela "Concluir pedido do cliente": anexa a guia e/ou escreve a
 * resposta, e o cliente é avisado. Usada nas telas dos setores, na
 * Legalização e na ficha da empresa.
 */
function abrirModalConcluirPedido(tarefa, setor, aoConcluir) {
  const fundo = document.createElement('div');
  fundo.className = 'modal-fundo aberto';
  fundo.innerHTML = `
    <div class="modal" style="max-width:520px;">
      <h2>Concluir pedido do cliente</h2>
      <p style="font-size:var(--text-sm); color:var(--color-text-muted); margin-bottom:var(--space-4); white-space:pre-line;"><strong>${esc(tarefa.razao_social || '')}</strong>
${esc(tarefa.descricao)}</p>
      <form>
        <div class="campo">
          <label>Guia ou arquivo para o cliente (PDF, PNG ou JPG)</label>
          <input type="file" name="arquivo" accept=".pdf,.png,.jpg,.jpeg">
        </div>
        <div class="campo">
          <label>Mensagem para o cliente</label>
          <textarea name="resposta" rows="3" maxlength="2000" placeholder="Ex: Segue a guia do DAS atualizada, com vencimento para hoje."></textarea>
        </div>
        <p style="font-size:var(--text-xs); color:var(--color-text-muted); margin-bottom:var(--space-3);">
          O arquivo fica disponível na Área do Cliente e o cliente é avisado por e-mail e WhatsApp.
        </p>
        <div class="erro-msg"></div>
        <div class="acoes-modal">
          <button type="button" class="btn btn-secundario" data-cancelar>Cancelar</button>
          <button type="submit" class="btn">Concluir e avisar o cliente</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(fundo);

  const fechar = () => fundo.remove();
  fundo.querySelector('[data-cancelar]').addEventListener('click', fechar);
  fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(); });

  fundo.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const erroEl = fundo.querySelector('.erro-msg');
    const btn = fundo.querySelector('button[type="submit"]');
    erroEl.textContent = '';

    const arquivo = e.target.arquivo.files[0];
    const resposta = e.target.resposta.value.trim();
    if (!arquivo && !resposta) {
      erroEl.textContent = 'Anexe a guia ou escreva uma mensagem para o cliente.';
      return;
    }

    const formData = new FormData();
    if (arquivo) formData.append('arquivo', arquivo);
    if (resposta) formData.append('resposta', resposta);

    btn.disabled = true;
    try {
      const r = await apiFetch(`/tarefas-setor/${setor}/${tarefa.id}/concluir-pedido`, { method: 'POST', body: formData });
      const canais = r && r.envio ? [r.envio.email && 'e-mail', r.envio.whatsapp && 'WhatsApp'].filter(Boolean) : [];
      notificar(canais.length ? `Pedido concluído — cliente avisado por ${canais.join(' e ')}.` : 'Pedido concluído — a resposta já aparece na Área do Cliente.', 'sucesso');
      fechar();
      if (aoConcluir) aoConcluir();
    } catch (err) {
      erroEl.textContent = err.message;
      btn.disabled = false;
    }
  });
}

/**
 * Pedido do cliente: a descrição salva tem "[Pedido do cliente] Tipo",
 * "Observação: ..." e "Solicitado por: ...". Mostra isso de forma enxuta.
 */
function htmlPedidoCliente(descricao) {
  const linhas = String(descricao || '').split('\n');
  const titulo = (linhas[0] || '').replace(/^\[Pedido do cliente\]\s*/, '');
  const obs = linhas.find((l) => l.startsWith('Observação:'));
  const quem = linhas.find((l) => l.startsWith('Solicitado por:'));
  return `<span class="pedido-cliente-bloco">
    <span class="badge badge-a_vencer">Pedido do cliente</span>
    <span class="titulo-pedido">${esc(titulo)}</span>
    ${obs ? `<span class="obs">${esc(obs.replace('Observação: ', ''))}</span>` : ''}
    ${quem ? `<span class="meta">${esc(quem.replace('Solicitado por: ', 'Pedido por '))}</span>` : ''}
  </span>`;
}

/**
 * Modal de "Alterar minha senha", disponível para qualquer usuário
 * logado a partir do rodapé da sidebar. Construído dinamicamente para
 * não precisar repetir o HTML em todas as páginas.
 */
function abrirModalAlterarSenha() {
  const fundo = document.createElement('div');
  fundo.className = 'modal-fundo aberto';
  fundo.innerHTML = `
    <div class="modal" style="max-width:400px;">
      <h2>Alterar minha senha</h2>
      <form id="form-alterar-senha-dinamico">
        <div class="campo">
          <label>Senha atual</label>
          <input type="password" id="senha-atual-dinamico" required autocomplete="current-password">
        </div>
        <div class="campo">
          <label>Nova senha (mínimo 8 caracteres)</label>
          <input type="password" id="senha-nova-dinamico" required minlength="8" autocomplete="new-password">
        </div>
        <div class="erro-msg" id="erro-senha-dinamico"></div>
        <div class="acoes-modal">
          <button type="button" class="btn btn-secundario" data-cancelar-senha>Cancelar</button>
          <button type="submit" class="btn">Salvar nova senha</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(fundo);

  fundo.querySelector('[data-cancelar-senha]').addEventListener('click', () => fundo.remove());
  fundo.addEventListener('click', (e) => { if (e.target === fundo) fundo.remove(); });

  fundo.querySelector('#form-alterar-senha-dinamico').addEventListener('submit', async (e) => {
    e.preventDefault();
    const erroEl = fundo.querySelector('#erro-senha-dinamico');
    erroEl.textContent = '';
    try {
      await apiFetch('/auth/trocar-senha', {
        method: 'POST',
        body: {
          senhaAtual: fundo.querySelector('#senha-atual-dinamico').value,
          novaSenha: fundo.querySelector('#senha-nova-dinamico').value
        }
      });
      notificar('Senha alterada com sucesso.', 'sucesso');
      fundo.remove();
    } catch (err) {
      erroEl.textContent = err.message;
    }
  });
}

/**
 * Monta o HTML de uma célula de "Ações" com menu suspenso (⋮), evitando
 * uma lista longa de links lado a lado numa linha de tabela.
 *
 * itens: array de { rotulo, dataset: {chave: valor}, perigo: bool }
 * — cada item vira um <button> dentro do menu, com um atributo
 * data-<chave> igual ao que os links antigos usavam (ex: data-editar),
 * então o código que já faz `querySelectorAll('[data-editar]')` continua
 * funcionando sem mudar nada além de onde os elementos ficam.
 */
function celulaAcoes(itens) {
  const idMenu = `menu-acoes-${Math.random().toString(36).slice(2, 9)}`;
  // Itens com "permissao" só aparecem para quem pode; separador sobrando no fim/começo some
  itens = itens.filter((item) => item === 'separador' || !item.permissao || pode(item.permissao));
  while (itens[0] === 'separador') itens.shift();
  while (itens[itens.length - 1] === 'separador') itens.pop();
  const botoes = itens.map((item) => {
    if (item === 'separador') return '<hr>';
    const datasetAttrs = Object.entries(item.dataset)
      .map(([chave, valor]) => `data-${chave}="${valor}"`)
      .join(' ');
    return `<button type="button" ${datasetAttrs} class="${item.perigo ? 'acao-perigo' : ''}">${item.rotulo}</button>`;
  }).join('');

  return `
    <div class="dropdown-acoes">
      <button type="button" class="btn-dropdown-acoes" data-abrir-menu-acoes="${idMenu}" title="Ações">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
      </button>
      <div class="menu-acoes" id="${idMenu}">${botoes}</div>
    </div>
  `;
}

// Abre/fecha o menu clicado, e fecha qualquer outro menu aberto —
// delegado no document para funcionar com linhas criadas dinamicamente.
// Ao abrir, o menu é levado para o <body> (e volta ao fechar): dentro da
// tabela ele era recortado pela rolagem da própria tabela e pelas
// animações das linhas, e simplesmente não aparecia.
function fecharMenuAcoes(menu) {
  menu.classList.remove('aberto');
  if (menu._origem && menu.parentElement === document.body) {
    if (document.body.contains(menu._origem)) menu._origem.appendChild(menu);
    else menu.remove(); // a linha da tabela já foi recarregada
  }
}

document.addEventListener('click', (e) => {
  const btnAbrir = e.target.closest('[data-abrir-menu-acoes]');
  const dentroDeMenu = e.target.closest('.menu-acoes');

  document.querySelectorAll('.menu-acoes.aberto').forEach((menu) => {
    if (!btnAbrir || menu.id !== btnAbrir.dataset.abrirMenuAcoes) {
      fecharMenuAcoes(menu);
    }
  });

  if (btnAbrir) {
    const menu = document.getElementById(btnAbrir.dataset.abrirMenuAcoes);
    if (!menu) return;

    const jaAberto = menu.classList.contains('aberto');
    if (jaAberto) {
      fecharMenuAcoes(menu);
    } else {
      menu._origem = menu.parentElement;
      document.body.appendChild(menu);
      menu.classList.add('aberto');
    }

    if (!jaAberto) {
      const rectBotao = btnAbrir.getBoundingClientRect();
      const larguraMenu = menu.offsetWidth || 190;
      const alturaMenu = menu.offsetHeight || 160;

      // Alinha a borda direita do menu com a borda direita do botão,
      // mas nunca deixa vazar pela esquerda ou direita da tela.
      let esquerda = rectBotao.right - larguraMenu;
      esquerda = Math.max(8, Math.min(esquerda, window.innerWidth - larguraMenu - 8));

      // Abre pra baixo por padrão; se não couber, abre pra cima; se não
      // couber de jeito nenhum (tela baixa, ex: notebook), encosta dentro
      // da tela e o próprio menu ganha rolagem.
      const espacoUtil = window.innerHeight - 16;
      menu.style.maxHeight = alturaMenu > espacoUtil ? `${espacoUtil}px` : '';
      menu.style.overflowY = alturaMenu > espacoUtil ? 'auto' : '';
      const alturaFinal = Math.min(alturaMenu, espacoUtil);
      let topo = rectBotao.bottom + 4;
      if (topo + alturaFinal > window.innerHeight - 8) {
        const acima = rectBotao.top - alturaFinal - 4;
        topo = acima >= 8 ? acima : Math.max(8, window.innerHeight - 8 - alturaFinal);
      }

      menu.style.left = `${esquerda}px`;
      menu.style.top = `${topo}px`;
    }
  } else if (dentroDeMenu) {
    // Clicou num botão dentro do menu — fecha o menu depois da ação
    fecharMenuAcoes(dentroDeMenu);
  }
});

// Fecha o menu aberto também ao rolar a tela ou redimensionar a janela —
// evita o menu "flutuar" desalinhado do botão que o abriu. (Rolar dentro
// do próprio menu, quando ele é mais alto que a tela, não fecha.)
window.addEventListener('scroll', (e) => {
  if (e.target instanceof Element && e.target.closest('.menu-acoes')) return;
  document.querySelectorAll('.menu-acoes.aberto').forEach(fecharMenuAcoes);
}, true);
window.addEventListener('resize', () => {
  document.querySelectorAll('.menu-acoes.aberto').forEach(fecharMenuAcoes);
});
