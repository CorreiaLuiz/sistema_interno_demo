const express = require('express');
const router = express.Router();
const controller = require('../controllers/caixaPostalController');
const { autenticar, permitir } = require('../middlewares/auth');

// Caixa Postal do e-CAC (Integra Contador) — a equipe interna; cada verificação é cobrada pelo SERPRO

router.use(autenticar, permitir('caixa_postal.usar'));

router.get('/', controller.listar);
router.post('/:empresaId/verificar', controller.verificar);
router.post('/:empresaId/mensagens/:isn', controller.abrirMensagem);

module.exports = router;
