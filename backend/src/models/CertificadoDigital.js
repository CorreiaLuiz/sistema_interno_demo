const { query } = require('../config/db');

const CertificadoDigital = {
  calcularStatus(dataValidade) {
    if (!dataValidade) return 'emissao_pendente';
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const validade = new Date(dataValidade);
    const em30dias = new Date(hoje);
    em30dias.setDate(em30dias.getDate() + 30);

    if (validade < hoje) return 'vencida';
    if (validade <= em30dias) return 'a_vencer';
    return 'valida';
  },

  async listarPorEmpresa(empresaId) {
    const { rows } = await query(
      `SELECT c.*, d.nome_original AS documento_nome
       FROM certificados_digitais c
       LEFT JOIN documentos d ON d.id = c.documento_id
       WHERE c.empresa_id = $1
       ORDER BY c.criado_em DESC`,
      [empresaId]
    );
    return rows;
  },

  async buscarPorId(id) {
    const { rows } = await query('SELECT * FROM certificados_digitais WHERE id = $1', [id]);
    return rows[0] || null;
  },

  async criar({ empresa_id, tipo, numero_serie, data_emissao, data_validade, documento_id, responsavel_id, observacoes }) {
    const status = this.calcularStatus(data_validade);
    const { rows } = await query(
      `INSERT INTO certificados_digitais
        (empresa_id, tipo, numero_serie, data_emissao, data_validade, status, documento_id, responsavel_id, observacoes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [empresa_id, tipo || 'e-cnpj', numero_serie, data_emissao, data_validade, status, documento_id, responsavel_id, observacoes]
    );
    return rows[0];
  },

  async atualizar(id, { tipo, numero_serie, data_emissao, data_validade, documento_id, observacoes }) {
    const statusCalculado = data_validade !== undefined ? this.calcularStatus(data_validade) : undefined;
    const { rows } = await query(
      `UPDATE certificados_digitais SET
        tipo = COALESCE($2, tipo),
        numero_serie = COALESCE($3, numero_serie),
        data_emissao = COALESCE($4, data_emissao),
        data_validade = COALESCE($5, data_validade),
        status = COALESCE($6, status),
        documento_id = COALESCE($7, documento_id),
        observacoes = COALESCE($8, observacoes)
       WHERE id = $1
       RETURNING *`,
      [id, tipo, numero_serie, data_emissao, data_validade, statusCalculado, documento_id, observacoes]
    );
    return rows[0];
  },

  async remover(id) {
    await query('DELETE FROM certificados_digitais WHERE id = $1', [id]);
  },

  async resumoPorStatus() {
    const { rows } = await query(`SELECT status, COUNT(*)::int AS total FROM certificados_digitais GROUP BY status`);
    return rows;
  }
};

module.exports = CertificadoDigital;
