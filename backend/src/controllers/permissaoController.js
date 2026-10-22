const permissoes = require('../services/permissoesService');
const LogAuditoria = require('../models/LogAuditoria');
const { AppError } = require('../middlewares/errorHandler');

/**
 * Permissões dos perfis (tela Usuários → "Permissões dos perfis").
 *   GET /api/permissoes          → administrador: catálogo, perfis e quem tem o quê
 *   PUT /api/permissoes          → administrador: { mudancas: { chave: [papeis] } }
 *   GET /api/permissoes/minhas   → qualquer pessoa da equipe: as permissões dela (para as telas)
 */

async function ver(req, res, next) {
  try {
    res.json(await permissoes.matriz());
  } catch (err) {
    next(err);
  }
}

async function salvar(req, res, next) {
  try {
    const mudancas = req.body && req.body.mudancas;
    if (!mudancas || typeof mudancas !== 'object' || Array.isArray(mudancas)) throw new AppError('Nada para salvar.', 400);
    let feitas;
    try {
      feitas = await permissoes.salvar(mudancas, req.usuario.id);
    } catch (err) {
      if (err.status === 400) throw new AppError(err.message, 400);
      throw err;
    }
    for (const f of feitas) {
      LogAuditoria.registrar({ usuarioId: req.usuario.id, acao: 'mudar_permissao', entidade: 'permissoes_perfil', detalhes: f });
    }
    res.json({ mudadas: feitas.length, ...(await permissoes.matriz()) });
  } catch (err) {
    next(err);
  }
}

async function minhas(req, res, next) {
  try {
    res.json({ permissoes: await permissoes.permissoesDoPapel(req.usuario.role) });
  } catch (err) {
    next(err);
  }
}

module.exports = { ver, salvar, minhas };
