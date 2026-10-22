const { query } = require('../config/db');
const ajuda = require('../services/ajudaService');
const { AppError } = require('../middlewares/errorHandler');
const LogAuditoria = require('../models/LogAuditoria');

/**
 * Assistente de ajuda (manuais + IA).
 *   GET  /api/ajuda/cliente/manual            → manual da Área do Cliente (público, sem login)
 *   GET  /api/ajuda/equipe/manual             → manual da equipe (login da equipe)
 *   POST /api/ajuda/equipe/perguntar          → { pergunta, historico, pagina }
 *   POST /api/ajuda/cliente/perguntar         → idem, login do cliente
 *   POST /api/ajuda/{equipe|cliente}/avaliar/:id → { util: true|false } ("Ajudou?")
 *   GET  /api/ajuda/perguntas                 → administrador: o que as pessoas perguntaram
 *   GET/POST/PUT/DELETE /api/ajuda/memoria    → administrador: respostas ensinadas ao assistente
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMITE_DIA = () => Number(process.env.AJUDA_LIMITE_DIA) || 300;

const ROTULO_PAPEL = {
  administrador: 'Administrador', analista_legalizacao: 'Analista de Legalização', analista_certidoes: 'Analista de Certidões',
  analista_licencas: 'Analista de Licenças', supervisor_fiscal: 'Supervisor Fiscal', supervisor_contabilidade: 'Supervisor de Contabilidade',
  supervisor_folha_pagamento: 'Supervisor de Folha de Pagamento', colaborador_fiscal: 'Colaborador do Fiscal',
  colaborador_contabilidade: 'Colaborador da Contabilidade', colaborador_folha_pagamento: 'Colaborador da Folha de Pagamento', visualizador: 'Visualizador'
};

const paginaLimpa = (p) => String(p || '').replace(/[^\w/.\-]/g, '').slice(0, 120) || null;

/** Respostas ensinadas de um público (vão para o assistente e para as perguntas frequentes do manual). */
async function memoriaDe(publico) {
  const { rows } = await query('SELECT id, pergunta, resposta, secoes, usos FROM ajuda_memoria WHERE publico = $1 ORDER BY usos DESC, criado_em', [publico]);
  return rows;
}

function manual(publico) {
  return async (req, res, next) => {
    try {
      const frequentes = (await memoriaDe(publico)).slice(0, 12)
        .map((m) => ({ pergunta: m.pergunta.split(/\r?\n/)[0], resposta: m.resposta, secoes: m.secoes }));
      res.json({ secoes: ajuda.manualParaTela(publico), ia: ajuda.iaConfigurada(), frequentes });
    } catch (err) {
      next(err);
    }
  };
}

async function iaDisponivelHoje() {
  const { rows: [r] } = await query(`SELECT COUNT(*)::int AS n FROM ajuda_perguntas WHERE modo = 'ia' AND criado_em >= CURRENT_DATE`);
  return r.n < LIMITE_DIA();
}

