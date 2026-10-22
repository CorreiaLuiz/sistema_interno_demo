const { query } = require('../config/db');

const Usuario = {
  async buscarPorEmail(email) {
    const sql = `
      SELECT u.id, u.nome, u.email, u.senha_hash, u.ativo, r.nome AS role
      FROM usuarios u
      JOIN roles r ON r.id = u.role_id
      WHERE LOWER(u.email) = LOWER($1)
    `;
    const { rows } = await query(sql, [email]);
    return rows[0];
  },

  async buscarPorId(id) {
    const sql = `
      SELECT u.id, u.nome, u.email, u.ativo, u.ultimo_login, r.nome AS role
      FROM usuarios u
      JOIN roles r ON r.id = u.role_id
      WHERE u.id = $1
    `;
    const { rows } = await query(sql, [id]);
    return rows[0];
  },

  async listar() {
    const sql = `
      SELECT u.id, u.nome, u.email, u.ativo, u.ultimo_login, r.nome AS role
      FROM usuarios u
      JOIN roles r ON r.id = u.role_id
      ORDER BY u.nome
    `;
    const { rows } = await query(sql);
    return rows;
  },

  /**
   * Lista usuários ativos elegíveis para serem responsáveis por uma
   * etapa de processo (administradores e analistas de legalização).
   * Acessível a qualquer usuário autenticado, não só administradores —
   * usado para popular o <select> de responsável na tela de Legalização.
   */
  async listarElegiveisParaEtapa() {
    const sql = `
      SELECT u.id, u.nome, r.nome AS role
      FROM usuarios u
      JOIN roles r ON r.id = u.role_id
      WHERE u.ativo = TRUE AND r.nome IN ('administrador', 'analista_legalizacao')
      ORDER BY u.nome
    `;
    const { rows } = await query(sql);
    return rows;
  },

  async criar({ nome, email, senhaHash, roleId }) {
    const sql = `
      INSERT INTO usuarios (nome, email, senha_hash, role_id)
      VALUES ($1, $2, $3, $4)
      RETURNING id, nome, email, role_id, criado_em
    `;
    const { rows } = await query(sql, [nome, email, senhaHash, roleId]);
    return rows[0];
  },

  async atualizarUltimoLogin(id) {
    await query('UPDATE usuarios SET ultimo_login = NOW() WHERE id = $1', [id]);
  },

  async atualizar(id, { nome, email, roleId, ativo }) {
    const sql = `
      UPDATE usuarios
      SET nome = COALESCE($2, nome),
          email = COALESCE($3, email),
          role_id = COALESCE($4, role_id),
          ativo = COALESCE($5, ativo)
      WHERE id = $1
      RETURNING id, nome, email, role_id, ativo
    `;
    const { rows } = await query(sql, [id, nome, email, roleId, ativo]);
    return rows[0];
  },

  async buscarRolePorNome(nomeRole) {
    const { rows } = await query('SELECT id FROM roles WHERE nome = $1', [nomeRole]);
    return rows[0];
  },

  async buscarSenhaHashPorId(id) {
    const { rows } = await query('SELECT senha_hash FROM usuarios WHERE id = $1', [id]);
    return rows[0] ? rows[0].senha_hash : null;
  },

  async atualizarSenha(id, novoHash) {
    await query('UPDATE usuarios SET senha_hash = $2 WHERE id = $1', [id, novoHash]);
  }
};

module.exports = Usuario;
