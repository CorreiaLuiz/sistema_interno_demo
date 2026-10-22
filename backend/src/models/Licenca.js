const { query } = require('../config/db');

const Licenca = {
  async listar({ empresaId, status, tipo, pagina = 1, limite = 20 }) {
    const offset = (pagina - 1) * limite;
    const condicoes = [];
    const params = [];
    let idx = 1;

    if (empresaId) {
      condicoes.push(`l.empresa_id = $${idx}`);
      params.push(empresaId);
      idx++;
    }
    if (status) {
      condicoes.push(`l.status = $${idx}`);
      params.push(status);
      idx++;
    }
    if (tipo) {
      condicoes.push(`l.tipo = $${idx}`);
      params.push(tipo);
      idx++;
    }

    const whereSql = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';

    const sql = `
      SELECT l.*, e.razao_social, e.cnpj
      FROM licencas l
      JOIN empresas e ON e.id = l.empresa_id
      ${whereSql}
      ORDER BY
        CASE l.status
          WHEN 'vencida' THEN 0
          WHEN 'a_vencer' THEN 1
          WHEN 'emissao_pendente' THEN 2
          ELSE 3
        END,
        l.data_validade ASC NULLS LAST
      LIMIT $${idx} OFFSET $${idx + 1}
    `;
    params.push(limite, offset);

    const { rows } = await query(sql, params);

    const { rows: totalRows } = await query(
      `SELECT COUNT(*)::int AS total FROM licencas l ${whereSql}`,
      params.slice(0, condicoes.length)
    );

    return { dados: rows, total: totalRows[0].total, pagina, limite };
  },

  async buscarPorId(id) {
    const sql = `
      SELECT l.*, e.razao_social, e.cnpj
      FROM licencas l
      JOIN empresas e ON e.id = l.empresa_id
      WHERE l.id = $1
    `;
    const { rows } = await query(sql, [id]);
    if (!rows[0]) return null;

    const { rows: renovacoes } = await query(
      'SELECT * FROM licencas_renovacoes WHERE licenca_id = $1 ORDER BY data_renovacao DESC',
      [id]
    );
    return { ...rows[0], renovacoes };
  },

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

  async criar(dados) {
    const status = this.calcularStatus(dados.data_validade);
    const sql = `
      INSERT INTO licencas (
        empresa_id, tipo, orgao_emissor, numero_licenca, status,
        data_emissao, data_validade, responsavel_id, observacoes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;
    const params = [
      dados.empresa_id, dados.tipo, dados.orgao_emissor, dados.numero_licenca,
      status, dados.data_emissao, dados.data_validade, dados.responsavel_id,
      dados.observacoes
    ];
    const { rows } = await query(sql, params);
    return rows[0];
  },

  async atualizar(id, dados) {
    const statusCalculado = dados.data_validade !== undefined
      ? this.calcularStatus(dados.data_validade)
      : undefined;

    const sql = `
      UPDATE licencas SET
        tipo = COALESCE($2, tipo),
        orgao_emissor = COALESCE($3, orgao_emissor),
        numero_licenca = COALESCE($4, numero_licenca),
        status = COALESCE($5, status),
        data_emissao = COALESCE($6, data_emissao),
        data_validade = COALESCE($7, data_validade),
        responsavel_id = COALESCE($8, responsavel_id),
        observacoes = COALESCE($9, observacoes)
      WHERE id = $1
      RETURNING *
    `;
    const params = [
      id, dados.tipo, dados.orgao_emissor, dados.numero_licenca,
      statusCalculado, dados.data_emissao, dados.data_validade,
      dados.responsavel_id, dados.observacoes
    ];
    const { rows } = await query(sql, params);
    return rows[0];
  },

  async remover(id) {
    await query('DELETE FROM licencas WHERE id = $1', [id]);
  },

  async renovar(id, { data_emissao, data_validade, usuario_id, observacoes }) {
    const atual = await query('SELECT data_emissao, data_validade FROM licencas WHERE id = $1', [id]);
    if (!atual.rows[0]) return null;

    await query(
      `INSERT INTO licencas_renovacoes
        (licenca_id, data_emissao_anterior, data_validade_anterior, usuario_id, observacoes)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, atual.rows[0].data_emissao, atual.rows[0].data_validade, usuario_id, observacoes]
    );

    const novoStatus = this.calcularStatus(data_validade);
    const { rows } = await query(
      `UPDATE licencas
       SET data_emissao = $2, data_validade = $3, status = $4
       WHERE id = $1
       RETURNING *`,
      [id, data_emissao, data_validade, novoStatus]
    );
    return rows[0];
  },

  async contarPorStatus() {
    const sql = `SELECT status, COUNT(*)::int AS total FROM licencas GROUP BY status`;
    const { rows } = await query(sql);
    return rows;
  }
};

module.exports = Licenca;
