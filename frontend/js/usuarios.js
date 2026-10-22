exigirLogin();
inicializarShell();

// Guarda de acesso: só administrador pode ver esta tela
const usuarioLogado = getUsuario();
if (usuarioLogado && !pode('usuarios.gerenciar')) {
  window.location.href = '/pages/dashboard.html';
}

const RÓTULOS_ROLE = {
  administrador: 'Administrador',
  analista_legalizacao: 'Analista de Legalização',
  analista_certidoes: 'Analista de Certidões',
  analista_licencas: 'Analista de Licenças',
  supervisor_fiscal: 'Supervisor Fiscal',
  supervisor_contabilidade: 'Supervisor de Contabilidade',
  supervisor_folha_pagamento: 'Supervisor de Folha de Pagamento',
  colaborador_fiscal: 'Colaborador — Fiscal',
  colaborador_contabilidade: 'Colaborador — Contabilidade',
  colaborador_folha_pagamento: 'Colaborador — Folha de Pagamento',
  colaborador: 'Colaborador (papel antigo)',
  visualizador: 'Visualizador'
};

function formatarDataHora(dataIso) {
  if (!dataIso) return 'Nunca acessou';
  return new Date(dataIso).toLocaleString('pt-BR');
}

const modal = document.getElementById('modal-usuario');
const form = document.getElementById('form-usuario');
const erroUsuario = document.getElementById('erro-usuario');

function abrirModal(usuario = null) {
  erroUsuario.textContent = '';
  form.reset();
  document.getElementById('usuario-id').value = '';
  document.getElementById('titulo-modal-usuario').textContent = usuario ? 'Editar Usuário' : 'Novo Usuário';

  const campoSenha = document.getElementById('campo-senha-usuario');
  const campoAtivo = document.getElementById('campo-ativo-usuario');
  const inputSenha = document.getElementById('usuario-senha');

  if (usuario) {
    document.getElementById('usuario-id').value = usuario.id;
    document.getElementById('usuario-nome').value = usuario.nome;
    document.getElementById('usuario-email').value = usuario.email;
    document.getElementById('usuario-role').value = usuario.role;
    document.getElementById('usuario-ativo').value = String(usuario.ativo);
    campoSenha.style.display = 'none';
    inputSenha.required = false;
    campoAtivo.style.display = 'block';
  } else {
    campoSenha.style.display = 'block';
    inputSenha.required = true;
    campoAtivo.style.display = 'none';
  }

  modal.classList.add('aberto');
}

document.getElementById('btn-novo-usuario').addEventListener('click', () => abrirModal());
document.getElementById('btn-cancelar-usuario').addEventListener('click', () => modal.classList.remove('aberto'));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  erroUsuario.textContent = '';

  const id = document.getElementById('usuario-id').value;
  const nome = document.getElementById('usuario-nome').value;
  const email = document.getElementById('usuario-email').value;
  const role = document.getElementById('usuario-role').value;

  try {
    if (id) {
      await apiFetch(`/auth/usuarios/${id}`, {
        method: 'PUT',
        body: { nome, email, role, ativo: document.getElementById('usuario-ativo').value === 'true' }
      });
    } else {
      const senha = document.getElementById('usuario-senha').value;
      await apiFetch('/auth/usuarios', { method: 'POST', body: { nome, email, senha, role } });
    }
    modal.classList.remove('aberto');
    notificar('Usuário salvo com sucesso.', 'sucesso');
    carregarUsuarios();
  } catch (err) {
    erroUsuario.textContent = err.message;
  }
});

// --- Redefinir senha de outro usuário ---
const modalRedefinir = document.getElementById('modal-redefinir-senha-usuario');
const formRedefinir = document.getElementById('form-redefinir-senha-usuario');
const erroRedefinir = document.getElementById('erro-redefinir-usuario');

document.getElementById('btn-cancelar-redefinir').addEventListener('click', () => modalRedefinir.classList.remove('aberto'));

formRedefinir.addEventListener('submit', async (e) => {
  e.preventDefault();
  erroRedefinir.textContent = '';
  const id = document.getElementById('redefinir-usuario-id').value;
  const novaSenha = document.getElementById('redefinir-nova-senha').value;

  try {
    await apiFetch(`/auth/usuarios/${id}/redefinir-senha`, { method: 'POST', body: { novaSenha } });
    notificar('Senha redefinida com sucesso.', 'sucesso');
    modalRedefinir.classList.remove('aberto');
    formRedefinir.reset();
  } catch (err) {
    erroRedefinir.textContent = err.message;
  }
});

