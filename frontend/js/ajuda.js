exigirLogin();
inicializarShell();

const usuarioAjuda = getUsuario();
const $ajuda = (id) => document.getElementById(id);

montarManual({
  endpoint: '/api/ajuda/equipe/manual',
  token: getToken(),
  indice: document.querySelector('.aj-indice'),
  conteudo: $ajuda('conteudo-manual'),
  busca: $ajuda('busca-manual')
}).catch((err) => {
  if (err.sessao) { limparSessao(); window.location.href = '/pages/login.html'; return; }
  $ajuda('conteudo-manual').innerHTML = `<p class="aj-vazio">${esc(err.message)}</p>`;
});

// ---- Perguntas feitas e memória do assistente (só administrador) ----
let perguntasCache = [];
let secoesManual = { equipe: [], cliente: [] };

const podeMemoria = Boolean(usuarioAjuda && pode('ajuda.memoria'));
const podeConectar = Boolean(usuarioAjuda && pode('claude.conectar'));
if (podeMemoria || podeConectar) {
  $ajuda('abas').style.display = '';
  // Cada aba só aparece para quem tem a permissão dela
  document.querySelectorAll('[data-aba="perguntas"], [data-aba="memoria"]').forEach((b) => { b.style.display = podeMemoria ? '' : 'none'; });
  document.querySelectorAll('[data-aba="conectar"]').forEach((b) => { b.style.display = podeConectar ? '' : 'none'; });
  const carregadas = {};
  const abrirAba = (nome) => {
    document.querySelectorAll('[data-aba]').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.aba === nome)));
    for (const aba of ['manual', 'perguntas', 'memoria', 'conectar']) $ajuda(`aba-${aba}`).style.display = nome === aba ? '' : 'none';
    if (!carregadas[nome]) {
      carregadas[nome] = true;
      if (nome === 'perguntas') carregarPerguntas();
      if (nome === 'memoria') carregarMemoria();
      if (nome === 'conectar') carregarChaves();
    }
  };
  document.querySelectorAll('[data-aba]').forEach((b) => b.addEventListener('click', () => abrirAba(b.dataset.aba)));
  if (podeMemoria) {
    $ajuda('so-sem-resposta').addEventListener('change', desenharPerguntas);
    $ajuda('btn-ensinar').addEventListener('click', () => abrirEnsinar({}));
  }
  if (podeConectar) {
    $ajuda('form-chave').addEventListener('submit', criarChave);
    if (new URLSearchParams(window.location.search).get('aba') === 'conectar') abrirAba('conectar');
  }
}

// ---- Conectar o Claude (conector MCP, só consulta) ----
const ORIGEM = window.location.origin;
const naInternet = !/^https?:\/\/(localhost|127\.|\[::1\]|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ORIGEM);

async function carregarChaves() {
  const tbody = $ajuda('tabela-chaves');
  try {
    const { chaves } = await apiFetch('/conector/chaves');
    if (!chaves.length) { tbody.innerHTML = '<tr><td colspan="5">Nenhuma chave ainda. Crie uma acima.</td></tr>'; return; }
    const data = (d) => (d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
    tbody.innerHTML = chaves.map((c) => `
      <tr${c.revogada_em ? ' class="aj-chave-off"' : ''}>
        <td data-label="Nome"><strong>${esc(c.nome)}</strong><div class="aj-resposta">${esc(c.inicio)}…${c.minha ? '' : ' · de ' + esc(c.dono)}</div></td>
        <td data-label="Criada">${data(c.criado_em)}</td>
        <td data-label="Último uso">${data(c.ultimo_uso)}${c.usos ? `<div class="aj-resposta">${c.usos} consulta(s)</div>` : ''}</td>
        <td data-label="Situação">${c.revogada_em ? `<span class="badge badge-baixada">Desligada</span>` : '<span class="badge badge-valida">Ligada</span>'}</td>
        <td data-label="" class="celula-acoes">${c.revogada_em ? '' : `<button type="button" class="link-acao" data-desligar="${esc(c.id)}" data-nome="${esc(c.nome)}">Desligar</button>`}</td>
      </tr>`).join('');
    tbody.querySelectorAll('[data-desligar]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmarAcao(`Desligar a chave "${esc(b.dataset.nome)}"? O Claude que usa essa chave para de consultar o sistema na hora.`, 'Desligar'))) return;
      try {
        await apiFetch(`/conector/chaves/${b.dataset.desligar}`, { method: 'DELETE' });
        notificar('Chave desligada.', 'sucesso');
        carregarChaves();
      } catch (err) { notificar(err.message, 'erro'); }
    }));
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5">${esc(err.message)}</td></tr>`;
  }
}

