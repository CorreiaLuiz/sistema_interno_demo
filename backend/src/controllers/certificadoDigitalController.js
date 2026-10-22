const CertificadoDigital = require('../models/CertificadoDigital');
const Empresa = require('../models/Empresa');
const LogAuditoria = require('../models/LogAuditoria');
const { AppError } = require('../middlewares/errorHandler');

const STATUS_VALIDOS = ['emissao_pendente', 'valida', 'a_vencer', 'vencida'];

async function listarPorEmpresa(req, res, next) {
  try {
    const certificados = await CertificadoDigital.listarPorEmpresa(req.params.empresaId);
    res.json(certificados);
  } catch (err) {
    next(err);
  }
}

async function resumoStatus(req, res, next) {
  try {
    const contadores = await CertificadoDigital.resumoPorStatus();
    const resultado = STATUS_VALIDOS.reduce((acc, s) => { acc[s] = 0; return acc; }, {});
    contadores.forEach((c) => { resultado[c.status] = c.total; });
    res.json(resultado);
  } catch (err) {
    next(err);
  }
}

async function criar(req, res, next) {
  try {
    const { empresa_id, tipo, numero_serie, data_emissao, data_validade, documento_id, observacoes } = req.body;
    if (!empresa_id) throw new AppError('empresa_id é obrigatório.', 400);

    const empresa = await Empresa.buscarPorId(empresa_id);
    if (!empresa) throw new AppError('Empresa não encontrada.', 404);

    const certificado = await CertificadoDigital.criar({
      empresa_id, tipo, numero_serie, data_emissao, data_validade, documento_id,
      responsavel_id: req.usuario.id, observacoes
    });

    LogAuditoria.registrar({
      usuarioId: req.usuario.id, acao: 'CREATE', entidade: 'certificado_digital', entidadeId: certificado.id,
      detalhes: { empresa_id, tipo: certificado.tipo }
    });

    res.status(201).json(certificado);
  } catch (err) {
    next(err);
  }
}

async function atualizar(req, res, next) {
  try {
    const existente = await CertificadoDigital.buscarPorId(req.params.id);
    if (!existente) throw new AppError('Certificado digital não encontrado.', 404);

    const certificado = await CertificadoDigital.atualizar(req.params.id, req.body);

    LogAuditoria.registrar({
      usuarioId: req.usuario.id, acao: 'UPDATE', entidade: 'certificado_digital', entidadeId: req.params.id
    });

    res.json(certificado);
  } catch (err) {
    next(err);
  }
}

async function remover(req, res, next) {
  try {
    const existente = await CertificadoDigital.buscarPorId(req.params.id);
    if (!existente) throw new AppError('Certificado digital não encontrado.', 404);

    await CertificadoDigital.remover(req.params.id);

    LogAuditoria.registrar({
      usuarioId: req.usuario.id, acao: 'DELETE', entidade: 'certificado_digital', entidadeId: req.params.id
    });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

module.exports = { listarPorEmpresa, resumoStatus, criar, atualizar, remover };
