const crypto = require('crypto');
const { query } = require('../config/db');
const conector = require('../services/conectorService');
const permissoes = require('../services/permissoesService');
const LogAuditoria = require('../models/LogAuditoria');
const { AppError } = require('../middlewares/errorHandler');

/**
 * Conector do Claude (servidor MCP "Streamable HTTP" sem estado: cada POST é um
 * JSON-RPC 2.0 completo). Só consulta. Entra com uma chave pessoal criada na tela
 * Ajuda → "Conectar o Claude": no cabeçalho (Authorization: Bearer <chave>) ou no
 * endereço (/api/mcp/<chave>, para o claude.ai, que não deixa pôr cabeçalho).
 *
 *   POST /api/mcp[/<chave>]            → initialize, tools/list, tools/call, ping
 *   GET  /api/conector/chaves          → minhas chaves (administrador vê todas)
 *   POST /api/conector/chaves          → { nome } cria; a chave só aparece nesta resposta
 *   DELETE /api/conector/chaves/:id    → desliga a chave
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERSAO = '1.0.0';
const hashDa = (chave) => crypto.createHash('sha256').update(String(chave)).digest('hex');

// ---------------------------------------------------------------------------
// Servidor MCP
// ---------------------------------------------------------------------------

const resultado = (id, result) => ({ jsonrpc: '2.0', id, result });
const erroRpc = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

/** Quem é o dono da chave (só se a chave e a pessoa estiverem ativas e ela ainda puder usar o conector). */
async function donoDaChave(req) {
  const doCabecalho = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
  const chave = (doCabecalho && doCabecalho[1]) || req.params.chave;
  if (!chave || chave.length < 20) return null;
  const { rows: [c] } = await query(
    `SELECT c.id, u.id AS usuario_id, u.nome, u.email, r.nome AS role
     FROM conector_chaves c JOIN usuarios u ON u.id = c.usuario_id JOIN roles r ON r.id = u.role_id
     WHERE c.hash = $1 AND c.revogada_em IS NULL AND u.ativo`,
    [hashDa(chave)]
  );
  if (!c || !(await permissoes.pode(c.role, 'claude.conectar'))) return null;
  return { chaveId: c.id, usuario: { id: c.usuario_id, nome: c.nome, email: c.email, role: c.role } };
}

async function mcp(req, res) {
  const msg = req.body;
  let dono;
  try {
    dono = await donoDaChave(req);
  } catch (err) {
    return res.status(500).json(erroRpc(msg && msg.id, -32603, 'Erro ao conferir a chave.'));
  }
  if (!dono) {
    res.set('WWW-Authenticate', 'Bearer');
    return res.status(401).json(erroRpc(msg && msg.id, -32001, 'Chave do conector inválida ou desligada. Crie outra em Ajuda → Conectar o Claude.'));
  }
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0') {
    return res.status(400).json(erroRpc(null, -32600, 'Pedido inválido (esperado JSON-RPC 2.0).'));
  }
  // Notificação (sem id): não tem resposta
  if (!('id' in msg)) return res.status(202).end();

  const { id, method } = msg;
  const params = msg.params && typeof msg.params === 'object' ? msg.params : {};
  try {
    query('UPDATE conector_chaves SET usos = usos + 1, ultimo_uso = NOW() WHERE id = $1', [dono.chaveId]).catch(() => {});
    if (method === 'initialize') {
      return res.json(resultado(id, {
        protocolVersion: typeof params.protocolVersion === 'string' ? params.protocolVersion : '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'sistema-privilege', title: 'SISTEMA PRIVILEGE', version: VERSAO },
        instructions: await conector.instrucoes(dono.usuario)
      }));
    }
    if (method === 'ping') return res.json(resultado(id, {}));
    if (method === 'tools/list') {
      const lista = await conector.ferramentasDe(dono.usuario);
      return res.json(resultado(id, {
        tools: lista.map((f) => ({ name: f.nome, description: f.descricao, inputSchema: f.entrada, annotations: { readOnlyHint: true, openWorldHint: false } }))
      }));
    }
    if (method === 'tools/call') {
      const nome = String(params.name || '');
      const args = params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
      const ferramenta = (await conector.ferramentasDe(dono.usuario)).find((f) => f.nome === nome);
      if (!ferramenta) return res.json(erroRpc(id, -32602, `Ferramenta desconhecida ou sem permissão: ${nome}`));
      LogAuditoria.registrar({ usuarioId: dono.usuario.id, acao: 'consulta_claude', entidade: 'conector', entidadeId: dono.chaveId, detalhes: { ferramenta: nome, argumentos: JSON.stringify(args).slice(0, 300) } });
      try {
        const dados = await ferramenta.rodar(args, dono.usuario);
        return res.json(resultado(id, { content: [{ type: 'text', text: JSON.stringify(dados, null, 1) }], structuredContent: dados }));
      } catch (err) {
        if (err instanceof conector.ErroFerramenta) return res.json(resultado(id, { content: [{ type: 'text', text: err.message }], isError: true }));
        throw err;
      }
    }
    return res.json(erroRpc(id, -32601, `Método não suportado: ${method}`));
  } catch (err) {
    console.error('[conector] erro:', err && err.message);
    return res.json(erroRpc(id, -32603, 'Erro interno no sistema ao responder.'));
  }
}

