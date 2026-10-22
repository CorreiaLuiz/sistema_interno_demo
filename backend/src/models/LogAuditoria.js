const { query } = require('../config/db');

const LogAuditoria = {
  /**
   * Registra uma ação no log de auditoria. Nunca lança erro para não
   * quebrar a operação principal — só avisa no console se falhar.
   */
  async registrar({ usuarioId, acao, entidade, entidadeId, detalhes }) {
    try {
      await query(
        `INSERT INTO logs_auditoria (usuario_id, acao, entidade, entidade_id, detalhes)
         VALUES ($1, $2, $3, $4, $5)`,
        [usuarioId || null, acao, entidade, entidadeId || null, detalhes ? JSON.stringify(detalhes) : null]
      );
    } catch (err) {
      console.error('Falha ao registrar log de auditoria:', err.message);
    }
  },

  async listar({ entidade, usuarioId, pagina = 1, limite = 50 }) {
    const offset = (pagina - 1) * limite;
    const condicoes = [];
    const params = [];
    let idx = 1;

    if (entidade) {
      condicoes.push(`l.entidade = $${idx}`);
      params.push(entidade);
      idx++;
    }
    if (usuarioId) {
      condicoes.push(`l.usuario_id = $${idx}`);
      params.push(usuarioId);
      idx++;
    }

    const whereSql = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';

    const sql = `
      SELECT l.*, u.nome AS usuario_nome
      FROM logs_auditoria l
      LEFT JOIN usuarios u ON u.id = l.usuario_id
      ${whereSql}
      ORDER BY l.criado_em DESC
      LIMIT $${idx} OFFSET $${idx + 1}
    `;
    params.push(limite, offset);

    const { rows } = await query(sql, params);

    const { rows: totalRows } = await query(
      `SELECT COUNT(*)::int AS total FROM logs_auditoria l ${whereSql}`,
      params.slice(0, condicoes.length)
    );

    return { dados: rows, total: totalRows[0].total, pagina, limite };
  }
};

module.exports = LogAuditoria;
