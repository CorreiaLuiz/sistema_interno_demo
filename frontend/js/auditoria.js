exigirLogin();
inicializarShell();

const usuarioLogado = getUsuario();
if (usuarioLogado && !pode('auditoria.ver')) {
  window.location.href = '/pages/dashboard.html';
}

const RÓTULOS_ACAO = { CREATE: 'Criação', UPDATE: 'Edição', DELETE: 'Exclusão' };
const RÓTULOS_ENTIDADE = {
  empresa: 'Empresa', certidao: 'Certidão', licenca: 'Licença',
  processo_legalizacao: 'Processo de Legalização', etapa_processo: 'Etapa de processo',
  documento: 'Documento', usuario: 'Usuário', tarefa_setor: 'Tarefa de setor',
  acesso_cliente: 'Acesso à Área do Cliente', certificado_digital: 'Certificado digital',
  onboarding_empresa: 'Esteira de empresa nova'
};
const RÓTULOS_CATEGORIA = {
  cartao_cnpj: 'cartão CNPJ', contrato_social: 'contrato social', certidao: 'certidão', alvara: 'alvará',
  certificado_digital: 'certificado digital', guia: 'guia', comprovante: 'comprovante',
  documento_pessoal: 'documento pessoal', outro: 'documento'
};
const RÓTULOS_SETOR = { fiscal: 'Fiscal', contabilidade: 'Contabilidade', folha_pagamento: 'Folha de Pagamento', legalizacao: 'Legalização' };
const RÓTULOS_TIPO_PROCESSO = { abertura: 'abertura', alteracao: 'alteração', baixa: 'baixa' };
const RÓTULOS_ESTAGIO = { legalizacao: 'Legalização', cadastro_dominio: 'Cadastro no Domínio', fechamento_setorial: 'Fechamento setorial' };
const RÓTULOS_PAPEL_AUDITORIA = typeof ROTULOS_PAPEL !== 'undefined' ? ROTULOS_PAPEL : {};

let paginaAtual = 1;
const LIMITE = 30;

function formatarDataHora(dataIso) {
  return new Date(dataIso).toLocaleString('pt-BR');
}

const b = (texto) => `<strong>${esc(texto)}</strong>`;

/**
 * Transforma o registro técnico em uma frase. Usa os campos que cada
 * tela grava em "detalhes"; o que não for reconhecido cai numa lista
 * simples "campo: valor", sem os identificadores internos.
 */
function descrever(log) {
  const d = log.detalhes || {};
  const acao = log.acao;

  switch (log.entidade) {
    case 'empresa':
      if (d.acao_especifica === 'saida_do_escritorio') return `Registrou a saída da empresa do escritório em ${b(formatarDataBR(d.data_saida))}.`;
      if (d.razao_social) return `${acao === 'DELETE' ? 'Excluiu' : 'Cadastrou'} a empresa ${b(d.razao_social)}${d.cnpj ? ` (CNPJ ${esc(d.cnpj)})` : ''}.`;
      if (acao === 'UPDATE') return 'Editou os dados da empresa.';
      break;
    case 'documento':
      if (acao === 'CREATE') return `Enviou ${esc(RÓTULOS_CATEGORIA[d.categoria] || 'documento')} ${b(d.nome_original || '')}${d.visivel_cliente ? ' — visível para o cliente' : ''}.`;
      if (acao === 'UPDATE' && 'visivel_cliente' in d) return `${d.visivel_cliente ? 'Liberou' : 'Ocultou'} ${b(d.nome_original || 'o documento')} ${d.visivel_cliente ? 'para' : 'do'} cliente.`;
      if (acao === 'DELETE') return `Excluiu o documento ${b(d.nome_original || '')}.`;
      break;
    case 'tarefa_setor':
      if (d.acao_especifica === 'pedido_cliente_concluido') return `Concluiu um pedido do cliente${d.documento_id ? ' e anexou o arquivo de resposta' : ''}.`;
      if (acao === 'CREATE') return `Criou uma tarefa no setor ${b(RÓTULOS_SETOR[d.setor] || d.setor || '')}${d.responsavel_email ? ` para ${esc(d.responsavel_email)}` : ''}${d.origem === 'handoff_legalizacao' ? ' (ao concluir a legalização)' : ''}.`;
      if (d.responsavel_novo) return `Repassou a tarefa de ${esc(d.responsavel_anterior || '—')} para ${b(d.responsavel_novo)}.`;
      if (acao === 'UPDATE') return 'Atualizou o status da tarefa.';
      if (acao === 'DELETE') return 'Excluiu uma tarefa.';
      break;
    case 'acesso_cliente':
      if (acao === 'CREATE') return `Liberou o acesso à Área do Cliente para ${b(d.email || '')}.`;
      if (acao === 'DELETE') return 'Removeu o acesso de um cliente à Área do Cliente desta empresa.';
      break;
    case 'processo_legalizacao':
      if (acao === 'CREATE') return `Abriu um processo de ${b(RÓTULOS_TIPO_PROCESSO[d.tipo] || d.tipo || '')}${d.origem === 'handoff_cadastro_empresa' ? ' (automático, no cadastro da empresa)' : ''}.`;
      if (acao === 'UPDATE') return d.status ? `Mudou o status do processo para ${b(d.status)}.` : 'Atualizou o processo de legalização.';
      if (acao === 'DELETE') return 'Excluiu um processo de legalização.';
      break;
    case 'etapa_processo':
      if (acao === 'DELETE') return `Removeu a etapa ${b(d.nome || '')} do processo.`;
      if (d.nome) return `Atualizou a etapa ${b(d.nome)}${d.status ? ` — status: ${esc(d.status)}` : ''}.`;
      break;
    case 'onboarding_empresa':
      if (d.de && d.para) return `Avançou a esteira de ${b(RÓTULOS_ESTAGIO[d.de] || d.de)} para ${b(RÓTULOS_ESTAGIO[d.para] || d.para)}.`;
      break;
    case 'usuario':
      if (d.acao_especifica === 'senha_redefinida_por_admin') return 'Redefiniu a senha do usuário.';
      if (acao === 'CREATE') return `Criou o usuário ${b(d.nome || d.email || '')}${d.role ? ` como ${esc(RÓTULOS_PAPEL_AUDITORIA[d.role] || d.role)}` : ''}.`;
      if (acao === 'UPDATE') return 'Editou os dados do usuário.';
      break;
    default:
      break;
  }

  // Genérico: campos legíveis, sem IDs internos
  const partes = Object.entries(d)
    .filter(([chave, valor]) => valor !== null && valor !== '' && !/(^id$|_id$)/.test(chave))
    .map(([chave, valor]) => `${esc(chave.replace(/_/g, ' '))}: ${b(typeof valor === 'object' ? JSON.stringify(valor) : String(valor))}`);
  const entidade = (RÓTULOS_ENTIDADE[log.entidade] || log.entidade || '').toLowerCase();
  const verbo = { CREATE: 'Criou', UPDATE: 'Alterou', DELETE: 'Excluiu' }[acao] || acao;
  return partes.length ? `${verbo} ${esc(entidade)} — ${partes.join(' · ')}` : `${verbo} ${esc(entidade)}.`;
}

