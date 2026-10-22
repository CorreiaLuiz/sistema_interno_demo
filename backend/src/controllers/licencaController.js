const Licenca = require('../models/Licenca');
const Empresa = require('../models/Empresa');
const LogAuditoria = require('../models/LogAuditoria');
const { AppError } = require('../middlewares/errorHandler');

const TIPOS_VALIDOS = ['vigilancia_sanitaria', 'bombeiros', 'ambiental', 'funcionamento', 'outra'];
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

    const resultado = await Licenca.listar({
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
    const licenca = await Licenca.buscarPorId(req.params.id);
    if (!licenca) throw new AppError('Licença não encontrada.', 404);
    res.json(licenca);
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

    const licenca = await Licenca.criar(req.body);
    LogAuditoria.registrar({
      usuarioId: req.usuario.id, acao: 'CREATE', entidade: 'licenca', entidadeId: licenca.id,
      detalhes: { empresa_id: req.body.empresa_id, tipo: req.body.tipo }
    });
    res.status(201).json(licenca);
  } catch (err) {
    next(err);
  }
}

async function atualizar(req, res, next) {
  try {
    const existente = await Licenca.buscarPorId(req.params.id);
    if (!existente) throw new AppError('Licença não encontrada.', 404);

    if (req.body.tipo && !TIPOS_VALIDOS.includes(req.body.tipo)) {
      throw new AppError(`Tipo inválido. Use um de: ${TIPOS_VALIDOS.join(', ')}`, 400);
    }

    const licenca = await Licenca.atualizar(req.params.id, req.body);
    res.json(licenca);
  } catch (err) {
    next(err);
  }
}

async function remover(req, res, next) {
  try {
    const existente = await Licenca.buscarPorId(req.params.id);
    if (!existente) throw new AppError('Licença não encontrada.', 404);

    await Licenca.remover(req.params.id);
    LogAuditoria.registrar({
      usuarioId: req.usuario.id, acao: 'DELETE', entidade: 'licenca', entidadeId: req.params.id
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
      throw new AppError('data_validade é obrigatória para renovar a licença.', 400);
    }

    const existente = await Licenca.buscarPorId(req.params.id);
    if (!existente) throw new AppError('Licença não encontrada.', 404);

    const licenca = await Licenca.renovar(req.params.id, {
      data_emissao,
      data_validade,
      observacoes,
      usuario_id: req.usuario.id
    });
    res.json(licenca);
  } catch (err) {
    next(err);
  }
}

async function resumoStatus(req, res, next) {
  try {
    const contadores = await Licenca.contarPorStatus();
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
