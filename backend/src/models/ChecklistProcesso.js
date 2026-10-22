const { query } = require('../config/db');
const { CHECKLIST_PADRAO } = require('../config/checklistLegalizacao');

/** Checklist de documentos de cada processo de legalização. */
const ChecklistProcesso = {
  async criarPadrao(processoId, tipo) {
    const itens = CHECKLIST_PADRAO[tipo] || [];
    for (let i = 0; i < itens.length; i++) {
      await query(
        `INSERT INTO checklist_documentos_processo (processo_id, nome, etapa_nome, obrigatorio, ordem)
         VALUES ($1, $2, $3, $4, $5)`,
        [processoId, itens[i].nome, itens[i].etapa || null, itens[i].obrigatorio !== false, i]
      );
    }
    await query('UPDATE processos_legalizacao SET checklist_iniciado = TRUE WHERE id = $1', [processoId]);
  },

  /**
   * Itens do processo. Processos criados antes do checklist existir
   * ganham a lista padrão na primeira vez que alguém abre.
   */
  async listar(processoId) {
    const { rows: [processo] } = await query(
      'SELECT tipo, checklist_iniciado FROM processos_legalizacao WHERE id = $1', [processoId]
    );
    if (processo && !processo.checklist_iniciado) await this.criarPadrao(processoId, processo.tipo);

    const { rows } = await query(
      `SELECT c.*, d.nome_original AS documento_nome, u.nome AS recebido_por_nome
       FROM checklist_documentos_processo c
       LEFT JOIN documentos d ON d.id = c.documento_id
       LEFT JOIN usuarios u ON u.id = c.recebido_por
       WHERE c.processo_id = $1
       ORDER BY c.ordem, c.criado_em`,
      [processoId]
    );
    return rows;
  },

  /** Garante a lista padrão nos processos que ainda não têm (usado pelo quadro). */
  async iniciarPendentes(processos) {
    for (const p of processos) {
      if (!p.checklist_iniciado) await this.criarPadrao(p.id, p.tipo);
    }
  },

  async buscarPorId(id) {
    const { rows } = await query('SELECT * FROM checklist_documentos_processo WHERE id = $1', [id]);
    return rows[0] || null;
  },

  async adicionar(processoId, { nome, etapaNome, obrigatorio }) {
    const { rows: [{ proxima }] } = await query(
      'SELECT COALESCE(MAX(ordem), -1) + 1 AS proxima FROM checklist_documentos_processo WHERE processo_id = $1',
      [processoId]
    );
    const { rows } = await query(
      `INSERT INTO checklist_documentos_processo (processo_id, nome, etapa_nome, obrigatorio, ordem)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [processoId, nome, etapaNome || null, obrigatorio !== false, proxima]
    );
    return rows[0];
  },

  /** Marca como recebido/pendente e/ou vincula o arquivo enviado. */
  async atualizar(id, { recebido, documentoId, usuarioId }) {
    const { rows } = await query(
      `UPDATE checklist_documentos_processo SET
         recebido = COALESCE($2, recebido),
         recebido_em = CASE WHEN $2 IS TRUE AND recebido IS NOT TRUE THEN NOW()
                            WHEN $2 IS FALSE THEN NULL ELSE recebido_em END,
         recebido_por = CASE WHEN $2 IS TRUE AND recebido IS NOT TRUE THEN $4
                             WHEN $2 IS FALSE THEN NULL ELSE recebido_por END,
         documento_id = COALESCE($3, documento_id)
       WHERE id = $1 RETURNING *`,
      [id, recebido === undefined ? null : recebido, documentoId || null, usuarioId || null]
    );
    return rows[0];
  },

  async remover(id) {
    await query('DELETE FROM checklist_documentos_processo WHERE id = $1', [id]);
  },

  /** { processo_id: { recebidos, total } } — só itens obrigatórios contam. */
  async contagens(processoIds) {
    if (!processoIds.length) return {};
    const { rows } = await query(
      `SELECT processo_id,
              COUNT(*) FILTER (WHERE obrigatorio)::int AS total,
              COUNT(*) FILTER (WHERE obrigatorio AND recebido)::int AS recebidos
       FROM checklist_documentos_processo
       WHERE processo_id = ANY($1)
       GROUP BY processo_id`,
      [processoIds]
    );
    return Object.fromEntries(rows.map((r) => [r.processo_id, { total: r.total, recebidos: r.recebidos }]));
  }
};

module.exports = ChecklistProcesso;
