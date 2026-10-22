const LogAuditoria = require('../models/LogAuditoria');

const ENTIDADES_VALIDAS = ['empresa', 'certidao', 'licenca', 'processo_legalizacao', 'documento', 'usuario'];

async function listar(req, res, next) {
  try {
    const { entidade, usuario_id, pagina, limite } = req.query;
    const resultado = await LogAuditoria.listar({
      entidade: ENTIDADES_VALIDAS.includes(entidade) ? entidade : undefined,
      usuarioId: usuario_id,
      pagina: pagina ? Number(pagina) : 1,
      limite: limite ? Number(limite) : 50
    });
    res.json(resultado);
  } catch (err) {
    next(err);
  }
}

module.exports = { listar, ENTIDADES_VALIDAS };