async function carregarAuditoria() {
  const entidade = document.getElementById('filtro-entidade').value;
  const params = new URLSearchParams({ pagina: paginaAtual, limite: LIMITE });
  if (entidade) params.append('entidade', entidade);

  const resultado = await apiFetch(`/auditoria?${params.toString()}`);
  const tbody = document.getElementById('tabela-auditoria');
  tbody.innerHTML = '';

  if (!resultado || resultado.dados.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5">Nenhum registro encontrado.</td></tr>';
  } else {
    resultado.dados.forEach((log) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="white-space:nowrap;">${formatarDataHora(log.criado_em)}</td>
        <td>${esc(log.usuario_nome) || 'Sistema (automático)'}</td>
        <td>${RÓTULOS_ACAO[log.acao] || esc(log.acao)}</td>
        <td>${esc(RÓTULOS_ENTIDADE[log.entidade] || log.entidade)}</td>
        <td><span class="detalhe-auditoria">${descrever(log)}</span></td>
      `;
      tbody.appendChild(tr);
    });
  }

  const totalPaginas = Math.max(1, Math.ceil((resultado ? resultado.total : 0) / LIMITE));
  document.getElementById('info-pagina').textContent = `Página ${paginaAtual} de ${totalPaginas}`;
  document.getElementById('btn-pagina-anterior').disabled = paginaAtual <= 1;
  document.getElementById('btn-proxima-pagina').disabled = paginaAtual >= totalPaginas;
}

// Filtro com todas as entidades registradas (inclusive as novas)
(function montarFiltroEntidades() {
  const select = document.getElementById('filtro-entidade');
  select.innerHTML = '<option value="">Todas as entidades</option>' +
    Object.entries(RÓTULOS_ENTIDADE)
      .sort((a, b2) => a[1].localeCompare(b2[1], 'pt-BR'))
      .map(([valor, rotulo]) => `<option value="${valor}">${esc(rotulo)}</option>`).join('');
})();

document.getElementById('btn-filtrar-auditoria').addEventListener('click', () => {
  paginaAtual = 1;
  carregarAuditoria();
});
document.getElementById('filtro-entidade').addEventListener('change', () => {
  paginaAtual = 1;
  carregarAuditoria();
});

document.getElementById('btn-pagina-anterior').addEventListener('click', () => {
  if (paginaAtual > 1) { paginaAtual--; carregarAuditoria(); }
});

document.getElementById('btn-proxima-pagina').addEventListener('click', () => {
  paginaAtual++;
  carregarAuditoria();
});

carregarAuditoria();
