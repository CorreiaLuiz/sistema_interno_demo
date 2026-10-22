const express = require('express');
const rateLimit = require('express-rate-limit');
const controller = require('../controllers/contatoSiteController');
const { autenticar, permitir } = require('../middlewares/auth');

const router = express.Router();

// Formulário público do site: poucos envios por IP (contra robôs)
router.post('/', rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { erro: 'Você já enviou alguns pedidos. Aguarde um pouco ou fale com a gente pelo WhatsApp.' },
  standardHeaders: true,
  legacyHeaders: false
}), controller.criar);

router.get('/', autenticar, permitir('contatos_site.gerenciar'), controller.listar);
router.patch('/:id', autenticar, permitir('contatos_site.gerenciar'), controller.atualizar);

module.exports = router;
