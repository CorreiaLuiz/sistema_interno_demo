const { query } = require('../config/db');

/**
 * Avisos dentro do sistema (o "sininho" no topo da tela). Cada aviso é de
 * um colaborador. Quem gera os avisos usa `avisar()`, que aceita e-mails
 * e/ou papéis (ex: todos os supervisores fiscais) e nunca lança erro — um
 * aviso que falha não pode quebrar a ação principal.
 */
const Notificacao = {
  async listar(usuarioId, limite = 20) {
    const { rows } = await query(
      `SELECT id, tipo, titulo, mensagem, link, lida, criado_em
       FROM notificacoes WHERE usuario_id = $1
       ORDER BY criado_em DESC LIMIT $2`,
      [usuarioId, limite]
    );
    const { rows: [contagem] } = await query(
      'SELECT COUNT(*)::int AS total FROM notificacoes WHERE usuario_id = $1 AND lida = FALSE',
      [usuarioId]
    );
    return { nao_lidas: contagem.total, dados: rows };
  },

  async marcarLida(id, usuarioId) {
    const { rowCount } = await query(
      'UPDATE notificacoes SET lida = TRUE WHERE id = $1 AND usuario_id = $2',
      [id, usuarioId]
    );
    return rowCount > 0;
  },

  async marcarTodasLidas(usuarioId) {
    await query('UPDATE notificacoes SET lida = TRUE WHERE usuario_id = $1 AND lida = FALSE', [usuarioId]);
  },

  /** Avisos lidos com mais de 90 dias somem (chamado pelo job diário). */
  async limparAntigas() {
    await query(`DELETE FROM notificacoes WHERE lida = TRUE AND criado_em < NOW() - INTERVAL '90 days'`);
  },

  /**
   * Cria o aviso para cada colaborador ATIVO encontrado pelos e-mails e/ou
   * papéis informados (sem repetir a mesma pessoa). `excetoUsuarioId`
   * evita avisar a própria pessoa que fez a ação.
   */
  async avisar({ emails = [], papeis = [], usuarioIds = [], excetoUsuarioId, tipo, titulo, mensagem, link }) {
    try {
      const emailsLimpos = emails.filter(Boolean).map((e) => String(e).toLowerCase());
      const idsLimpos = usuarioIds.filter(Boolean);
      if (!emailsLimpos.length && !papeis.length && !idsLimpos.length) return 0;

      const { rows } = await query(
        `SELECT DISTINCT u.id
         FROM usuarios u JOIN roles r ON r.id = u.role_id
         WHERE u.ativo = TRUE
           AND (LOWER(u.email) = ANY($1) OR r.nome = ANY($2) OR u.id = ANY($3::uuid[]))`,
        [emailsLimpos, papeis, idsLimpos]
      );
      const destinatarios = rows.map((r) => r.id).filter((id) => id !== excetoUsuarioId);
      for (const usuarioId of destinatarios) {
        await query(
          `INSERT INTO notificacoes (usuario_id, tipo, titulo, mensagem, link) VALUES ($1, $2, $3, $4, $5)`,
          [usuarioId, tipo, String(titulo).slice(0, 200), mensagem || null, link || null]
        );
      }
      return destinatarios.length;
    } catch (err) {
      console.error('Falha ao criar aviso no sistema:', err.message);
      return 0;
    }
  }
};

module.exports = Notificacao;
