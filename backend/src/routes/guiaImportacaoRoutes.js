const express = require('express');
const router = express.Router();
const controller = require('../controllers/guiaImportacaoController');
const { autenticar, permitir } = require('../middlewares/auth');
const { uploadGuias } = require('../middlewares/upload');

// Importação de guias em lote — Fiscal e Folha (DAS, DARF/INSS, FGTS...)

router.use(autenticar, permitir('guias.importar'));

router.post('/lotes', controller.criarLote);
router.post('/lotes/:loteId/arquivos', uploadGuias.array('arquivos', 25), controller.enviarArquivos);
router.get('/lotes/:loteId', controller.verLote);
router.get('/lotes/:loteId/emails', controller.statusEmails);
router.post('/lotes/:loteId/confirmar', controller.confirmar);
router.delete('/lotes/:loteId', controller.descartarLote);

// DAS direto da Receita (Integra Contador) — cada guia é cobrada pelo SERPRO
router.get('/receita', controller.receitaStatus);
router.post('/lotes/:loteId/receita', controller.buscarNaReceita);

module.exports = router;
