const crypto = require('crypto');
const { query } = require('../config/db');

/**
 * Clientes com login na Área do Cliente. Um mesmo login (e-mail) pode
 * ter acesso a várias empresas — ex: o sócio com mais de um CNPJ.
 * senha_hash nunca sai deste model para as telas.
 */
const CAMPOS_PUBLICOS = 'c.id, c.nome, c.email, c.telefone, c.ativo, c.ultimo_login, c.criado_em, (c.senha_hash IS NOT NULL) AS senha_definida';

const ClientePortal = {
  async buscarPorId(id) {
    const { rows } = await query(`SELECT ${CAMPOS_PUBLICOS} FROM clientes_portal c WHERE c.id = $1`, [id]);
    return rows[0] || null;
  },

  /** Inclui senha_hash — usado só no login. */
  async buscarParaLogin(email) {
    const { rows } = await query('SELECT * FROM clientes_portal WHERE email = $1', [email]);
    return rows[0] || null;
  },

  async buscarPorEmail(email) {
    const { rows } = await query(`SELECT ${CAMPOS_PUBLICOS} FROM clientes_portal c WHERE c.email = $1`, [email]);
    return rows[0] || null;
  },

  async criar({ nome, email, telefone, criadoPor }) {
    const { rows } = await query(
      `INSERT INTO clientes_portal (nome, email, telefone, criado_por)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [nome || null, email, telefone || null, criadoPor]
    );
    return this.buscarPorId(rows[0].id);
  },

  /** Atualiza nome/telefone só quando vierem preenchidos, e reativa o login. */
  async atualizarContato(id, { nome, telefone }) {
    await query(
      `UPDATE clientes_portal SET
        nome = COALESCE(NULLIF($2, ''), nome),
        telefone = COALESCE(NULLIF($3, ''), telefone),
        ativo = TRUE
       WHERE id = $1`,
      [id, nome || null, telefone || null]
    );
    return this.buscarPorId(id);
  },

  async definirSenha(id, senhaHash) {
    await query('UPDATE clientes_portal SET senha_hash = $2 WHERE id = $1', [id, senhaHash]);
  },

  async buscarSenhaHash(id) {
    const { rows } = await query('SELECT senha_hash FROM clientes_portal WHERE id = $1', [id]);
    return rows[0] ? rows[0].senha_hash : null;
  },

  async registrarLogin(id) {
    await query('UPDATE clientes_portal SET ultimo_login = NOW() WHERE id = $1', [id]);
  },

  // ---------- Empresas liberadas para o login ----------

  /** Empresas que o cliente pode ver — nunca as que já saíram do escritório. */
  async listarEmpresas(clienteId) {
    const { rows } = await query(
      `SELECT e.id, e.razao_social, e.nome_fantasia, e.cnpj, e.regime_tributario
       FROM clientes_portal_empresas ce
       JOIN empresas e ON e.id = ce.empresa_id
       WHERE ce.cliente_id = $1 AND e.situacao <> 'saiu_escritorio'
       ORDER BY e.razao_social`,
      [clienteId]
    );
    return rows;
  },

  async temAcesso(clienteId, empresaId) {
    const { rows } = await query(
      `SELECT 1 FROM clientes_portal_empresas ce
       JOIN empresas e ON e.id = ce.empresa_id
       WHERE ce.cliente_id = $1 AND ce.empresa_id = $2 AND e.situacao <> 'saiu_escritorio'`,
      [clienteId, empresaId]
    );
    return rows.length > 0;
  },

  async liberarEmpresa(clienteId, empresaId, liberadoPor) {
    await query(
      `INSERT INTO clientes_portal_empresas (cliente_id, empresa_id, liberado_por)
       VALUES ($1, $2, $3)
       ON CONFLICT (cliente_id, empresa_id) DO NOTHING`,
      [clienteId, empresaId, liberadoPor]
    );
  },

  async removerEmpresa(clienteId, empresaId) {
    const { rowCount } = await query(
      'DELETE FROM clientes_portal_empresas WHERE cliente_id = $1 AND empresa_id = $2',
      [clienteId, empresaId]
    );
    return rowCount > 0;
  },

  /** Quando a empresa sai do escritório, ninguém mais acessa os dados dela. */
  async removerTodosDaEmpresa(empresaId) {
    await query('DELETE FROM clientes_portal_empresas WHERE empresa_id = $1', [empresaId]);
  },

  /** Logins com acesso a uma empresa — para a tela da equipe. */
  async listarPorEmpresa(empresaId) {
    const { rows } = await query(
      `SELECT ${CAMPOS_PUBLICOS}, ce.criado_em AS liberado_em
       FROM clientes_portal_empresas ce
       JOIN clientes_portal c ON c.id = ce.cliente_id
       WHERE ce.empresa_id = $1
       ORDER BY c.nome NULLS LAST, c.email`,
      [empresaId]
    );
    return rows;
  },

  // ---------- Links de "criar senha" / "esqueci a senha" ----------

  async gerarTokenSenha(clienteId, tipo) {
    const token = crypto.randomBytes(24).toString('hex');
    // Primeiro acesso fica válido por 7 dias (o cliente pode demorar a ver);
    // recuperação de senha, só 2 horas.
    const horas = tipo === 'primeiro_acesso' ? 7 * 24 : 2;
    const expiraEm = new Date(Date.now() + horas * 60 * 60 * 1000);

    // Um link novo invalida os anteriores ainda não usados
    await query('UPDATE tokens_senha_cliente SET usado = TRUE WHERE cliente_id = $1 AND usado = FALSE', [clienteId]);
    await query(
      'INSERT INTO tokens_senha_cliente (cliente_id, token, tipo, expira_em) VALUES ($1, $2, $3, $4)',
      [clienteId, token, tipo, expiraEm]
    );
    return token;
  },

  async buscarTokenSenhaValido(token) {
    const { rows } = await query(
      `SELECT t.*, c.nome, c.email, c.ativo
       FROM tokens_senha_cliente t
       JOIN clientes_portal c ON c.id = t.cliente_id
       WHERE t.token = $1 AND t.usado = FALSE AND t.expira_em > NOW()`,
      [token]
    );
    return rows[0] || null;
  },

  async marcarTokenUsado(id) {
    await query('UPDATE tokens_senha_cliente SET usado = TRUE WHERE id = $1', [id]);
  },

  // ---------- Histórico de downloads ----------

  async registrarDownload({ documento, clienteId, empresaId, ip }) {
    await query(
      `INSERT INTO downloads_portal (documento_id, documento_nome, cliente_id, empresa_id, ip)
       VALUES ($1, $2, $3, $4, $5)`,
      [documento.id, documento.nome_original, clienteId, empresaId, ip ? String(ip).slice(0, 64) : null]
    );
  },

  async listarDownloads(empresaId, limite = 50) {
    const { rows } = await query(
      `SELECT d.id, d.documento_nome, d.criado_em, d.ip, d.origem, c.nome AS cliente_nome, c.email AS cliente_email,
              e.destinatario AS email_destinatario
       FROM downloads_portal d
       LEFT JOIN clientes_portal c ON c.id = d.cliente_id
       LEFT JOIN emails_enviados e ON e.id = d.email_id
       WHERE d.empresa_id = $1
       ORDER BY d.criado_em DESC
       LIMIT $2`,
      [empresaId, limite]
    );
    return rows;
  }
};

module.exports = ClientePortal;
