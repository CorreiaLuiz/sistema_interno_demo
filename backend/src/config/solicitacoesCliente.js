/**
 * Pedidos que o cliente pode abrir pela Área do Cliente. Cada pedido vira
 * uma tarefa no setor correspondente (tarefas_setor), marcada como
 * "pedido do cliente". Para incluir um novo tipo, basta acrescentar aqui —
 * o portal monta a lista a partir deste arquivo.
 *
 * pedeCompetencia: o cliente precisa informar o mês de referência (guias).
 */
const { RESPONSAVEIS } = require('./onboardingResponsaveis');

const SETORES_SOLICITACAO = {
  fiscal: {
    rotulo: 'Fiscal',
    tipos: [
      { valor: 'regerar_das', rotulo: 'Regerar guia do DAS (Simples Nacional)', pedeCompetencia: true },
      { valor: 'regerar_icms', rotulo: 'Regerar guia de ICMS', pedeCompetencia: true },
      { valor: 'regerar_iss', rotulo: 'Regerar guia de ISS', pedeCompetencia: true },
      { valor: 'regerar_pis_cofins', rotulo: 'Regerar guia de PIS/COFINS', pedeCompetencia: true },
      { valor: 'regerar_irpj_csll', rotulo: 'Regerar guia de IRPJ/CSLL', pedeCompetencia: true },
      { valor: 'parcelamento', rotulo: 'Parcelamento de impostos em atraso' },
      { valor: 'nota_fiscal', rotulo: 'Dúvida sobre nota fiscal' },
      { valor: 'outro_fiscal', rotulo: 'Outro assunto fiscal' }
    ]
  },
  folha_pagamento: {
    rotulo: 'Folha de Pagamento',
    tipos: [
      { valor: 'regerar_inss', rotulo: 'Regerar guia do INSS (DCTFWeb)', pedeCompetencia: true },
      { valor: 'regerar_fgts', rotulo: 'Regerar guia do FGTS', pedeCompetencia: true },
      { valor: 'regerar_irrf', rotulo: 'Regerar DARF de IRRF', pedeCompetencia: true },
      { valor: 'segunda_via_holerite', rotulo: '2ª via de holerite / recibo', pedeCompetencia: true },
      { valor: 'admissao', rotulo: 'Admissão de funcionário' },
      { valor: 'ferias', rotulo: 'Férias de funcionário' },
      { valor: 'rescisao', rotulo: 'Rescisão / desligamento' },
      { valor: 'outro_folha', rotulo: 'Outro assunto de folha' }
    ]
  },
  legalizacao: {
    rotulo: 'Legalização',
    tipos: [
      { valor: 'alvara', rotulo: 'Alvará de funcionamento (emissão ou renovação)' },
      { valor: 'alteracao_contratual', rotulo: 'Alteração contratual (endereço, sócios, atividade)' },
      { valor: 'certidao', rotulo: 'Emissão de certidão negativa (CND)' },
      { valor: 'licenca', rotulo: 'Licença (Bombeiros, Vigilância Sanitária, Ambiental)' },
      { valor: 'encerramento', rotulo: 'Encerramento (baixa) da empresa' },
      { valor: 'outro_legalizacao', rotulo: 'Outro assunto de legalização' }
    ]
  },
  contabilidade: {
    rotulo: 'Contábil',
    tipos: [
      { valor: 'balanco_dre', rotulo: 'Balanço / DRE' },
      { valor: 'declaracao_faturamento', rotulo: 'Declaração de faturamento' },
      { valor: 'decore', rotulo: 'DECORE (comprovação de renda)' },
      { valor: 'outro_contabil', rotulo: 'Outro assunto contábil' }
    ]
  }
};

function buscarTipo(setor, tipo) {
  const config = SETORES_SOLICITACAO[setor];
  return config ? config.tipos.find((t) => t.valor === tipo) || null : null;
}

/** Rótulo legível de um tipo de pedido, em qualquer setor (ex: para a tela da equipe). */
function rotuloTipo(tipo) {
  for (const config of Object.values(SETORES_SOLICITACAO)) {
    const encontrado = config.tipos.find((t) => t.valor === tipo);
    if (encontrado) return encontrado.rotulo;
  }
  return tipo;
}

/**
 * Quem recebe o pedido do cliente em cada setor. Usa, nesta ordem:
 * PORTAL_RESPONSAVEL_<SETOR>_EMAIL do .env (se quiser separar), o
 * responsável da esteira de integração (Legalização e os
 * responsáveis de cada setor) ou, sem nada configurado, fica sem
 * responsável (o gestor do setor vê o pedido do mesmo jeito).
 */
const SETOR_NA_ESTEIRA = { fiscal: 'Fiscal', contabilidade: 'Contábil', folha_pagamento: 'Folha de Pagamento' };

function responsavelDoSetor(setor) {
  const doEnv = process.env[`PORTAL_RESPONSAVEL_${setor.toUpperCase()}_EMAIL`];
  if (doEnv) return { nome: null, email: doEnv };
  // Legalização: a responsável da etapa de Legalização da esteira
  const daEsteira = setor === 'legalizacao'
    ? RESPONSAVEIS.legalizacao[0]
    : RESPONSAVEIS.fechamento_setorial.find((r) => r.setor === SETOR_NA_ESTEIRA[setor]);
  if (daEsteira && daEsteira.email) return { nome: daEsteira.nome, email: daEsteira.email };
  return { nome: null, email: null };
}

module.exports = { SETORES_SOLICITACAO, buscarTipo, rotuloTipo, responsavelDoSetor };
