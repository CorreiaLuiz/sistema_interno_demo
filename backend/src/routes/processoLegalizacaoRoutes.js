const express = require('express');
const router = express.Router();
const processoController = require('../controllers/processoLegalizacaoController');
const pipelineController = require('../controllers/pipelineLegalizacaoController');
const { autenticar, permitir } = require('../middlewares/auth');

router.use(autenticar);

router.get('/resumo/status', processoController.resumoStatus);
router.get('/responsaveis-elegiveis', processoController.listarResponsaveisElegiveis);

// Quadro (pipeline) por etapas — antes de '/:id' para não virar um id
router.get('/pipeline', pipelineController.pipeline);
router.post('/:id/mover', permitir('legalizacao.editar'), pipelineController.mover);

// Checklist de documentos do processo
router.get('/:id/checklist', pipelineController.listarChecklist);
router.post('/:id/checklist', permitir('legalizacao.editar'), pipelineController.adicionarItem);
router.patch('/:id/checklist/:itemId', permitir('legalizacao.editar'), pipelineController.atualizarItem);
router.delete('/:id/checklist/:itemId', permitir('legalizacao.editar'), pipelineController.removerItem);

router.get('/', processoController.listar);
router.get('/:id', processoController.buscarPorId);

router.post('/', permitir('legalizacao.editar'), processoController.criar);
router.put('/:id', permitir('legalizacao.editar'), processoController.atualizar);
router.delete('/:id', permitir('legalizacao.excluir'), processoController.remover);

// Etapas (checklist) do processo
router.get('/:id/etapas', processoController.listarEtapas);
router.post('/:id/etapas', permitir('legalizacao.editar'), processoController.adicionarEtapa);
router.patch('/:id/etapas/:etapaId', permitir('legalizacao.editar'), processoController.atualizarEtapa);
router.delete('/:id/etapas/:etapaId', permitir('legalizacao.editar'), processoController.removerEtapa);

module.exports = router;
