const express = require('express');
const router = express.Router();
const documentoController = require('../controllers/documentoController');
const { autenticar } = require('../middlewares/auth');
const { upload: uploadMiddleware, validarConteudoArquivo } = require('../middlewares/upload');

router.use(autenticar);

// Lista documentos de uma entidade: /api/documentos?empresa_id=... (ou processo_id, certidao_id, licenca_id)
router.get('/', documentoController.listar);

// Upload: multipart/form-data com o arquivo no campo "arquivo" + o id da entidade associada
router.post('/', uploadMiddleware.single('arquivo'), validarConteudoArquivo, documentoController.upload);

router.get('/:id/download', documentoController.baixar);
router.patch('/:id/visibilidade-cliente', documentoController.alterarVisibilidadeCliente);
router.delete('/:id', documentoController.remover);

module.exports = router;
