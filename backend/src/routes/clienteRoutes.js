const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const clienteController = require('../controllers/clienteController');
const { autenticarCliente } = require('../middlewares/auth');
const { upload: uploadMiddleware, validarConteudoArquivo } = require('../middlewares/upload');

// Área do Cliente (login com e-mail e senha do próprio cliente).
// Limites por IP contra tentativa de adivinhar senhas ou links.
const limitadorLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { erro: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' },
  standardHeaders: true,
  legacyHeaders: false
});

const limitadorSenha = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { erro: 'Muitas solicitações. Aguarde alguns minutos e tente novamente.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Públicas
router.post('/login', limitadorLogin, clienteController.login);
router.post('/esqueci-senha', limitadorSenha, clienteController.esqueciSenha);
router.get('/link-senha/:token', limitadorSenha, clienteController.verificarLinkSenha);
router.post('/definir-senha', limitadorSenha, clienteController.definirSenha);

// Logado
router.use(autenticarCliente);
router.get('/me', clienteController.me);
router.post('/trocar-senha', limitadorSenha, clienteController.trocarSenha);
router.get('/tipos-solicitacao', clienteController.tiposSolicitacao);

// Por empresa — sempre conferindo se o login tem acesso a ela
router.use('/empresas/:empresaId', clienteController.verificarAcessoEmpresa);
router.get('/empresas/:empresaId/resumo', clienteController.resumo);
router.get('/empresas/:empresaId/documentos', clienteController.listarDocumentos);
router.get('/empresas/:empresaId/documentos/:documentoId/download', clienteController.baixarDocumento);
router.post('/empresas/:empresaId/documentos', uploadMiddleware.single('arquivo'), validarConteudoArquivo, clienteController.enviarDocumento);
router.get('/empresas/:empresaId/solicitacoes', clienteController.listarSolicitacoes);
router.post('/empresas/:empresaId/solicitacoes', clienteController.criarSolicitacao);

module.exports = router;
