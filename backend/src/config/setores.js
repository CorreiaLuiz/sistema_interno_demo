/**
 * Setores que recebem tarefas (tarefas_setor): nome, tela do sistema e
 * quais papéis gerenciam / executam as tarefas de cada um. A Legalização
 * não tem supervisor/colaborador próprios — quem cuida dos pedidos dela é
 * o analista de legalização.
 */
const SETORES = {
  fiscal: {
    rotulo: 'Fiscal',
    pagina: '/pages/fiscal.html',
    gestores: ['supervisor_fiscal'],
    colaboradores: ['colaborador_fiscal']
  },
  contabilidade: {
    rotulo: 'Contabilidade',
    pagina: '/pages/contabilidade.html',
    gestores: ['supervisor_contabilidade'],
    colaboradores: ['colaborador_contabilidade']
  },
  folha_pagamento: {
    rotulo: 'Folha de Pagamento',
    pagina: '/pages/folha-pagamento.html',
    gestores: ['supervisor_folha_pagamento'],
    colaboradores: ['colaborador_folha_pagamento']
  },
  legalizacao: {
    rotulo: 'Legalização',
    pagina: '/pages/processos.html#pedidos',
    gestores: ['analista_legalizacao'],
    colaboradores: []
  }
};

/** Administrador ou gestor do setor: cria, reatribui e exclui tarefas. */
function ehGestorDoSetor(role, setor) {
  return role === 'administrador' || (SETORES[setor] && SETORES[setor].gestores.includes(role));
}

/** Pode ver as tarefas do setor (colaborador só vê as próprias — ver controller). */
function podeVerSetor(role, setor) {
  return ehGestorDoSetor(role, setor) || (SETORES[setor] && SETORES[setor].colaboradores.includes(role));
}

function ehColaboradorDoSetor(role, setor) {
  return !!(SETORES[setor] && SETORES[setor].colaboradores.includes(role));
}

/** Setores que um papel consegue ver (para o Dashboard e a ficha da empresa). */
function setoresVisiveis(role) {
  return Object.keys(SETORES).filter((setor) => podeVerSetor(role, setor));
}

/** Tela do setor já filtrada nos pedidos de clientes. */
function linkPedidosCliente(setor) {
  return setor === 'legalizacao' ? SETORES.legalizacao.pagina : `${SETORES[setor].pagina}?mostrar=pedidos_cliente`;
}

module.exports = { SETORES, ehGestorDoSetor, podeVerSetor, ehColaboradorDoSetor, setoresVisiveis, linkPedidosCliente };
