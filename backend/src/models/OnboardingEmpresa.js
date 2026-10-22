const { query } = require('../config/db');

const ESTAGIOS_VALIDOS = ['legalizacao', 'cadastro_dominio', 'fechamento_setorial'];

// Ordem fixa da esteira. Definida em código (não editável pelo usuário)
// porque reflete um processo interno fixo da Privilege, descrito
// diretamente pelo escritório: Legalização → Cadastro no Domínio →
// Fechamento setorial (fan-out para os 3 coordenadores ao mesmo tempo).
const PROXIMO_ESTAGIO = {
  legalizacao: 'cadastro_dominio',
  cadastro_dominio: 'fechamento_setorial',
  fechamento_setorial: null // fim da esteira automatizada — a partir daqui
  // cada coordenador distribui manualmente pra um terceiro do próprio
  // setor, usando a tela de Tarefas de Setor (já existente).
};

const OnboardingEmpresa = {
  ESTAGIOS_VALIDOS,
  PROXIMO_ESTAGIO,

  async buscarPorEmpresa(empresaId) {
    const { rows } = await query(
      `SELECT o.*, e.razao_social, e.cnpj
       FROM onboarding_empresa o
       JOIN empresas e ON e.id = o.empresa_id
       WHERE o.empresa_id = $1`,
      [empresaId]
    );
    return rows[0] || null;
  },

  async iniciar(empresaId, estagioInicial = 'legalizacao') {
    const { rows } = await query(
      `INSERT INTO onboarding_empresa (empresa_id, estagio)
       VALUES ($1, $2)
       RETURNING *`,
      [empresaId, estagioInicial]
    );
    return rows[0];
  },

  async avancar(empresaId, novoEstagio, usuarioId) {
    const { rows } = await query(
      `UPDATE onboarding_empresa
       SET estagio = $2, atualizado_em = NOW()
       WHERE empresa_id = $1
       RETURNING *`,
      [empresaId, novoEstagio]
    );

    await query(
      `INSERT INTO onboarding_historico (empresa_id, estagio, concluido_por)
       VALUES ($1, $2, $3)`,
      [empresaId, novoEstagio, usuarioId]
    );

    return rows[0];
  },

  async historico(empresaId) {
    const { rows } = await query(
      `SELECT h.*, u.nome AS concluido_por_nome
       FROM onboarding_historico h
       LEFT JOIN usuarios u ON u.id = h.concluido_por
       WHERE h.empresa_id = $1
       ORDER BY h.criado_em ASC`,
      [empresaId]
    );
    return rows;
  }
};

module.exports = OnboardingEmpresa;
