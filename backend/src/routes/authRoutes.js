const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const authController = require('../controllers/authController');
const { autenticar, permitir } = require('../middlewares/auth');

// Limita tentativas de login e de recuperação de senha por IP, para
// dificultar ataques de força bruta — essas rotas não passam pelo
// middleware de autenticação (o usuário ainda não tem token).
const limitadorLogin = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 20,
  message: { erro: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' },
  standardHeaders: true,
  legacyHeaders: false
});

const limitadorRecuperacao = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { erro: 'Muitas solicitações de recuperação. Aguarde alguns minutos e tente novamente.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Rotas públicas
router.post('/login', limitadorLogin, authController.login);
router.post('/esqueci-senha', limitadorRecuperacao, authController.esqueciSenha);
router.post('/redefinir-senha', limitadorRecuperacao, authController.redefinirSenha);

// Rotas autenticadas
router.get('/me', autenticar, authController.me);
router.post('/trocar-senha', autenticar, authController.trocarSenha);

// Apenas administrador pode gerenciar usuários do escritório
router.post('/usuarios', autenticar, permitir('usuarios.gerenciar'), authController.criarUsuario);
router.get('/usuarios', autenticar, permitir('usuarios.gerenciar'), authController.listarUsuarios);
router.put('/usuarios/:id', autenticar, permitir('usuarios.gerenciar'), authController.atualizarUsuario);
router.post('/usuarios/:id/redefinir-senha', autenticar, permitir('usuarios.gerenciar'), authController.redefinirSenhaUsuario);

module.exports = router;
