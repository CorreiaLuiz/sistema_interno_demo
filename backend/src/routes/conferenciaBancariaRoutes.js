const express = require('express');
const router = express.Router();
const controller = require('../controllers/conferenciaBancariaController');
const { autenticar, permitir } = require('../middlewares/auth');

// Conferência bancária — setor Contábil
router.use(autenticar, permitir('conferencia_bancaria.usar'));

router.get('/empresas', controller.listar);
router.post('/planilha', controller.atualizarPlanilha);
router.get('/empresas/:id', controller.detalhar);
router.post('/empresas/:id/conferir', controller.conferir);
router.put('/empresas/:id', controller.corrigir);
router.put('/empresas/:id/vinculos', controller.vincular);
router.put('/empresas/:id/encerramentos', controller.encerrar);
router.post('/lote', controller.iniciarLote);
router.get('/lote', controller.verLote);
router.get('/pastas', controller.pastas);
router.get('/painel', controller.painel);

module.exports = router;
