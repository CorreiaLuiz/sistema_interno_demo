const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Usuario = require('../models/Usuario');
const TokenRecuperacaoSenha = require('../models/TokenRecuperacaoSenha');
const LogAuditoria = require('../models/LogAuditoria');
const { enviarEmail } = require('../services/notificacaoService');
const { AppError } = require('../middlewares/errorHandler');
const { urlBaseSistema } = require('../utils/urlSistema');
const permissoes = require('../services/permissoesService');

const SALT_ROUNDS = 10;
const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Hash de uma senha qualquer, usado para gastar o mesmo tempo de bcrypt
// quando o e-mail não existe — sem isso, dá para descobrir quais e-mails
// estão cadastrados medindo o tempo de resposta do login.
const HASH_FICTICIO = bcrypt.hashSync('senha-ficticia-para-tempo-constante', SALT_ROUNDS);

function normalizarEmail(email) {
  return String(email || '').trim().toLowerCase();
}

async function login(req, res, next) {
  try {
    const email = normalizarEmail(req.body.email);
    const { senha } = req.body;

    if (!email || !senha || typeof senha !== 'string') {
      throw new AppError('E-mail e senha são obrigatórios.', 400);
    }

    const usuario = await Usuario.buscarPorEmail(email);
    const senhaValida = await bcrypt.compare(senha, usuario ? usuario.senha_hash : HASH_FICTICIO);
    if (!usuario || !usuario.ativo || !senhaValida) {
      throw new AppError('Credenciais inválidas.', 401);
    }

    const payload = { id: usuario.id, nome: usuario.nome, email: usuario.email, role: usuario.role };
    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '8h'
    });

    await Usuario.atualizarUltimoLogin(usuario.id);

    res.json({
      token,
      usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, role: usuario.role },
      permissoes: await permissoes.permissoesDoPapel(usuario.role)
    });
  } catch (err) {
    next(err);
  }
}

async function me(req, res, next) {
  try {
    const usuario = await Usuario.buscarPorId(req.usuario.id);
    if (!usuario) throw new AppError('Usuário não encontrado.', 404);
    res.json(usuario);
  } catch (err) {
    next(err);
  }
}

async function criarUsuario(req, res, next) {
  try {
    const { nome, senha, role } = req.body;
    const email = normalizarEmail(req.body.email);

    if (!nome || !email || !senha || !role) {
      throw new AppError('Nome, e-mail, senha e função (role) são obrigatórios.', 400);
    }
    if (!REGEX_EMAIL.test(email)) {
      throw new AppError('E-mail inválido.', 400);
    }
    if (senha.length < 8) {
      throw new AppError('A senha deve ter no mínimo 8 caracteres.', 400);
    }

    const roleRegistro = await Usuario.buscarRolePorNome(role);
    if (!roleRegistro) {
      throw new AppError(`Função "${role}" não existe.`, 400);
    }

    const senhaHash = await bcrypt.hash(senha, SALT_ROUNDS);
    const novoUsuario = await Usuario.criar({ nome, email, senhaHash, roleId: roleRegistro.id });

    LogAuditoria.registrar({
      usuarioId: req.usuario.id, acao: 'CREATE', entidade: 'usuario', entidadeId: novoUsuario.id,
      detalhes: { nome, email, role }
    });

    res.status(201).json(novoUsuario);
  } catch (err) {
    next(err);
  }
}

async function listarUsuarios(req, res, next) {
  try {
    const usuarios = await Usuario.listar();
    res.json(usuarios);
  } catch (err) {
    next(err);
  }
}

/**
 * Edição de um usuário por um administrador: nome, e-mail, função, ativo/inativo.
 */
async function atualizarUsuario(req, res, next) {
  try {
    const { nome, role, ativo } = req.body;
    const email = req.body.email !== undefined ? normalizarEmail(req.body.email) : undefined;
    if (email !== undefined && !REGEX_EMAIL.test(email)) {
      throw new AppError('E-mail inválido.', 400);
    }

    // Evita que o administrador se tranque fora do sistema por engano
    if (req.params.id === req.usuario.id && (ativo === false || (role && role !== 'administrador'))) {
      throw new AppError('Você não pode desativar nem rebaixar o seu próprio usuário.', 400);
    }

    let roleId;
    if (role) {
      const roleRegistro = await Usuario.buscarRolePorNome(role);
      if (!roleRegistro) throw new AppError(`Função "${role}" não existe.`, 400);
      roleId = roleRegistro.id;
    }

    const usuario = await Usuario.atualizar(req.params.id, { nome, email, roleId, ativo });
    if (!usuario) throw new AppError('Usuário não encontrado.', 404);

    LogAuditoria.registrar({
      usuarioId: req.usuario.id, acao: 'UPDATE', entidade: 'usuario', entidadeId: req.params.id
    });

    res.json(usuario);
  } catch (err) {
    next(err);
  }
}