async function criarChave(e) {
  e.preventDefault();
  const nome = $ajuda('chave-nome').value.trim();
  try {
    const r = await apiFetch('/conector/chaves', { method: 'POST', body: { nome } });
    $ajuda('chave-nome').value = '';
    const comandoCode = `claude mcp add --transport http sistema-privilege ${ORIGEM}/api/mcp --header "Authorization: Bearer ${r.chave}"`;
    const urlApp = `${ORIGEM}/api/mcp/${r.chave}`;
    $ajuda('chave-nova').innerHTML = `
      <div class="aj-chave-nova">
        <p><strong>Chave criada.</strong> Copie agora: por segurança ela <strong>não aparece de novo</strong>. Não mande para ninguém — quem tiver a chave consulta o sistema como você.</p>
        <h4>Claude neste computador (Claude Code, no terminal)</h4>
        <p>Cole este comando no terminal e aperte Enter:</p>
        <div class="aj-copiar"><code>${esc(comandoCode)}</code><button type="button" class="btn btn-secundario" data-copiar="${esc(comandoCode)}">Copiar</button></div>
        <h4>Aplicativo do Claude (claude.ai, computador ou celular)</h4>
        ${naInternet
    ? `<p>Em <strong>Configurações → Conectores → Adicionar conector personalizado</strong>, cole este endereço:</p>
        <div class="aj-copiar"><code>${esc(urlApp)}</code><button type="button" class="btn btn-secundario" data-copiar="${esc(urlApp)}">Copiar</button></div>`
    : '<p class="aj-aviso-rede">O sistema ainda está só na rede do escritório. O aplicativo do Claude só consegue usar o conector quando o sistema estiver na internet (hospedagem). Por enquanto, use o Claude deste computador.</p>'}
      </div>`;
    $ajuda('chave-nova').querySelectorAll('[data-copiar]').forEach((b) => b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(b.dataset.copiar); b.textContent = 'Copiado ✓'; } catch (err) { notificar('Não consegui copiar: selecione o texto e copie com Ctrl+C.', 'erro'); }
    }));
    carregarChaves();
  } catch (err) {
    notificar(err.message, 'erro');
  }
}

/** Pergunta que precisa de alguém ensinar: não ajudou ou o manual não tinha nada. */
const precisaResposta = (p) => p.modo !== 'memoria' && (p.util === false || !(p.secoes && p.secoes.length));

const ROTULO_MODO = { ia: 'IA', busca: 'Busca no manual', memoria: 'Resposta ensinada' };

async function carregarPerguntas() {
  try {
    const r = await apiFetch('/ajuda/perguntas');
    $ajuda('resumo-perguntas').textContent = r.ia
      ? `Assistente com IA ligado — ${r.ia_hoje} de ${r.limite_dia} perguntas com IA hoje (passando disso, responde só pela busca no manual).`
      : 'IA desligada (falta a chave ANTHROPIC_API_KEY no .env): o assistente responde pelas respostas ensinadas e pela busca no manual.';
    perguntasCache = r.perguntas;
    desenharPerguntas();
  } catch (err) {
    $ajuda('tabela-perguntas').innerHTML = `<tr><td colspan="5">${esc(err.message)}</td></tr>`;
  }
}

