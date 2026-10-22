const { query } = require('../config/db');

const ProcessoLegalizacao = {
  async listar({ empresaId, status, tipo, pagina = 1, limite = 20 }) {
    const offset = (pagina - 1) * limite;
    const condicoes = [];
    const params = [];
    let idx = 1;

    if (empresaId) {
      condicoes.push(`p.empresa_id = $${idx}`);
      params.push(empresaId);
      idx++;
    }
    if (status) {
      condicoes.push(`p.status = $${idx}`);
      params.push(status);
      idx++;
    }
    if (tipo) {
      condicoes.push(`p.tipo = $${idx}`);
      params.push(tipo);
      idx++;
    }

    const whereSql = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';

    const sql = `
      SELECT p.*, e.razao_social, e.cnpj
      FROM processos_legalizacao p
      JOIN empresas e ON e.id = p.empresa_id
      ${whereSql}
      ORDER BY
        CASE p.status
          WHEN 'exigencia' THEN 0
          WHEN 'em_andamento' THEN 1
          WHEN 'concluido' THEN 2
          ELSE 3
        END,
        p.data_prevista_conclusao ASC NULLS LAST
      LIMIT $${idx} OFFSET $${idx + 1}
    `;
    params.push(limite, offset);

    const { rows } = await query(sql, params);

    const { rows: totalRows } = await query(
      `SELECT COUNT(*)::int AS total FROM processos_legalizacao p ${whereSql}`,
      params.slice(0, condicoes.length)
    );

    return { dados: rows, total: totalRows[0].total, pagina, limite };
  },

  async buscarPorId(id) {
    const sql = `
      SELECT p.*, e.razao_social, e.cnpj
      FROM processos_legalizacao p
      JOIN empresas e ON e.id = p.empresa_id
      WHERE p.id = $1
    `;
    const { rows } = await query(sql, [id]);
    if (!rows[0]) return null;

    const { rows: historico } = await query(
      `SELECT h.*, u.nome AS usuario_nome
       FROM processos_legalizacao_historico h
       LEFT JOIN usuarios u ON u.id = h.usuario_id
       WHERE h.processo_id = $1
       ORDER BY h.criado_em DESC`,
      [id]
    );
    return { ...rows[0], historico };
  },

  async criar(dados) {
    const sql = `
      INSERT INTO processos_legalizacao (
        empresa_id, tipo, descricao, status, orgao, protocolo,
        data_abertura_processo, data_prevista_conclusao, responsavel_id, observacoes
      ) VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, CURRENT_DATE), $8, $9, $10)
      RETURNING *
    `;
    const params = [
      dados.empresa_id, dados.tipo, dados.descricao, dados.status || 'em_andamento',
      dados.orgao, dados.protocolo, dados.data_abertura_processo,
      dados.data_prevista_conclusao, dados.responsavel_id, dados.observacoes
    ];
    const { rows } = await query(sql, params);

    // Registra a criação já como primeira entrada do histórico
    await query(
      `INSERT INTO processos_legalizacao_historico (processo_id, status_anterior, status_novo, comentario, usuario_id)
       VALUES ($1, NULL, $2, 'Processo criado.', $3)`,
      [rows[0].id, rows[0].status, dados.responsavel_id || null]
    );

    return rows[0];
  },

  /**
   * Atualiza o processo. Se o status mudar, registra automaticamente
   * uma entrada no histórico com o status anterior e o novo.
   */
  async atualizar(id, dados, usuarioId) {
    const atual = await query('SELECT status FROM processos_legalizacao WHERE id = $1', [id]);
    if (!atual.rows[0]) return null;

    const statusAnterior = atual.rows[0].status;
    const dataConclusao = dados.status === 'concluido' ? (dados.data_conclusao || new Date().toISOString().substring(0, 10)) : dados.data_conclusao;

    const sql = `
      UPDATE processos_legalizacao SET
        tipo = COALESCE($2, tipo),
        descricao = COALESCE($3, descricao),
        status = COALESCE($4, status),
        orgao = COALESCE($5, orgao),
        protocolo = COALESCE($6, protocolo),
        data_prevista_conclusao = COALESCE($7, data_prevista_conclusao),
        data_conclusao = COALESCE($8, data_conclusao),
        responsavel_id = COALESCE($9, responsavel_id),
        observacoes = COALESCE($10, observacoes)
      WHERE id = $1
      RETURNING *
    `;
    const params = [
      id, dados.tipo, dados.descricao, dados.status, dados.orgao, dados.protocolo,
      dados.data_prevista_conclusao, dataConclusao, dados.responsavel_id, dados.observacoes
    ];
    const { rows } = await query(sql, params);

    if (dados.status && dados.status !== statusAnterior) {
      await query(
        `INSERT INTO processos_legalizacao_historico (processo_id, status_anterior, status_novo, comentario, usuario_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, statusAnterior, dados.status, dados.comentario_status || null, usuarioId || null]
      );
    }

    return rows[0];
  },

  async remover(id) {
    await query('DELETE FROM processos_legalizacao WHERE id = $1', [id]);
  },

  async contarPorStatus() {
    const sql = `SELECT status, COUNT(*)::int AS total FROM processos_legalizacao GROUP BY status`;
    const { rows } = await query(sql);
    return rows;
  }
};

module.exports = ProcessoLegalizacao;
