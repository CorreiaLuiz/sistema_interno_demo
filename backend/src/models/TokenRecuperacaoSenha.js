const crypto = require('crypto');
const { query } = require('../config/db');

const TokenRecuperacaoSenha = {
  async gerar(usuarioId, horasValidade = 2) {
    const token = crypto.randomBytes(24).toString('hex');
    const expiraEm = new Date(Date.now() + horasValidade * 60 * 60 * 1000);

    const { rows } = await query(
      `INSERT INTO tokens_recuperacao_senha (usuario_id, token, expira_em)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [usuarioId, token, expiraEm]
    );
    return rows[0];
  },

  async buscarValido(token) {
    const { rows } = await query(
      `SELECT * FROM tokens_recuperacao_senha
       WHERE token = $1 AND usado = FALSE AND expira_em > NOW()`,
      [token]
    );
    return rows[0] || null;
  },

  async marcarUsado(id) {
    await query('UPDATE tokens_recuperacao_senha SET usado = TRUE WHERE id = $1', [id]);
  }
};

module.exports = TokenRecuperacaoSenha;