function desenharPerguntas() {
  const tbody = $ajuda('tabela-perguntas');
  const lista = $ajuda('so-sem-resposta').checked ? perguntasCache.filter(precisaResposta) : perguntasCache;
  if (!lista.length) {
    tbody.innerHTML = `<tr><td colspan="5">${perguntasCache.length ? 'Nenhuma pergunta precisando de resposta. 👍' : 'Ninguém perguntou nada ainda.'}</td></tr>`;
    return;
  }
  tbody.innerHTML = lista.map((p) => `
    <tr${precisaResposta(p) ? ' class="aj-precisa"' : ''}>
      <td data-label="Quando" style="white-space:nowrap;">${new Date(p.criado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td>
      <td data-label="Quem">${esc(p.quem || '—')}<div class="aj-resposta">${p.publico === 'cliente' ? 'Cliente' : 'Equipe'}${p.pagina ? ' · ' + esc(p.pagina.replace('/pages/', '')) : ''}</div></td>
      <td data-label="Pergunta"><div class="aj-pergunta">${esc(p.pergunta)}</div><div class="aj-resposta">${esc((p.resposta || '').slice(0, 400))}${(p.resposta || '').length > 400 ? '…' : ''}</div>
        <div class="aj-resposta">${ROTULO_MODO[p.modo] || p.modo}${p.secoes && p.secoes.length ? ' · manual: ' + esc(p.secoes.join(', ')) : ' · nada no manual'}</div></td>
      <td data-label="Ajudou?">${p.util === true ? '<span class="badge badge-valida">Sim</span>' : p.util === false ? '<span class="badge badge-vencida">Não</span>' : '—'}</td>
      <td data-label="" class="celula-acoes">${p.modo === 'memoria' ? '' : `<button type="button" class="link-acao" data-ensinar="${esc(p.id)}">Ensinar resposta</button>`}</td>
    </tr>`).join('');
  tbody.querySelectorAll('[data-ensinar]').forEach((b) => b.addEventListener('click', () => {
    const p = perguntasCache.find((x) => x.id === b.dataset.ensinar);
    abrirEnsinar({ publico: p.publico, pergunta: p.pergunta, secoes: p.secoes || [], origem_pergunta_id: p.id });
  }));
}

async function carregarMemoria() {
  const tbody = $ajuda('tabela-memoria');
  try {
    const r = await apiFetch('/ajuda/memoria');
    secoesManual = r.secoes;
    if (!r.memoria.length) {
      tbody.innerHTML = '<tr><td colspan="4">Nenhuma resposta ensinada ainda. Use "Ensinar resposta" nas perguntas feitas, ou o botão acima.</td></tr>';
      return;
    }
    tbody.innerHTML = r.memoria.map((m) => `
      <tr>
        <td data-label="Para"><span class="badge ${m.publico === 'cliente' ? 'badge-a_vencer' : 'badge-valida'}">${m.publico === 'cliente' ? 'Clientes' : 'Equipe'}</span></td>
        <td data-label="Pergunta"><div class="aj-pergunta">${esc(m.pergunta).replace(/\n/g, '<br>')}</div><div class="aj-resposta">${esc(m.resposta).replace(/\*\*/g, '')}</div>
          <div class="aj-resposta">${m.atualizado_por_nome ? 'por ' + esc(m.atualizado_por_nome) + ' · ' : ''}${new Date(m.atualizado_em).toLocaleDateString('pt-BR')}</div></td>
        <td data-label="Usada">${m.usos}×</td>
        <td data-label="" class="celula-acoes"><div class="acoes-linha">
          <button type="button" class="link-acao" data-editar-mem="${esc(m.id)}">Editar</button>
          <button type="button" class="link-acao" data-excluir-mem="${esc(m.id)}">Excluir</button>
        </div></td>
      </tr>`).join('');
    tbody.querySelectorAll('[data-editar-mem]').forEach((b) => b.addEventListener('click', () => abrirEnsinar(r.memoria.find((m) => m.id === b.dataset.editarMem))));
    tbody.querySelectorAll('[data-excluir-mem]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmarAcao('Excluir esta resposta da memória do assistente?'))) return;
      try {
        await apiFetch(`/ajuda/memoria/${b.dataset.excluirMem}`, { method: 'DELETE' });
        notificar('Resposta excluída.', 'sucesso');
        carregarMemoria();
      } catch (err) { notificar(err.message, 'erro'); }
    }));
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4">${esc(err.message)}</td></tr>`;
  }
}

