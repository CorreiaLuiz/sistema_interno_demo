const express = require('express');
const router = express.Router();
const certidaoController = require('../controllers/certidaoController');
const { autenticar, permitir } = require('../middlewares/auth');

router.use(autenticar);

// Resumo para dashboard (contagem por status) — antes de /:id para não colidir com a rota dinâmica
router.get('/resumo/status', certidaoController.resumoStatus);

router.get('/', certidaoController.listar);
router.get('/:id', certidaoController.buscarPorId);

router.post('/', permitir('certidoes.editar'), certidaoController.criar);
router.put('/:id', permitir('certidoes.editar'), certidaoController.atualizar);
router.delete('/:id', permitir('certidoes.excluir'), certidaoController.remover);

// Renovação: registra histórico e atualiza a certidão
router.post('/:id/renovar', permitir('certidoes.editar'), certidaoController.renovar);

module.exports = router;
