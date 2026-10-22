const jwt = require('jsonwebtoken');
const Usuario = require('../models/Usuario');

/**
 * Verifica se o token JWT enviado no header Authorization é válido.
 * Formato esperado: Authorization: Bearer <token>
 *
 * Além de validar a assinatura, confere no banco se o usuário ainda
 * existe e está ativo, e usa a função (role) ATUAL dele — assim, desativar
 * um usuário ou trocar a função dele vale na hora, sem esperar o token
 * de 8h expirar.
 */
async function autenticar(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ erro: 'Token de autenticação não informado.' });
  }

  const token = authHeader.split(' ')[1];

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch (err) {
    return res.status(401).json({ erro: 'Token inválido ou expirado.' });
  }

  // Token da Área do Cliente nunca vale para as rotas da equipe
  if (payload.tipo === 'cliente') {
    return res.status(401).json({ erro: 'Token inválido ou expirado.' });
  }

  try {
    const usuario = await Usuario.buscarPorId(payload.id);
    if (!usuario || !usuario.ativo) {
      return res.status(401).json({ erro: 'Usuário desativado ou inexistente.' });
    }
    req.usuario = { id: usuario.id, nome: usuario.nome, email: usuario.email, role: usuario.role };
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Middleware factory para restringir rotas por função (role).
 * Uso: autorizar('administrador', 'analista_legalizacao')
 */
function autorizar(...rolesPermitidas) {
  return (req, res, next) => {
    if (!req.usuario) {
      return res.status(401).json({ erro: 'Usuário não autenticado.' });
    }
    if (!rolesPermitidas.includes(req.usuario.role)) {
      return res.status(403).json({ erro: 'Você não tem permissão para executar esta ação.' });
    }
    next();
  };
}

/**
 * Restringe a rota a quem tem a permissão (config/permissoes.js + o que o
 * administrador mudou na tela "Permissões dos perfis").
 * Uso: permitir('empresas.editar')
 */
function permitir(chave) {
  const permissoes = require('../services/permissoesService');
  if (!permissoes.PERMISSOES.some((p) => p.chave === chave)) throw new Error(`Permissão desconhecida: ${chave}`);
  return async (req, res, next) => {
    try {
      if (!req.usuario) return res.status(401).json({ erro: 'Usuário não autenticado.' });
      if (!(await permissoes.pode(req.usuario.role, chave))) {
        return res.status(403).json({ erro: 'Você não tem permissão para executar esta ação.' });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Autenticação da Área do Cliente. Aceita só tokens emitidos no login
 * do cliente (tipo "cliente") e confere no banco se o login continua
 * ativo — desativar o acesso vale na hora.
 */
async function autenticarCliente(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ erro: 'Faça login para continuar.' });
  }

  let payload;
  try {
    payload = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch (err) {
    return res.status(401).json({ erro: 'Sua sessão expirou. Entre novamente.' });
  }
  if (payload.tipo !== 'cliente') {
    return res.status(401).json({ erro: 'Faça login na Área do Cliente.' });
  }

  try {
    const ClientePortal = require('../models/ClientePortal');
    const cliente = await ClientePortal.buscarPorId(payload.id);
    if (!cliente || !cliente.ativo) {
      return res.status(401).json({ erro: 'Acesso desativado. Fale com o escritório.' });
    }
    req.cliente = cliente;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { autenticar, autorizar, permitir, autenticarCliente };