/** Janela para ensinar (ou corrigir) uma resposta. item: { id?, publico, pergunta, resposta, secoes, origem_pergunta_id } */
async function abrirEnsinar(item) {
  if (!secoesManual.equipe.length) {
    try { secoesManual = (await apiFetch('/ajuda/memoria')).secoes; } catch (err) { notificar(err.message, 'erro'); return; }
  }
  const publicoInicial = item.publico || 'equipe';
  const fundo = document.createElement('div');
  fundo.className = 'modal-fundo aberto';
  fundo.innerHTML = `
    <div class="modal" style="max-width:640px;">
      <h2>${item.id ? 'Editar resposta' : 'Ensinar uma resposta ao assistente'}</h2>
      <form>
        <div class="campo">
          <label for="ens-publico">Para quem</label>
          <select id="ens-publico">
            <option value="equipe"${publicoInicial === 'equipe' ? ' selected' : ''}>Equipe do escritório</option>
            <option value="cliente"${publicoInicial === 'cliente' ? ' selected' : ''}>Clientes (Área do Cliente)</option>
          </select>
        </div>
        <div class="campo">
          <label for="ens-pergunta">Pergunta</label>
          <textarea id="ens-pergunta" rows="3" required maxlength="2000">${esc(item.pergunta || '')}</textarea>
          <small class="aj-ajuda-campo">Pode escrever mais de um jeito de perguntar, um por linha.</small>
        </div>
        <div class="campo">
          <label for="ens-resposta">Resposta certa</label>
          <textarea id="ens-resposta" rows="6" required maxlength="4000" placeholder="1. Abra a tela ...&#10;2. Clique em ...">${esc(item.resposta || '')}</textarea>
          <small class="aj-ajuda-campo">Use "1." para passos e **texto** para negrito.</small>
        </div>
        <div class="campo">
          <label for="ens-secao">Passo a passo do manual que acompanha (opcional)</label>
          <select id="ens-secao"></select>
        </div>
        <div class="erro-msg" id="ens-erro"></div>
        <div class="acoes-modal">
          <button type="button" class="btn btn-secundario" data-cancelar>Cancelar</button>
          <button type="submit" class="btn">Salvar na memória</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(fundo);
  const $m = (s) => fundo.querySelector(s);
  const opcoesSecao = () => {
    const atual = (item.secoes || [])[0] || '';
    $m('#ens-secao').innerHTML = '<option value="">— nenhum —</option>' + (secoesManual[$m('#ens-publico').value] || [])
      .map((s) => `<option value="${esc(s.id)}"${s.id === atual ? ' selected' : ''}>${esc(s.titulo)}</option>`).join('');
  };
  opcoesSecao();
  $m('#ens-publico').addEventListener('change', opcoesSecao);
  const fechar = () => fundo.remove();
  $m('[data-cancelar]').addEventListener('click', fechar);
  fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(); });
  $m('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const corpo = {
      publico: $m('#ens-publico').value,
      pergunta: $m('#ens-pergunta').value,
      resposta: $m('#ens-resposta').value,
      secoes: $m('#ens-secao').value ? [$m('#ens-secao').value] : [],
      origem_pergunta_id: item.origem_pergunta_id || null
    };
    try {
      await apiFetch(item.id ? `/ajuda/memoria/${item.id}` : '/ajuda/memoria', { method: item.id ? 'PUT' : 'POST', body: corpo });
      notificar('Pronto! O assistente já usa essa resposta.', 'sucesso');
      fechar();
      carregarMemoria();
    } catch (err) {
      $m('#ens-erro').textContent = err.message;
    }
  });
  setTimeout(() => $m(item.pergunta ? '#ens-resposta' : '#ens-pergunta').focus(), 50);
}
