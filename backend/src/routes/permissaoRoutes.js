const express = require('express');
const router = express.Router();
const controller = require('../controllers/permissaoController');
const { autenticar, permitir } = require('../middlewares/auth');

router.use(autenticar);
router.get('/minhas', controller.minhas);
router.get('/', permitir('usuarios.gerenciar'), controller.ver);
router.put('/', permitir('usuarios.gerenciar'), controller.salvar);

module.exports = router;
