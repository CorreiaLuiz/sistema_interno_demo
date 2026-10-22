const { query } = require('../config/db');

const CAMPOS_ASSOCIACAO = ['empresa_id', 'processo_id', 'certidao_id', 'licenca_id'];

const Documento = {
  /**
   * Lista documentos associados a exatamente uma entidade.
   * Ex: listarPorAssociacao('empresa_id', '<uuid>')
   */
  async listarPorAssociacao(campo, valor) {
    if (!CAMPOS_ASSOCIACAO.includes(campo)) {
      throw new Error(`Campo de associação inválido: ${campo}`);
    }
    const sql = `
      SELECT d.*, u.nome AS enviado_por_nome, cp.nome AS enviado_por_cliente_nome, cp.email AS enviado_por_cliente_email
      FROM documentos d
      LEFT JOIN usuarios u ON u.id = d.enviado_por
      LEFT JOIN clientes_portal cp ON cp.id = d.enviado_por_cliente
      WHERE d.${campo} = $1
      ORDER BY d.criado_em DESC
    `;
    const { rows } = await query(sql, [valor]);
    return rows;
  },

  async buscarPorId(id) {
    const { rows } = await query('SELECT * FROM documentos WHERE id = $1', [id]);
    return rows[0];
  },

  async criar(dados) {
    const sql = `
      INSERT INTO documentos (
        empresa_id, processo_id, certidao_id, licenca_id,
        nome_original, nome_armazenado, caminho, tipo_mime, tamanho_bytes,
        categoria, descricao, enviado_por, visivel_cliente, enviado_por_cliente
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
    `;
    const params = [
      dados.empresa_id || null, dados.processo_id || null, dados.certidao_id || null,
      dados.licenca_id || null, dados.nome_original, dados.nome_armazenado,
      dados.caminho, dados.tipo_mime, dados.tamanho_bytes, dados.categoria,
      dados.descricao || null, dados.enviado_por || null,
      dados.visivel_cliente === true, dados.enviado_por_cliente || null
    ];
    const { rows } = await query(sql, params);
    return rows[0];
  },

  /**
   * Documentos que o cliente enxerga na Área do Cliente: os que a equipe
   * marcou como visíveis (inclui os que ele mesmo enviou).
   */
  async listarVisiveisCliente(empresaId) {
    const { rows } = await query(
      `SELECT d.id, d.nome_original, d.tipo_mime, d.tamanho_bytes, d.categoria, d.descricao, d.criado_em,
              (d.enviado_por_cliente IS NOT NULL OR d.enviado_por IS NULL) AS enviado_pelo_cliente
       FROM documentos d
       WHERE d.empresa_id = $1 AND d.visivel_cliente = TRUE
       ORDER BY d.criado_em DESC`,
      [empresaId]
    );
    return rows;
  },

  async definirVisibilidadeCliente(id, visivel) {
    const { rows } = await query(
      'UPDATE documentos SET visivel_cliente = $2 WHERE id = $1 RETURNING *',
      [id, visivel === true]
    );
    return rows[0];
  },

  async remover(id) {
    await query('DELETE FROM documentos WHERE id = $1', [id]);
  }
};

module.exports = { Documento, CAMPOS_ASSOCIACAO };