function soPost(req, res) {
  res.set('Allow', 'POST').status(405).json({ erro: 'Este endereço é para o Claude (conector MCP). Veja Ajuda → Conectar o Claude.' });
}

// ---------------------------------------------------------------------------
// Chaves
// ---------------------------------------------------------------------------

async function listarChaves(req, res, next) {
  try {
    const admin = req.usuario.role === 'administrador';
    const { rows } = await query(
      `SELECT c.id, c.nome, c.inicio, c.usos, c.ultimo_uso, c.criado_em, c.revogada_em, u.nome AS dono, c.usuario_id = $1 AS minha
       FROM conector_chaves c JOIN usuarios u ON u.id = c.usuario_id
       WHERE ($2 OR c.usuario_id = $1) ORDER BY c.revogada_em IS NOT NULL, c.criado_em DESC`,
      [req.usuario.id, admin]
    );
    res.json({ chaves: rows });
  } catch (err) {
    next(err);
  }
}

async function criarChave(req, res, next) {
  try {
    const nome = String(req.body.nome || '').trim().slice(0, 80);
    if (nome.length < 2) throw new AppError('Dê um nome para a chave (ex: "Claude do meu computador").', 400);
    const { rows: [{ n }] } = await query('SELECT COUNT(*)::int AS n FROM conector_chaves WHERE usuario_id = $1 AND revogada_em IS NULL', [req.usuario.id]);
    if (n >= 5) throw new AppError('Você já tem 5 chaves ligadas. Desligue uma antes de criar outra.', 400);
    const chave = `sp_${crypto.randomBytes(30).toString('base64url')}`;
    const { rows: [c] } = await query(
      'INSERT INTO conector_chaves (usuario_id, nome, hash, inicio) VALUES ($1, $2, $3, $4) RETURNING id',
      [req.usuario.id, nome, hashDa(chave), chave.slice(0, 9)]
    );
    LogAuditoria.registrar({ usuarioId: req.usuario.id, acao: 'criar_chave_claude', entidade: 'conector', entidadeId: c.id, detalhes: { nome } });
    res.status(201).json({ id: c.id, nome, chave });
  } catch (err) {
    next(err);
  }
}

async function revogarChave(req, res, next) {
  try {
    if (!UUID.test(req.params.id)) throw new AppError('Chave não encontrada.', 404);
    const admin = req.usuario.role === 'administrador';
    const { rows: [c] } = await query(
      `UPDATE conector_chaves SET revogada_em = NOW() WHERE id = $1 AND revogada_em IS NULL AND ($2 OR usuario_id = $3) RETURNING nome`,
      [req.params.id, admin, req.usuario.id]
    );
    if (!c) throw new AppError('Chave não encontrada.', 404);
    LogAuditoria.registrar({ usuarioId: req.usuario.id, acao: 'desligar_chave_claude', entidade: 'conector', entidadeId: req.params.id, detalhes: { nome: c.nome } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

module.exports = { mcp, soPost, listarChaves, criarChave, revogarChave, VERSAO };
