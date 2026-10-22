const ClientePortal = require('../models/ClientePortal');
const Empresa = require('../models/Empresa');
const LogAuditoria = require('../models/LogAuditoria');
const { notificarCliente } = require('../services/notificacaoService');
const { urlBaseSistema } = require('../utils/urlSistema');
const { AppError } = require('../middlewares/errorHandler');

/**
 * Gestão, pela equipe, de quem acessa a Área do Cliente de cada empresa.
 * Liberar o acesso cria o login (se o e-mail ainda não existe) e manda o
 * link de "criar minha senha" por e-mail e WhatsApp. O link também volta
 * na resposta, para a equipe poder copiar e mandar por outro canal.
 */

const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function buscarEmpresaOuFalhar(id) {
  const empresa = await Empresa.buscarPorId(id);
  if (!empresa) throw new AppError('Empresa não encontrada.', 404);
  if (empresa.situacao === 'saiu_escritorio') {
    throw new AppError('Esta empresa saiu do escritório — a Área do Cliente fica desativada.', 400);
  }
  return empresa;
}

/** Gera o link de senha e avisa o cliente. Devolve o link e por onde saiu. */
async function enviarConvite({ cliente, empresa, usuario }) {
  const token = await ClientePortal.gerarTokenSenha(cliente.id, 'primeiro_acesso');
  const link = `${urlBaseSistema()}/pages/cliente-senha.html?token=${token}`;
  const envio = await notificarCliente({
    cliente,
    empresaId: empresa.id,
    enviadoPor: usuario.id,
    assunto: 'Seu acesso à Área do Cliente — Privilege Contabilidade',
    mensagem: `Olá${cliente.nome ? ', ' + cliente.nome : ''}! A Privilege Contabilidade liberou o seu acesso ` +
      `à Área do Cliente da empresa ${empresa.razao_social}. Lá você baixa documentos (cartão CNPJ, ` +
      `certificado digital, guias) e pede ao escritório o que precisar, como a 2ª via de uma guia.\n\n` +
      `Crie sua senha pelo link abaixo (válido por 7 dias):\n${link}\n\nSeu login é este e-mail: ${cliente.email}`
  });
  return { link, envio };
}

async function listar(req, res, next) {
  try {
    const [acessos, downloads] = await Promise.all([
      ClientePortal.listarPorEmpresa(req.params.id),
      ClientePortal.listarDownloads(req.params.id, 30)
    ]);
    res.json({ acessos, downloads });
  } catch (err) {
    next(err);
  }
}

async function liberar(req, res, next) {
  try {
    const empresa = await buscarEmpresaOuFalhar(req.params.id);
    const email = String(req.body.email || '').trim().toLowerCase();
    const nome = String(req.body.nome || '').trim().slice(0, 150);
    const telefone = String(req.body.telefone || '').trim().slice(0, 20);

    if (!REGEX_EMAIL.test(email)) throw new AppError('Informe um e-mail válido.', 400);

    let cliente = await ClientePortal.buscarPorEmail(email);
    cliente = cliente
      ? await ClientePortal.atualizarContato(cliente.id, { nome, telefone })
      : await ClientePortal.criar({ nome, email, telefone, criadoPor: req.usuario.id });

    await ClientePortal.liberarEmpresa(cliente.id, empresa.id, req.usuario.id);

    LogAuditoria.registrar({
      usuarioId: req.usuario.id, acao: 'CREATE', entidade: 'acesso_cliente', entidadeId: cliente.id,
      detalhes: { empresa_id: empresa.id, email }
    });

    // Quem já tem senha (ex: sócio de outra empresa) só é avisado da empresa nova
    if (cliente.senha_definida) {
      const envio = await notificarCliente({
        cliente, empresaId: empresa.id, enviadoPor: req.usuario.id,
        assunto: 'Nova empresa na sua Área do Cliente — Privilege Contabilidade',
        mensagem: `Olá${cliente.nome ? ', ' + cliente.nome : ''}! A empresa ${empresa.razao_social} foi adicionada ` +
          `à sua Área do Cliente. Entre com o seu login de sempre: ${urlBaseSistema()}/pages/cliente-login.html`
      });
      return res.status(201).json({ cliente, link: null, envio, ja_tinha_senha: true });
    }

    const { link, envio } = await enviarConvite({ cliente, empresa, usuario: req.usuario });
    res.status(201).json({ cliente, link, envio, ja_tinha_senha: false });
  } catch (err) {
    next(err);
  }
}

/** Novo link de senha — para quem perdeu o convite ou esqueceu a senha. */
async function reenviarConvite(req, res, next) {
  try {
    const empresa = await buscarEmpresaOuFalhar(req.params.id);
    const acessos = await ClientePortal.listarPorEmpresa(empresa.id);
    const cliente = acessos.find((c) => c.id === req.params.clienteId);
    if (!cliente) throw new AppError('Acesso não encontrado para esta empresa.', 404);

    const { link, envio } = await enviarConvite({ cliente, empresa, usuario: req.usuario });
    res.json({ link, envio });
  } catch (err) {
    next(err);
  }
}

async function remover(req, res, next) {
  try {
    const removido = await ClientePortal.removerEmpresa(req.params.clienteId, req.params.id);
    if (!removido) throw new AppError('Acesso não encontrado para esta empresa.', 404);

    LogAuditoria.registrar({
      usuarioId: req.usuario.id, acao: 'DELETE', entidade: 'acesso_cliente', entidadeId: req.params.clienteId,
      detalhes: { empresa_id: req.params.id }
    });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

module.exports = { listar, liberar, reenviarConvite, remover };
