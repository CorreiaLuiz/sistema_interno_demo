const express = require('express');
const router = express.Router();
const licencaController = require('../controllers/licencaController');
const { autenticar, permitir } = require('../middlewares/auth');

router.use(autenticar);

router.get('/resumo/status', licencaController.resumoStatus);

router.get('/', licencaController.listar);
router.get('/:id', licencaController.buscarPorId);

router.post('/', permitir('licencas.editar'), licencaController.criar);
router.put('/:id', permitir('licencas.editar'), licencaController.atualizar);
router.delete('/:id', permitir('licencas.excluir'), licencaController.remover);

router.post('/:id/renovar', permitir('licencas.editar'), licencaController.renovar);

module.exports = router;