async function carregarUsuarios() {
  const usuarios = await apiFetch('/auth/usuarios');
  const tbody = document.getElementById('tabela-usuarios');
  tbody.innerHTML = '';

  if (!usuarios || usuarios.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6">Nenhum usuário cadastrado.</td></tr>';
    return;
  }

  usuarios.forEach((usuario) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(usuario.nome)}</td>
      <td>${esc(usuario.email)}</td>
      <td>${RÓTULOS_ROLE[usuario.role] || usuario.role}</td>
      <td><span class="badge ${usuario.ativo ? 'badge-ativa' : 'badge-baixada'}">${usuario.ativo ? 'Ativo' : 'Inativo'}</span></td>
      <td>${formatarDataHora(usuario.ultimo_acesso || usuario.ultimo_login)}</td>
      <td class="celula-acoes"><div class="acoes-linha">
        <button class="link-acao" data-editar="${usuario.id}">Editar</button>
        <button class="link-acao" data-redefinir="${usuario.id}">Redefinir senha</button>
      </div></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('[data-editar]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const usuario = usuarios.find((u) => u.id === btn.dataset.editar);
      abrirModal(usuario);
    });
  });

  tbody.querySelectorAll('[data-redefinir]').forEach((btn) => {
    btn.addEventListener('click', () => {
      erroRedefinir.textContent = '';
      formRedefinir.reset();
      document.getElementById('redefinir-usuario-id').value = btn.dataset.redefinir;
      modalRedefinir.classList.add('aberto');
    });
  });
}

carregarUsuarios();

// ===== Permissões dos perfis =====
// Matriz: uma linha por permissão, uma coluna por perfil. Marcar/desmarcar só muda na
// tela; "Salvar permissões" grava tudo de uma vez (e fica na auditoria).
const permEstado = { dados: null, marcadas: new Map() };

function permMudancas() {
  const mudancas = {};
  for (const p of permEstado.dados.permissoes) {
    if (p.soAdmin) continue;
    const agora = [...permEstado.marcadas.get(p.chave)].sort();
    if (agora.join() !== [...p.papeis].sort().join()) mudancas[p.chave] = agora;
  }
  return mudancas;
}

function permAtualizarBotoes() {
  const n = Object.keys(permMudancas()).length;
  document.getElementById('btn-permissoes-salvar').disabled = !n;
  document.getElementById('btn-permissoes-desfazer').disabled = !n;
  document.getElementById('btn-permissoes-salvar').textContent = n ? `Salvar permissões (${n})` : 'Salvar permissões';
}

function permDesenhar(dados) {
  permEstado.dados = dados;
  permEstado.marcadas = new Map(dados.permissoes.map((p) => [p.chave, new Set(p.papeis)]));
  document.getElementById('perm-cabecalho').innerHTML = `<tr><th>O que pode fazer</th><th class="perm-col">Administrador</th>${dados.perfis.map((f) => `<th class="perm-col">${esc(f.rotulo)}</th>`).join('')}</tr>`;
  let grupo = null;
  document.getElementById('perm-corpo').innerHTML = dados.permissoes.map((p) => {
    const titulo = p.grupo !== grupo ? `<tr class="perm-grupo"><td colspan="${dados.perfis.length + 2}">${esc(p.grupo)}</td></tr>` : '';
    grupo = p.grupo;
    return `${titulo}<tr>
      <td class="perm-rotulo">${esc(p.rotulo)}${p.mudada ? ' <span class="perm-mudada" title="Diferente do padrão do sistema">●</span>' : ''}${p.soAdmin ? '<div class="perm-nota">Só o administrador</div>' : ''}</td>
      <td class="perm-col"><input type="checkbox" checked disabled aria-label="Administrador: ${esc(p.rotulo)}"></td>
      ${dados.perfis.map((f) => `<td class="perm-col" data-label="${esc(f.rotulo)}"><input type="checkbox" data-perm="${esc(p.chave)}" data-papel="${esc(f.papel)}"
        ${permEstado.marcadas.get(p.chave).has(f.papel) ? 'checked' : ''} ${p.soAdmin ? 'disabled' : ''} aria-label="${esc(f.rotulo)}: ${esc(p.rotulo)}"></td>`).join('')}
    </tr>`;
  }).join('');
  document.querySelectorAll('[data-perm]').forEach((c) => c.addEventListener('change', () => {
    const s = permEstado.marcadas.get(c.dataset.perm);
    if (c.checked) s.add(c.dataset.papel); else s.delete(c.dataset.papel);
    c.closest('td').classList.toggle('perm-alterada', c.checked !== permEstado.dados.permissoes.find((p) => p.chave === c.dataset.perm).papeis.includes(c.dataset.papel));
    permAtualizarBotoes();
  }));
  permAtualizarBotoes();
}

async function carregarPermissoes() {
  try {
    permDesenhar(await apiFetch('/permissoes'));
  } catch (err) {
    document.getElementById('perm-corpo').innerHTML = `<tr><td>${esc(err.message)}</td></tr>`;
  }
}

document.getElementById('btn-permissoes-desfazer').addEventListener('click', () => permDesenhar(permEstado.dados));
document.getElementById('btn-permissoes-salvar').addEventListener('click', async () => {
  const mudancas = permMudancas();
  const n = Object.keys(mudancas).length;
  if (!n || !(await confirmarAcao(`Salvar ${n} mudança(s) de permissão? Vale na hora para todos os usuários desses perfis.`, 'Salvar'))) return;
  try {
    const r = await apiFetch('/permissoes', { method: 'PUT', body: { mudancas } });
    permDesenhar(r);
    notificar('Permissões salvas.', 'sucesso');
  } catch (err) {
    notificar(err.message, 'erro');
  }
});

carregarPermissoes();