/**
 * Um administrador define uma nova senha para outro usuário diretamente
 * (útil quando alguém perde acesso ao próprio e-mail).
 */
async function redefinirSenhaUsuario(req, res, next) {
  try {
    const { novaSenha } = req.body;
    if (!novaSenha || novaSenha.length < 8) {
      throw new AppError('A nova senha deve ter no mínimo 8 caracteres.', 400);
    }

    const usuario = await Usuario.buscarPorId(req.params.id);
    if (!usuario) throw new AppError('Usuário não encontrado.', 404);

    const novoHash = await bcrypt.hash(novaSenha, SALT_ROUNDS);
    await Usuario.atualizarSenha(req.params.id, novoHash);

    LogAuditoria.registrar({
      usuarioId: req.usuario.id, acao: 'UPDATE', entidade: 'usuario', entidadeId: req.params.id,
      detalhes: { acao_especifica: 'senha_redefinida_por_admin' }
    });

    res.json({ mensagem: 'Senha redefinida com sucesso.' });
  } catch (err) {
    next(err);
  }
}

/**
 * Troca de senha pelo próprio usuário logado, exigindo a senha atual.
 */
async function trocarSenha(req, res, next) {
  try {
    const { senhaAtual, novaSenha } = req.body;

    if (!senhaAtual || !novaSenha) {
      throw new AppError('Informe a senha atual e a nova senha.', 400);
    }
    if (novaSenha.length < 8) {
      throw new AppError('A nova senha deve ter no mínimo 8 caracteres.', 400);
    }

    const senhaHashAtual = await Usuario.buscarSenhaHashPorId(req.usuario.id);
    const confere = await bcrypt.compare(senhaAtual, senhaHashAtual);
    if (!confere) {
      throw new AppError('Senha atual incorreta.', 401);
    }

    const novoHash = await bcrypt.hash(novaSenha, SALT_ROUNDS);
    await Usuario.atualizarSenha(req.usuario.id, novoHash);

    res.json({ mensagem: 'Senha alterada com sucesso.' });
  } catch (err) {
    next(err);
  }
}

/**
 * Solicita a recuperação de senha: gera um token de uso único e envia
 * por e-mail um link para a tela de redefinição. Sempre responde com
 * sucesso genérico, mesmo se o e-mail não existir — evita que alguém
 * descubra quais e-mails estão cadastrados no sistema por tentativa e erro.
 */
async function esqueciSenha(req, res, next) {
  try {
    const email = normalizarEmail(req.body.email);
    if (!email) throw new AppError('Informe o e-mail.', 400);

    const usuario = await Usuario.buscarPorEmail(email);
    if (usuario && usuario.ativo) {
      const registro = await TokenRecuperacaoSenha.gerar(usuario.id);
      const link = `${urlBaseSistema()}/pages/redefinir-senha.html?token=${registro.token}`;

      // Não espera o envio: responder na hora (exista ou não o e-mail)
      // evita revelar pelo tempo de resposta quais e-mails são cadastrados.
      enviarEmail({
        destinatario: usuario.email,
        assunto: 'Recuperação de senha — Sistema de Legalização',
        mensagem: `Olá, ${usuario.nome}! Recebemos uma solicitação para redefinir sua senha. ` +
          `Acesse o link a seguir para criar uma nova senha (válido por 2 horas): ${link}`
      }).catch((err) => console.error('Falha ao enviar e-mail de recuperação de senha:', err.message));
    }

    res.json({ mensagem: 'Se o e-mail existir em nosso sistema, um link de recuperação foi enviado.' });
  } catch (err) {
    next(err);
  }
}

async function redefinirSenha(req, res, next) {
  try {
    const { token, novaSenha } = req.body;
    if (!token || !novaSenha) {
      throw new AppError('Token e nova senha são obrigatórios.', 400);
    }
    if (novaSenha.length < 8) {
      throw new AppError('A nova senha deve ter no mínimo 8 caracteres.', 400);
    }

    const registro = await TokenRecuperacaoSenha.buscarValido(token);
    if (!registro) {
      throw new AppError('Link inválido ou expirado. Solicite uma nova recuperação de senha.', 400);
    }

    const novoHash = await bcrypt.hash(novaSenha, SALT_ROUNDS);
    await Usuario.atualizarSenha(registro.usuario_id, novoHash);
    await TokenRecuperacaoSenha.marcarUsado(registro.id);

    res.json({ mensagem: 'Senha redefinida com sucesso. Você já pode fazer login.' });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  login, me, criarUsuario, listarUsuarios, atualizarUsuario, redefinirSenhaUsuario,
  trocarSenha, esqueciSenha, redefinirSenha
};
