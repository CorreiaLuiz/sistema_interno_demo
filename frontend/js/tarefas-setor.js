exigirLogin();
inicializarShell();

const SETOR = document.body.dataset.setor; // 'fiscal' | 'contabilidade' | 'folha_pagamento'

const RÓTULOS_SETOR = {
  fiscal: 'Setor Fiscal',
  contabilidade: 'Setor Contábil',
  folha_pagamento: 'Folha de Pagamento'
};

// Guarda de acesso: administrador, o supervisor do próprio setor, ou o
// colaborador desse mesmo setor especificamente (colaborador_fiscal só
// entra em /fiscal, nunca em /contabilidade ou /folha_pagamento).
const usuarioLogado = getUsuario();
const ehGestorDoSetor = usuarioLogado && (usuarioLogado.role === 'administrador' || usuarioLogado.role === `supervisor_${SETOR}`);
const ehColaborador = usuarioLogado && usuarioLogado.role === `colaborador_${SETOR}`;

if (usuarioLogado && !ehGestorDoSetor && !ehColaborador) {
  window.location.href = '/pages/dashboard.html';
}

const RÓTULOS_STATUS = { pendente: 'Pendente', em_andamento: 'Em Andamento', concluido: 'Concluído' };
const CLASSE_BADGE = { pendente: 'badge-pendente', em_andamento: 'badge-em-andamento', concluido: 'badge-concluido' };
const CORES_RESUMO = { pendente: 'emissao_pendente', em_andamento: 'a_vencer', concluido: 'valida', atrasadas: 'vencida' };

let paginaAtual = 1;
const LIMITE = 20;
let listaEmpresas = [];

function badgeStatus(status) {
  return `<span class="badge ${CLASSE_BADGE[status] || ''}">${RÓTULOS_STATUS[status] || status}</span>`;
}

/** Prazo com destaque: atrasada (vermelho), vence hoje, ou a data. */
function htmlPrazo(tarefa) {
  if (!tarefa.prazo) return '<span class="prazo-tarefa" style="color:var(--color-text-faint);">—</span>';
  const prazo = new Date(tarefa.prazo);
  const data = prazo.toLocaleDateString('pt-BR');
  const hora = prazo.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (tarefa.atrasada) {
    const dias = Math.floor((Date.now() - prazo.getTime()) / 86400000);
    return `<span class="prazo-tarefa atrasada">${data}<span class="sub">Atrasada${dias >= 1 ? ` há ${dias} dia(s)` : ''}</span></span>`;
  }
  const ehHoje = prazo.toDateString() === new Date().toDateString();
  return `<span class="prazo-tarefa">${data}<span class="sub">${ehHoje && tarefa.status !== 'concluido' ? 'Vence hoje, ' : ''}${hora}</span></span>`;
}

/** Parâmetros dos filtros da tela (status + "Mostrar"). */
function parametrosFiltro() {
  const params = new URLSearchParams();
  const status = document.getElementById('filtro-status').value;
  const mostrar = document.getElementById('filtro-mostrar').value;
  if (status) params.append('status', status);
  if (mostrar === 'minhas') params.append('minhas', '1');
  if (mostrar === 'atrasadas') params.append('atrasadas', '1');
  if (mostrar === 'pedidos_cliente') params.append('pedidos_cliente', '1');
  return params;
}

async function carregarEmpresasNoSelect() {
  const resultado = await apiFetch('/empresas?limite=500');
  listaEmpresas = resultado ? resultado.dados : [];
  const select = document.getElementById('tarefa-empresa');
  select.innerHTML = listaEmpresas
    .map((emp) => `<option value="${emp.id}">${esc(emp.razao_social)} — ${esc(emp.cnpj)}</option>`)
    .join('');
}

async function carregarResumo() {
  const resumo = await apiFetch(`/tarefas-setor/${SETOR}/resumo`);
  const el = document.getElementById('resumo-tarefas');
  if (!resumo) return;
  const cards = ['pendente', 'em_andamento', 'concluido'].map((status) => `
    <div class="resumo-card ${CORES_RESUMO[status]}">
      <span class="numero">${resumo[status] || 0}</span>
      <span class="rotulo">${RÓTULOS_STATUS[status]}</span>
    </div>
  `);
  // Card de atrasadas só aparece quando há alguma — clicar filtra a lista
  if (resumo.atrasadas) {
    cards.unshift(`
      <button type="button" class="resumo-card ${CORES_RESUMO.atrasadas}" id="card-atrasadas" style="text-align:left; cursor:pointer;" title="Ver só as atrasadas">
        <span class="numero" style="color:var(--color-carmine);">${resumo.atrasadas}</span>
        <span class="rotulo">Atrasadas</span>
      </button>`);
  }
  el.innerHTML = cards.join('');
  const cardAtrasadas = document.getElementById('card-atrasadas');
  if (cardAtrasadas) {
    cardAtrasadas.addEventListener('click', () => {
      document.getElementById('filtro-mostrar').value = 'atrasadas';
      paginaAtual = 1;
      carregarTarefas();
    });
  }
}

