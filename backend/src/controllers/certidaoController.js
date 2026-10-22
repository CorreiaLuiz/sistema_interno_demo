const Certidao = require('../models/Certidao');
const Empresa = require('../models/Empresa');
const LogAuditoria = require('../models/LogAuditoria');
const { AppError } = require('../middlewares/errorHandler');

const TIPOS_VALIDOS = ['federal', 'estadual', 'municipal', 'trabalhista', 'fgts', 'outra'];
const STATUS_VALIDOS = ['emissao_pendente', 'valida', 'a_vencer', 'vencida'];

async function listar(req, res, next) {
  try {
    const { empresa_id, status, tipo, pagina, limite } = req.query;

    if (status && !STATUS_VALIDOS.includes(status)) {
      throw new AppError(`Status inválido. Use um de: ${STATUS_VALIDOS.join(', ')}`, 400);
    }
    if (tipo && !TIPOS_VALIDOS.includes(tipo)) {
      throw new AppError(`Tipo inválido. Use um de: ${TIPOS_VALIDOS.join(', ')}`, 400);
    }

    const resultado = await Certidao.listar({
      empresaId: empresa_id,
      status,
      tipo,
      pagina: pagina ? Number(pagina) : 1,
      limite: limite ? Number(limite) : 20
    });
    res.json(resultado);
  } catch (err) {
    next(err);
  }
}

async function buscarPorId(req, res, next) {
  try {
    const certidao = await Certidao.buscarPorId(req.params.id);
    if (!certidao) throw new AppError('Certidão não encontrada.', 404);
    res.json(certidao);
  } catch (err) {
    next(err);
  }
}

async function criar(req, res, next) {
  try {
    const { empresa_id, tipo } = req.body;

    if (!empresa_id || !tipo) {
      throw new AppError('empresa_id e tipo são obrigatórios.', 400);
    }
    if (!TIPOS_VALIDOS.includes(tipo)) {
      throw new AppError(`Tipo inválido. Use um de: ${TIPOS_VALIDOS.join(', ')}`, 400);
    }

    const empresa = await Empresa.buscarPorId(empresa_id);
    if (!empresa) throw new AppError('Empresa não encontrada.', 404);

    const certidao = await Certidao.criar(req.body);
    LogAuditoria.registrar({
      usuarioId: req.usuario.id, acao: 'CREATE', entidade: 'certidao', entidadeId: certidao.id,
      detalhes: { empresa_id, tipo }
    });
    res.status(201).json(certidao);
  } catch (err) {
    next(err);
  }
}

async function atualizar(req, res, next) {
  try {
    const existente = await Certidao.buscarPorId(req.params.id);
    if (!existente) throw new AppError('Certidão não encontrada.', 404);

    if (req.body.tipo && !TIPOS_VALIDOS.includes(req.body.tipo)) {
      throw new AppError(`Tipo inválido. Use um de: ${TIPOS_VALIDOS.join(', ')}`, 400);
    }

    const certidao = await Certidao.atualizar(req.params.id, req.body);
    res.json(certidao);
  } catch (err) {
    next(err);
  }
}

async function remover(req, res, next) {
  try {
    const existente = await Certidao.buscarPorId(req.params.id);
    if (!existente) throw new AppError('Certidão não encontrada.', 404);

    await Certidao.remover(req.params.id);
    LogAuditoria.registrar({
      usuarioId: req.usuario.id, acao: 'DELETE', entidade: 'certidao', entidadeId: req.params.id
    });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

async function renovar(req, res, next) {
  try {
    const { data_emissao, data_validade, observacoes } = req.body;

    if (!data_validade) {
      throw new AppError('data_validade é obrigatória para renovar a certidão.', 400);
    }

    const existente = await Certidao.buscarPorId(req.params.id);
    if (!existente) throw new AppError('Certidão não encontrada.', 404);

    const certidao = await Certidao.renovar(req.params.id, {
      data_emissao,
      data_validade,
      observacoes,
      usuario_id: req.usuario.id
    });
    res.json(certidao);
  } catch (err) {
    next(err);
  }
}

async function resumoStatus(req, res, next) {
  try {
    const contadores = await Certidao.contarPorStatus();
    // Garante que todos os status apareçam no resumo, mesmo com 0 registros
    const resumo = STATUS_VALIDOS.reduce((acc, status) => {
      acc[status] = 0;
      return acc;
    }, {});
    contadores.forEach((c) => { resumo[c.status] = c.total; });
    res.json(resumo);
  } catch (err) {
    next(err);
  }
}

module.exports = { listar, buscarPorId, criar, atualizar, remover, renovar, resumoStatus };
