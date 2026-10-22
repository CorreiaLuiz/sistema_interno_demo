const express = require('express');
const router = express.Router();
const certificadoDigitalController = require('../controllers/certificadoDigitalController');
const { autenticar, permitir } = require('../middlewares/auth');

router.use(autenticar);

router.get('/resumo/status', certificadoDigitalController.resumoStatus);
router.get('/empresa/:empresaId', certificadoDigitalController.listarPorEmpresa);

router.post('/', permitir('legalizacao.editar'), certificadoDigitalController.criar);
router.put('/:id', permitir('legalizacao.editar'), certificadoDigitalController.atualizar);
router.delete('/:id', permitir('legalizacao.excluir'), certificadoDigitalController.remover);

module.exports = router;
