const { query } = require('../config/db');

const SETORES_VALIDOS = ['fiscal', 'contabilidade', 'folha_pagamento', 'legalizacao'];

// Tarefa atrasada: tem prazo, o prazo já passou e ainda não foi concluída
const SQL_ATRASADA = `(t.prazo IS NOT NULL AND t.prazo < NOW() AND t.status <> 'concluido')`;
const STATUS_VALIDOS = ['pendente', 'em_andamento', 'concluido'];

const TarefaSetor = {
  SETORES_VALIDOS,
  STATUS_VALIDOS,

  async listar({ setor, empresaId, status, responsavelEmail, somenteAtrasadas, somentePedidosCliente, pagina = 1, limite = 20 }) {
    const offset = (pagina - 1) * limite;
    const condicoes = [`t.setor = $1`];
    const params = [setor];
    let idx = 2;

    if (empresaId) {
      condicoes.push(`t.empresa_id = $${idx}`);
      params.push(empresaId);
      idx++;
    }
    if (status) {
      condicoes.push(`t.status = $${idx}`);
      params.push(status);
      idx++;
    }
    if (responsavelEmail) {
      condicoes.push(`LOWER(t.responsavel_email) = LOWER($${idx})`);
      params.push(responsavelEmail);
      idx++;
    }
    if (somenteAtrasadas) condicoes.push(SQL_ATRASADA);
    if (somentePedidosCliente) condicoes.push('t.solicitado_por_cliente IS NOT NULL');

    const whereSql = `WHERE ${condicoes.join(' AND ')}`;
    const paramsContagem = [...params];

    const sql = `
      SELECT t.*, e.razao_social, e.cnpj, u.nome AS criado_por_nome, ${SQL_ATRASADA} AS atrasada,
             cp.nome AS cliente_nome, cp.email AS cliente_email,
             d.nome_original AS documento_resposta_nome
      FROM tarefas_setor t
      JOIN empresas e ON e.id = t.empresa_id
      LEFT JOIN usuarios u ON u.id = t.criado_por
      LEFT JOIN clientes_portal cp ON cp.id = t.solicitado_por_cliente
      LEFT JOIN documentos d ON d.id = t.documento_resposta_id
      ${whereSql}
      ORDER BY
        CASE WHEN t.status = 'concluido' THEN 1 ELSE 0 END,
        ${SQL_ATRASADA} DESC,
        CASE t.status WHEN 'pendente' THEN 0 WHEN 'em_andamento' THEN 1 ELSE 2 END,
        t.prazo ASC NULLS LAST,
        t.criado_em DESC
      LIMIT $${idx} OFFSET $${idx + 1}
    `;
    params.push(limite, offset);

    const { rows } = await query(sql, params);

    const { rows: totalRows } = await query(
      `SELECT COUNT(*)::int AS total FROM tarefas_setor t ${whereSql}`,
      paramsContagem
    );

    return { dados: rows, total: totalRows[0].total, pagina, limite };
  },

  async buscarPorId(id) {
    const { rows } = await query(
      `SELECT t.*, e.razao_social, e.cnpj
       FROM tarefas_setor t
       JOIN empresas e ON e.id = t.empresa_id
       WHERE t.id = $1`,
      [id]
    );
    return rows[0] || null;
  },

  async criar({ empresa_id, setor, descricao, responsavel_nome, responsavel_email, prazo, criado_por }) {
    const { rows } = await query(
      `INSERT INTO tarefas_setor (empresa_id, setor, descricao, responsavel_nome, responsavel_email, prazo, criado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [empresa_id, setor, descricao, responsavel_nome || null, responsavel_email, prazo || null, criado_por]
    );
    return rows[0];
  },

  /** Pedido aberto pelo cliente na Área do Cliente (ex: "Regerar guia do DAS"). */
  async criarPedidoCliente({ empresa_id, setor, descricao, tipo_solicitacao, competencia, responsavel_nome, responsavel_email, cliente_id }) {
    const { rows } = await query(
      `INSERT INTO tarefas_setor
        (empresa_id, setor, descricao, tipo_solicitacao, competencia, responsavel_nome, responsavel_email, solicitado_por_cliente)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [empresa_id, setor, descricao, tipo_solicitacao, competencia || null, responsavel_nome || null, responsavel_email || null, cliente_id]
    );
    return rows[0];
  },

  /** Pedidos feitos pelo portal para uma empresa — o que o cliente acompanha. */
  async listarPedidosCliente(empresaId) {
    const { rows } = await query(
      `SELECT t.id, t.setor, t.tipo_solicitacao, t.competencia, t.descricao, t.status, t.criado_em,
              t.concluido_em, t.resposta_cliente, t.documento_resposta_id,
              d.nome_original AS documento_resposta_nome, cp.nome AS cliente_nome
       FROM tarefas_setor t
       LEFT JOIN documentos d ON d.id = t.documento_resposta_id
       LEFT JOIN clientes_portal cp ON cp.id = t.solicitado_por_cliente
       WHERE t.empresa_id = $1 AND t.solicitado_por_cliente IS NOT NULL
       ORDER BY CASE t.status WHEN 'concluido' THEN 1 ELSE 0 END, t.criado_em DESC
       LIMIT 100`,
      [empresaId]
    );
    return rows;
  },

  /** Conclui o pedido do cliente guardando a resposta e a guia anexada. */
  async concluirPedidoCliente(id, { resposta, documentoId }) {
    const { rows } = await query(
      `UPDATE tarefas_setor SET
        status = 'concluido',
        resposta_cliente = $2,
        documento_resposta_id = COALESCE($3, documento_resposta_id)
       WHERE id = $1
       RETURNING *`,
      [id, resposta || null, documentoId || null]
    );
    return rows[0];
  },

  async atualizar(id, { status, descricao, responsavel_nome, responsavel_email, prazo }) {
    const { rows } = await query(
      `UPDATE tarefas_setor SET
        status = COALESCE($2, status),
        descricao = COALESCE($3, descricao),
        responsavel_nome = COALESCE($4, responsavel_nome),
        responsavel_email = COALESCE($5, responsavel_email),
        prazo = COALESCE($6, prazo)
       WHERE id = $1
       RETURNING *`,
      [id, status, descricao, responsavel_nome, responsavel_email, prazo]
    );
    return rows[0];
  },

  async remover(id) {
    await query('DELETE FROM tarefas_setor WHERE id = $1', [id]);
  },

  /** Contagem por status + uma linha extra { status: 'atrasadas' }. */
  async resumoPorSetor(setor, responsavelEmail) {
    const condicoes = ['t.setor = $1'];
    const params = [setor];
    if (responsavelEmail) {
      condicoes.push('LOWER(t.responsavel_email) = LOWER($2)');
      params.push(responsavelEmail);
    }
    const whereSql = condicoes.join(' AND ');
    const { rows } = await query(
      `SELECT status, COUNT(*)::int AS total FROM tarefas_setor t WHERE ${whereSql} GROUP BY status
       UNION ALL
       SELECT 'atrasadas', COUNT(*)::int FROM tarefas_setor t WHERE ${whereSql} AND ${SQL_ATRASADA}`,
      params
    );
    return rows;
  },

  /** Pedidos de clientes ainda não concluídos, por setor: { fiscal: 2, ... } */
  async contarPedidosClienteAbertos(setores) {
    if (!setores.length) return {};
    const { rows } = await query(
      `SELECT setor, COUNT(*)::int AS total FROM tarefas_setor
       WHERE solicitado_por_cliente IS NOT NULL AND status <> 'concluido' AND setor = ANY($1)
       GROUP BY setor`,
      [setores]
    );
    return Object.fromEntries(rows.map((r) => [r.setor, r.total]));
  },

  /** Tarefas de uma empresa nos setores informados (ficha da empresa). */
  async listarPorEmpresa(empresaId, setores, responsavelEmailPorSetor = {}) {
    if (!setores.length) return [];
    const { rows } = await query(
      `SELECT t.id, t.setor, t.descricao, t.status, t.prazo, t.criado_em, t.concluido_em,
              t.responsavel_nome, t.responsavel_email, t.solicitado_por_cliente, t.tipo_solicitacao,
              t.competencia, ${SQL_ATRASADA} AS atrasada
       FROM tarefas_setor t
       WHERE t.empresa_id = $1 AND t.setor = ANY($2)
       ORDER BY CASE WHEN t.status = 'concluido' THEN 1 ELSE 0 END, t.prazo ASC NULLS LAST, t.criado_em DESC
       LIMIT 200`,
      [empresaId, setores]
    );
    // Colaborador só vê as próprias tarefas do setor dele
    return rows.filter((t) => {
      const email = responsavelEmailPorSetor[t.setor];
      return !email || (t.responsavel_email || '').toLowerCase() === email.toLowerCase();
    });
  }
};

module.exports = TarefaSetor;
