const express = require('express');
const router = express.Router();
const auditoriaController = require('../controllers/auditoriaController');
const { autenticar, permitir } = require('../middlewares/auth');

router.use(autenticar, permitir('auditoria.ver'));

router.get('/', auditoriaController.listar);

module.exports = router;