function perguntar(publico) {
  return async (req, res, next) => {
    try {
      const pergunta = String(req.body.pergunta || '').trim();
      if (pergunta.length < 2) throw new AppError('Escreva a sua dúvida.', 400);
      if (pergunta.length > 1500) throw new AppError('A pergunta ficou muito longa. Resuma em poucas linhas.', 400);
      const pagina = paginaLimpa(req.body.pagina);

      const contexto = publico === 'equipe'
        ? `pessoa da equipe "${req.usuario.nome}", perfil ${ROTULO_PAPEL[req.usuario.role] || req.usuario.role}, está na tela ${pagina || 'desconhecida'}`
        : `cliente "${req.cliente.nome || 'cliente'}", está na tela ${pagina || 'desconhecida'}`;

      const r = await ajuda.responder({ publico, pergunta, historico: req.body.historico, contexto, usarIa: await iaDisponivelHoje(), memoria: await memoriaDe(publico) });
      if (r.memoriaId) await query('UPDATE ajuda_memoria SET usos = usos + 1 WHERE id = $1', [r.memoriaId]);
      const { rows: [linha] } = await query(
        `INSERT INTO ajuda_perguntas (publico, usuario_id, cliente_id, pagina, pergunta, resposta, secoes, modo, tokens_entrada, tokens_saida, memoria_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [publico, publico === 'equipe' ? req.usuario.id : null, publico === 'cliente' ? req.cliente.id : null, pagina, pergunta, r.resposta,
          r.secoes.map((s) => s.id), r.modo,
          r.uso ? (r.uso.input_tokens || 0) + (r.uso.cache_read_input_tokens || 0) + (r.uso.cache_creation_input_tokens || 0) : null,
          r.uso ? r.uso.output_tokens || null : null, r.memoriaId || null]
      );
      res.json({ id: linha.id, resposta: r.resposta, secoes: r.secoes, modo: r.modo });
    } catch (err) {
      next(err);
    }
  };
}

/** Sem login (tela de entrada da Área do Cliente): só busca no manual do cliente, nada é gravado. */
async function buscarPublico(req, res, next) {
  try {
    const pergunta = String(req.body.pergunta || '').trim().slice(0, 500);
    if (pergunta.length < 2) throw new AppError('Escreva a sua dúvida.', 400);
    const r = await ajuda.responder({ publico: 'cliente', pergunta, usarIa: false, memoria: await memoriaDe('cliente') });
    res.json({ id: null, resposta: r.resposta, secoes: r.secoes, modo: r.modo });
  } catch (err) {
    next(err);
  }
}

function avaliar(publico) {
  return async (req, res, next) => {
    try {
      if (!UUID.test(req.params.id)) throw new AppError('Pergunta não encontrada.', 404);
      const dono = publico === 'equipe' ? ['usuario_id', req.usuario.id] : ['cliente_id', req.cliente.id];
      const { rowCount } = await query(
        `UPDATE ajuda_perguntas SET util = $2 WHERE id = $1 AND publico = $3 AND ${dono[0]} = $4`,
        [req.params.id, req.body.util === true, publico, dono[1]]
      );
      if (!rowCount) throw new AppError('Pergunta não encontrada.', 404);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  };
}

async function listarPerguntas(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT p.id, p.publico, p.pagina, p.pergunta, p.resposta, p.secoes, p.modo, p.util, p.criado_em, p.memoria_id,
              COALESCE(u.nome, c.nome, c.email) AS quem
       FROM ajuda_perguntas p
       LEFT JOIN usuarios u ON u.id = p.usuario_id
       LEFT JOIN clientes_portal c ON c.id = p.cliente_id
       ORDER BY p.criado_em DESC LIMIT 200`
    );
    const { rows: [hoje] } = await query(`SELECT COUNT(*)::int AS n FROM ajuda_perguntas WHERE modo = 'ia' AND criado_em >= CURRENT_DATE`);
    res.json({ perguntas: rows, ia: ajuda.iaConfigurada(), ia_hoje: hoje.n, limite_dia: LIMITE_DIA() });
  } catch (err) {
    next(err);
  }
}

// ---- Memória (respostas ensinadas pelo administrador) ----

function dadosMemoria(body) {
  const publico = String(body.publico || '');
  if (!ajuda.PUBLICOS.includes(publico)) throw new AppError('Escolha se a resposta é para a equipe ou para os clientes.', 400);
  const pergunta = String(body.pergunta || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join('\n');
  const resposta = String(body.resposta || '').trim();
  if (pergunta.length < 3) throw new AppError('Escreva a pergunta.', 400);
  if (resposta.length < 3) throw new AppError('Escreva a resposta.', 400);
  if (pergunta.length > 2000 || resposta.length > 4000) throw new AppError('Texto muito longo. Resuma um pouco.', 400);
  const ids = new Set(ajuda.carregarManual(publico).map((s) => s.id));
  const secoes = [...new Set([].concat(body.secoes || []).map(String))].filter((id) => ids.has(id)).slice(0, 3);
  return { publico, pergunta, resposta, secoes };
}

async function listarMemoria(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT m.id, m.publico, m.pergunta, m.resposta, m.secoes, m.usos, m.criado_em, m.atualizado_em, u.nome AS atualizado_por_nome
       FROM ajuda_memoria m LEFT JOIN usuarios u ON u.id = COALESCE(m.atualizado_por, m.criado_por)
       ORDER BY m.atualizado_em DESC`
    );
    const secoes = Object.fromEntries(ajuda.PUBLICOS.map((p) => [p, ajuda.carregarManual(p).map((s) => ({ id: s.id, titulo: s.titulo }))]));
    res.json({ memoria: rows, secoes });
  } catch (err) {
    next(err);
  }
}

async function criarMemoria(req, res, next) {
  try {
    const d = dadosMemoria(req.body);
    const origem = UUID.test(String(req.body.origem_pergunta_id || '')) ? req.body.origem_pergunta_id : null;
    const { rows: [m] } = await query(
      `INSERT INTO ajuda_memoria (publico, pergunta, resposta, secoes, origem_pergunta_id, criado_por, atualizado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING id`,
      [d.publico, d.pergunta, d.resposta, d.secoes, origem, req.usuario.id]
    );
    LogAuditoria.registrar({ usuarioId: req.usuario.id, acao: 'ensinar_assistente', entidade: 'ajuda_memoria', entidadeId: m.id, detalhes: { publico: d.publico, pergunta: d.pergunta.slice(0, 200) } });
    res.status(201).json({ id: m.id });
  } catch (err) {
    next(err);
  }
}

async function atualizarMemoria(req, res, next) {
  try {
    if (!UUID.test(req.params.id)) throw new AppError('Resposta não encontrada.', 404);
    const d = dadosMemoria(req.body);
    const { rowCount } = await query(
      `UPDATE ajuda_memoria SET publico = $2, pergunta = $3, resposta = $4, secoes = $5, atualizado_por = $6, atualizado_em = NOW() WHERE id = $1`,
      [req.params.id, d.publico, d.pergunta, d.resposta, d.secoes, req.usuario.id]
    );
    if (!rowCount) throw new AppError('Resposta não encontrada.', 404);
    LogAuditoria.registrar({ usuarioId: req.usuario.id, acao: 'editar_resposta_assistente', entidade: 'ajuda_memoria', entidadeId: req.params.id, detalhes: { publico: d.publico } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

async function excluirMemoria(req, res, next) {
  try {
    if (!UUID.test(req.params.id)) throw new AppError('Resposta não encontrada.', 404);
    const { rows: [m] } = await query('DELETE FROM ajuda_memoria WHERE id = $1 RETURNING pergunta', [req.params.id]);
    if (!m) throw new AppError('Resposta não encontrada.', 404);
    LogAuditoria.registrar({ usuarioId: req.usuario.id, acao: 'excluir_resposta_assistente', entidade: 'ajuda_memoria', entidadeId: req.params.id, detalhes: { pergunta: m.pergunta.slice(0, 200) } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

module.exports = { manual, perguntar, buscarPublico, avaliar, listarPerguntas, listarMemoria, criarMemoria, atualizarMemoria, excluirMemoria };