function atualizarControlesPagina(total) {
  const totalPaginas = Math.max(1, Math.ceil(total / LIMITE));
  document.getElementById('info-pagina').textContent = `Página ${paginaAtual} de ${totalPaginas} (${total} ao todo)`;
  document.getElementById('btn-pagina-anterior').disabled = paginaAtual <= 1;
  document.getElementById('btn-proxima-pagina').disabled = paginaAtual >= totalPaginas;
}

async function carregarTarefas() {
  const params = parametrosFiltro();
  params.append('pagina', paginaAtual);
  params.append('limite', LIMITE);

  const resultado = await apiFetch(`/tarefas-setor/${SETOR}?${params.toString()}`);
  const tbody = document.getElementById('tabela-tarefas');
  tbody.innerHTML = '';

  atualizarControlesPagina(resultado ? resultado.total : 0);

  if (!resultado || resultado.dados.length === 0) {
    const filtrando = document.getElementById('filtro-status').value || document.getElementById('filtro-mostrar').value;
    tbody.innerHTML = `<tr><td colspan="6">${filtrando ? 'Nenhuma tarefa com esse filtro.' : 'Nenhuma tarefa cadastrada ainda.'}</td></tr>`;
    return;
  }

  resultado.dados.forEach((tarefa) => {
    const podeEditarEstaTarefa = ehGestorDoSetor ||
      (ehColaborador && usuarioLogado.email && tarefa.responsavel_email &&
       tarefa.responsavel_email.toLowerCase() === usuarioLogado.email.toLowerCase());

    // Pedido feito pelo cliente na Área do Cliente: concluir exige responder
    // (e normalmente anexar a guia), para o cliente ser avisado.
    const ehPedidoCliente = !!tarefa.solicitado_por_cliente;
    const pedidoAberto = ehPedidoCliente && tarefa.status !== 'concluido';

    const tr = document.createElement('tr');
    if (tarefa.atrasada) tr.className = 'linha-atrasada';
    tr.innerHTML = `
      <td>${linkEmpresa(tarefa.empresa_id, tarefa.razao_social)}</td>
      <td>
        ${ehPedidoCliente ? htmlPedidoCliente(tarefa.descricao) : `<span style="white-space:pre-line;">${esc(tarefa.descricao)}</span>`}
        ${ehPedidoCliente && tarefa.status === 'concluido' ? `
          <div style="font-size:var(--text-xs); color:var(--color-text-muted); margin-top:4px;">
            Respondido${tarefa.documento_resposta_nome ? ' com o arquivo ' + esc(tarefa.documento_resposta_nome) : ''}${tarefa.resposta_cliente ? ': ' + esc(tarefa.resposta_cliente) : ''}
          </div>` : ''}
      </td>
      <td>${esc(tarefa.responsavel_nome) || '—'}<br><span class="email-responsavel">${esc(tarefa.responsavel_email) || (ehPedidoCliente ? 'sem responsável definido' : '')}</span></td>
      <td>${htmlPrazo(tarefa)}</td>
      <td>${badgeStatus(tarefa.status)}</td>
      <td><div class="acoes-linha">
        ${podeEditarEstaTarefa ? `<div class="${pedidoAberto ? 'acoes-pedido' : 'acoes-linha'}">
          <select data-status-tarefa="${tarefa.id}" aria-label="Alterar status">
            <option value="pendente" ${tarefa.status === 'pendente' ? 'selected' : ''}>Pendente</option>
            <option value="em_andamento" ${tarefa.status === 'em_andamento' ? 'selected' : ''}>Em Andamento</option>
            ${pedidoAberto ? '' : `<option value="concluido" ${tarefa.status === 'concluido' ? 'selected' : ''}>Concluído</option>`}
          </select>
          ${pedidoAberto ? `<button class="btn" style="height:32px; padding:0 12px; font-size:var(--text-xs);" data-concluir-pedido="${tarefa.id}">Concluir e responder</button>` : ''}
        </div>` : '<span style="font-size:var(--text-xs); color:var(--color-text-faint);">Somente leitura</span>'}
        ${ehGestorDoSetor ? `<button class="btn-icone perigo" data-excluir="${tarefa.id}" title="Excluir tarefa" aria-label="Excluir tarefa"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>` : ''}
      </div></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('[data-status-tarefa]').forEach((sel) => {
    sel.addEventListener('change', async () => {
      try {
        await apiFetch(`/tarefas-setor/${SETOR}/${sel.dataset.statusTarefa}`, {
          method: 'PUT',
          body: { status: sel.value }
        });
        notificar('Status atualizado.', 'sucesso');
        carregarTarefas();
        carregarResumo();
      } catch (err) {
        notificar(err.message, 'erro');
      }
    });
  });

  tbody.querySelectorAll('[data-concluir-pedido]').forEach((btn) => {
    const tarefa = resultado.dados.find((t) => t.id === btn.dataset.concluirPedido);
    btn.addEventListener('click', () => abrirModalConcluirPedido(tarefa, SETOR, () => { carregarTarefas(); carregarResumo(); }));
  });

  tbody.querySelectorAll('[data-excluir]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!(await confirmarAcao('Excluir esta tarefa? Esta ação não pode ser desfeita.', 'Excluir'))) return;
      try {
        await apiFetch(`/tarefas-setor/${SETOR}/${btn.dataset.excluir}`, { method: 'DELETE' });
        carregarTarefas();
        carregarResumo();
      } catch (err) {
        notificar(err.message, 'erro');
      }
    });
  });
}

// --- Exportar para Excel (com os filtros da tela) ---
document.getElementById('btn-exportar').addEventListener('click', async () => {
  try {
    const params = parametrosFiltro();
    params.append('limite', 5000);
    const resultado = await apiFetch(`/tarefas-setor/${SETOR}?${params.toString()}`);
    const linhas = resultado ? resultado.dados : [];
    if (!linhas.length) { notificar('Nenhuma tarefa para exportar com esse filtro.', 'info'); return; }
    exportarExcel(`tarefas_${SETOR}`, [
      { titulo: 'Empresa', valor: (t) => t.razao_social },
      { titulo: 'CNPJ', valor: (t) => t.cnpj },
      { titulo: 'Atividade', valor: (t) => t.descricao },
      { titulo: 'Pedido do cliente', valor: (t) => (t.solicitado_por_cliente ? 'Sim' : 'Não') },
      { titulo: 'Responsável', valor: (t) => t.responsavel_nome },
      { titulo: 'E-mail do responsável', valor: (t) => t.responsavel_email },
      { titulo: 'Prazo', valor: (t) => (t.prazo ? new Date(t.prazo).toLocaleString('pt-BR') : '') },
      { titulo: 'Atrasada', valor: (t) => (t.atrasada ? 'Sim' : '') },
      { titulo: 'Status', valor: (t) => RÓTULOS_STATUS[t.status] || t.status },
      { titulo: 'Criada em', valor: (t) => new Date(t.criado_em).toLocaleString('pt-BR') },
      { titulo: 'Concluída em', valor: (t) => (t.concluido_em ? new Date(t.concluido_em).toLocaleString('pt-BR') : '') }
    ], linhas);
  } catch (err) {
    notificar(err.message, 'erro');
  }
});

// --- Modal de nova tarefa ---
const modal = document.getElementById('modal-tarefa');
const form = document.getElementById('form-tarefa');
const erroTarefa = document.getElementById('erro-tarefa');

document.getElementById('btn-nova-tarefa').addEventListener('click', () => {
  erroTarefa.textContent = '';
  form.reset();
  modal.classList.add('aberto');
});

document.getElementById('btn-cancelar-tarefa').addEventListener('click', () => {
  modal.classList.remove('aberto');
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  erroTarefa.textContent = '';

  const prazoInput = document.getElementById('tarefa-prazo').value; // formato datetime-local: "2026-09-20T14:00"
  const corpo = {
    empresa_id: document.getElementById('tarefa-empresa').value,
    descricao: document.getElementById('tarefa-descricao').value,
    responsavel_nome: document.getElementById('tarefa-responsavel-nome').value,
    responsavel_email: document.getElementById('tarefa-responsavel-email').value,
    prazo: prazoInput || null
  };

  try {
    await apiFetch(`/tarefas-setor/${SETOR}`, { method: 'POST', body: corpo });
    modal.classList.remove('aberto');
    notificar(
      prazoInput
        ? 'Tarefa criada — responsável avisado no sistema e por e-mail, e evento criado no Outlook.'
        : 'Tarefa criada — responsável avisado no sistema e por e-mail.',
      'sucesso'
    );
    carregarTarefas();
    carregarResumo();
  } catch (err) {
    erroTarefa.textContent = err.message;
  }
});

document.getElementById('btn-filtrar').addEventListener('click', () => {
  paginaAtual = 1;
  carregarTarefas();
});
document.getElementById('filtro-mostrar').addEventListener('change', () => {
  paginaAtual = 1;
  carregarTarefas();
});
document.getElementById('btn-pagina-anterior').addEventListener('click', () => {
  if (paginaAtual > 1) { paginaAtual--; carregarTarefas(); }
});
document.getElementById('btn-proxima-pagina').addEventListener('click', () => {
  paginaAtual++; carregarTarefas();
});

(async function iniciar() {
  // Colaborador só visualiza — quem cria tarefa é sempre o gestor do setor
  if (!ehGestorDoSetor) {
    document.getElementById('btn-nova-tarefa').style.display = 'none';
    // Colaborador já só vê as próprias; "Minhas tarefas" seria redundante
    const opcaoMinhas = document.querySelector('#filtro-mostrar option[value="minhas"]');
    if (opcaoMinhas) opcaoMinhas.remove();
  }
  // Atalho vindo do Dashboard / sininho: ?mostrar=pedidos_cliente
  const mostrar = new URLSearchParams(window.location.search).get('mostrar');
  if (mostrar && document.querySelector(`#filtro-mostrar option[value="${mostrar}"]`)) {
    document.getElementById('filtro-mostrar').value = mostrar;
  }
  await carregarEmpresasNoSelect();
  await carregarResumo();
  await carregarTarefas();
})();
