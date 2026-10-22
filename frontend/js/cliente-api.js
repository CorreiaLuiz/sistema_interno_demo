/**
 * Helper das telas da Área do Cliente (login, criar senha e portal).
 * Separado do api.js da equipe de propósito: a sessão do cliente usa
 * outras chaves no navegador e, ao expirar, volta para o login do
 * cliente — nunca para o login da equipe.
 */
// Normalmente a página é servida pelo próprio back-end (mesmo endereço).
// Só no Live Server de desenvolvimento (porta 5500) a API fica na porta 3000.
const CLIENTE_API_BASE = window.location.port === '5500'
  ? 'http://localhost:3000/api/cliente'
  : '/api/cliente';

const CHAVE_TOKEN_CLIENTE = 'cliente_token';
const CHAVE_EMPRESA_CLIENTE = 'cliente_empresa';

function lerArmazenamento(chave) {
  try { return localStorage.getItem(chave); } catch (e) { return null; }
}
function gravarArmazenamento(chave, valor) {
  try {
    if (valor === null) localStorage.removeItem(chave);
    else localStorage.setItem(chave, valor);
  } catch (e) { /* navegador sem armazenamento: a sessão só não é lembrada */ }
}

function tokenCliente() { return lerArmazenamento(CHAVE_TOKEN_CLIENTE); }
function sairCliente() {
  gravarArmazenamento(CHAVE_TOKEN_CLIENTE, null);
  window.location.href = '/pages/cliente-login.html';
}

async function clienteFetch(caminho, opcoes = {}) {
  const token = tokenCliente();
  const ehFormData = opcoes.body instanceof FormData;
  let resp;
  try {
    resp = await fetch(`${CLIENTE_API_BASE}${caminho}`, {
      ...opcoes,
      headers: {
        ...(opcoes.body && !ehFormData ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: opcoes.body && !ehFormData ? JSON.stringify(opcoes.body) : opcoes.body
    });
  } catch (err) {
    throw new Error('Sem conexão com o servidor. Verifique sua internet e tente de novo.');
  }

  if (resp.status === 401 && token && !opcoes.semRedirecionar) {
    sairCliente();
    return null;
  }

  const tipo = resp.headers.get('content-type') || '';
  const dados = tipo.includes('application/json') ? await resp.json() : null;
  if (!resp.ok) throw new Error((dados && dados.erro) || 'Não foi possível falar com o servidor.');
  return dados;
}

/** Download autenticado: busca o arquivo com o token e entrega ao navegador. */
async function baixarArquivoCliente(caminho, nomeArquivo) {
  const resp = await fetch(`${CLIENTE_API_BASE}${caminho}`, {
    headers: { Authorization: `Bearer ${tokenCliente()}` }
  });
  if (resp.status === 401) { sairCliente(); return; }
  if (!resp.ok) {
    const dados = await resp.json().catch(() => null);
    throw new Error((dados && dados.erro) || 'Não foi possível baixar o arquivo.');
  }
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo || '';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function esc(valor) {
  if (valor === null || valor === undefined) return '';
  return String(valor).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

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

// Mesmo tema (claro/escuro) escolhido no sistema e na página Sobre
(function inicializarTemaCliente() {
  const salvo = lerArmazenamento('tema');
  const escuro = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.setAttribute('data-theme', salvo || (escuro ? 'dark' : 'light'));
})();

function alternarTemaCliente() {
  const novo = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', novo);
  gravarArmazenamento('tema', novo);
}
