const { query } = require('../config/db');

const HistoricoComunicacao = {
  async registrar({ empresaId, processoId, canal, destinatario, assunto, mensagem, status, erro, enviadoPor }) {
    const { rows } = await query(
      `INSERT INTO historico_comunicacao
        (empresa_id, processo_id, canal, destinatario, assunto, mensagem, status, erro, enviado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [empresaId, processoId || null, canal, destinatario, assunto || null, mensagem, status || 'enviado', erro || null, enviadoPor || null]
    );
    return rows[0];
  },

  async listarPorEmpresa(empresaId) {
    const { rows } = await query(
      'SELECT * FROM historico_comunicacao WHERE empresa_id = $1 ORDER BY criado_em DESC LIMIT 100',
      [empresaId]
    );
    return rows;
  }
};

module.exports = HistoricoComunicacao;
