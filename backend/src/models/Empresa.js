const { query } = require('../config/db');

const Empresa = {
  async listar({ busca, situacao, pagina = 1, limite = 20 }) {
    const offset = (pagina - 1) * limite;
    const condicoes = [];
    const params = [];
    let idx = 1;

    if (busca) {
      condicoes.push(`(razao_social ILIKE $${idx} OR nome_fantasia ILIKE $${idx} OR cnpj ILIKE $${idx})`);
      params.push(`%${busca}%`);
      idx++;
    }
    if (situacao) {
      condicoes.push(`situacao = $${idx}`);
      params.push(situacao);
      idx++;
    }

    const whereSql = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';

    const sql = `
      SELECT id, razao_social, nome_fantasia, cnpj, regime_tributario, situacao, cidade, uf, criado_em
      FROM empresas
      ${whereSql}
      ORDER BY razao_social
      LIMIT $${idx} OFFSET $${idx + 1}
    `;
    params.push(limite, offset);

    const { rows } = await query(sql, params);

    const { rows: totalRows } = await query(
      `SELECT COUNT(*)::int AS total FROM empresas ${whereSql}`,
      params.slice(0, condicoes.length)
    );

    return { dados: rows, total: totalRows[0].total, pagina, limite };
  },

  async buscarPorId(id) {
    const { rows } = await query('SELECT * FROM empresas WHERE id = $1', [id]);
    if (!rows[0]) return null;

    const { rows: socios } = await query('SELECT * FROM socios WHERE empresa_id = $1', [id]);
    return { ...rows[0], socios };
  },

  async criar(dados) {
    const sql = `
      INSERT INTO empresas (
        razao_social, nome_fantasia, cnpj, inscricao_estadual, inscricao_municipal,
        regime_tributario, data_abertura, situacao, cep, logradouro, numero,
        complemento, bairro, cidade, uf, telefone, email, responsavel_interno, observacoes,
        competencia_inicio, fator_r, pro_labore
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
        $20, $21, $22
      )
      RETURNING *
    `;
    const params = [
      dados.razao_social, dados.nome_fantasia, dados.cnpj, dados.inscricao_estadual,
      dados.inscricao_municipal, dados.regime_tributario || 'simples_nacional',
      dados.data_abertura, dados.situacao || 'ativa', dados.cep, dados.logradouro,
      dados.numero, dados.complemento, dados.bairro, dados.cidade, dados.uf,
      dados.telefone, dados.email, dados.responsavel_interno, dados.observacoes,
      dados.competencia_inicio, dados.fator_r, dados.pro_labore
    ];
    const { rows } = await query(sql, params);
    return rows[0];
  },

  async atualizar(id, dados) {
    const sql = `
      UPDATE empresas SET
        razao_social = COALESCE($2, razao_social),
        nome_fantasia = COALESCE($3, nome_fantasia),
        inscricao_estadual = COALESCE($4, inscricao_estadual),
        inscricao_municipal = COALESCE($5, inscricao_municipal),
        regime_tributario = COALESCE($6, regime_tributario),
        situacao = COALESCE($7, situacao),
        cep = COALESCE($8, cep),
        logradouro = COALESCE($9, logradouro),
        numero = COALESCE($10, numero),
        complemento = COALESCE($11, complemento),
        bairro = COALESCE($12, bairro),
        cidade = COALESCE($13, cidade),
        uf = COALESCE($14, uf),
        telefone = COALESCE($15, telefone),
        email = COALESCE($16, email),
        responsavel_interno = COALESCE($17, responsavel_interno),
        observacoes = COALESCE($18, observacoes),
        competencia_inicio = COALESCE($19, competencia_inicio),
        fator_r = COALESCE($20, fator_r),
        pro_labore = COALESCE($21, pro_labore)
      WHERE id = $1
      RETURNING *
    `;
    const params = [
      id, dados.razao_social, dados.nome_fantasia, dados.inscricao_estadual,
      dados.inscricao_municipal, dados.regime_tributario, dados.situacao, dados.cep,
      dados.logradouro, dados.numero, dados.complemento, dados.bairro, dados.cidade,
      dados.uf, dados.telefone, dados.email, dados.responsavel_interno, dados.observacoes,
      dados.competencia_inicio, dados.fator_r, dados.pro_labore
    ];
    const { rows } = await query(sql, params);
    return rows[0];
  },

  /**
   * Marca a empresa como fora do escritório a partir de `dataSaida`
   * (último dia de responsabilidade) e guarda a observação do aviso.
   */
  async registrarSaida(id, { dataSaida, observacao }) {
    const { rows } = await query(
      `UPDATE empresas
       SET situacao = 'saiu_escritorio', data_saida = $2, observacao_saida = $3
       WHERE id = $1
       RETURNING *`,
      [id, dataSaida, observacao || null]
    );
    return rows[0];
  },

  async remover(id) {
    await query('DELETE FROM empresas WHERE id = $1', [id]);
  },

  // --- Sócios ---
  async adicionarSocio(empresaId, { nome, cpf, percentual_participacao, administrador }) {
    const sql = `
      INSERT INTO socios (empresa_id, nome, cpf, percentual_participacao, administrador)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    const { rows } = await query(sql, [empresaId, nome, cpf, percentual_participacao, !!administrador]);
    return rows[0];
  },

  async removerSocio(socioId) {
    await query('DELETE FROM socios WHERE id = $1', [socioId]);
  }
};

module.exports = Empresa;
