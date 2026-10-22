const { query } = require('../config/db');

// Etapas padrão sugeridas por tipo de processo — usadas para popular o
// checklist automaticamente quando um processo é criado.
const ETAPAS_PADRAO = {
  abertura: ['Junta Comercial', 'Receita Federal (DBE/CNPJ)', 'Inscrição Estadual', 'Alvará de Funcionamento'],
  alteracao: ['Elaboração do instrumento de alteração', 'Junta Comercial', 'Atualização de cadastros (RFB/SEFAZ/Prefeitura)'],
  baixa: ['Distrato social', 'Baixa na Receita Federal', 'Baixa na Inscrição Estadual', 'Baixa no Município']
};

const STATUS_VALIDOS = ['pendente', 'em_andamento', 'exigencia', 'concluido'];

const EtapaProcesso = {
  STATUS_VALIDOS,
  ETAPAS_PADRAO,

  /** Etapas de vários processos de uma vez (quadro da Legalização). */
  async listarPorProcessos(processoIds) {
    if (!processoIds.length) return [];
    const { rows } = await query(
      `SELECT e.*, u.nome AS responsavel_nome
       FROM etapas_processo e
       LEFT JOIN usuarios u ON u.id = e.responsavel_id
       WHERE e.processo_id = ANY($1)
       ORDER BY e.processo_id, e.ordem, e.criado_em`,
      [processoIds]
    );
    return rows;
  },

  async listarPorProcesso(processoId) {
    const { rows } = await query(
      `SELECT e.*, u.nome AS responsavel_nome, u.email AS responsavel_email
       FROM etapas_processo e
       LEFT JOIN usuarios u ON u.id = e.responsavel_id
       WHERE e.processo_id = $1
       ORDER BY e.ordem ASC, e.criado_em ASC`,
      [processoId]
    );
    return rows;
  },

  /**
   * Busca uma etapa por id, já trazendo dados do responsável e do
   * processo/empresa (necessário para montar o e-mail de notificação).
   */
  async buscarPorId(etapaId) {
    const { rows } = await query(
      `SELECT e.*, u.nome AS responsavel_nome, u.email AS responsavel_email,
              p.tipo AS processo_tipo, p.empresa_id
       FROM etapas_processo e
       JOIN processos_legalizacao p ON p.id = e.processo_id
       LEFT JOIN usuarios u ON u.id = e.responsavel_id
       WHERE e.id = $1`,
      [etapaId]
    );
    return rows[0] || null;
  },

  async criarEtapasPadrao(processoId, tipo) {
    const nomes = ETAPAS_PADRAO[tipo] || [];
    for (let i = 0; i < nomes.length; i++) {
      await query(
        'INSERT INTO etapas_processo (processo_id, nome, ordem) VALUES ($1, $2, $3)',
        [processoId, nomes[i], i]
      );
    }
    return this.listarPorProcesso(processoId);
  },

  async adicionarEtapa(processoId, { nome, ordem }) {
    const { rows } = await query(
      'INSERT INTO etapas_processo (processo_id, nome, ordem) VALUES ($1, $2, $3) RETURNING *',
      [processoId, nome, ordem || 0]
    );
    return rows[0];
  },

  /**
   * Atualiza status, responsável e observações de uma etapa. Os três
   * valores devem vir já resolvidos pelo controller (nunca `undefined`
   * — para "não mexer" em um campo, o controller reaproveita o valor
   * atual antes de chamar este método). `responsavelId` pode ser
   * explicitamente `null` para remover o responsável.
   * O booleano legado "concluida" é mantido em sincronia automaticamente
   * por um trigger no banco (ver migração 004).
   */
  async atualizar(etapaId, { status, responsavelId, observacoes }) {
    const { rows } = await query(
      `UPDATE etapas_processo
       SET status = $2,
           responsavel_id = $3,
           observacoes = $4
       WHERE id = $1
       RETURNING *`,
      [etapaId, status, responsavelId, observacoes]
    );
    return rows[0];
  },

  async remover(etapaId) {
    await query('DELETE FROM etapas_processo WHERE id = $1', [etapaId]);
  }
};

module.exports = EtapaProcesso;
