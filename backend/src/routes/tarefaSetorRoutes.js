const express = require('express');
const router = express.Router();
const tarefaSetorController = require('../controllers/tarefaSetorController');
const { autenticar } = require('../middlewares/auth');
const { upload: uploadMiddleware, validarConteudoArquivo } = require('../middlewares/upload');

// A restrição por setor (supervisor do setor certo, ou administrador)
// é verificada dentro do controller, já que depende do parâmetro :setor
// da própria URL — não dá pra expressar isso numa lista fixa de roles
// como o middleware `autorizar` de outras rotas faz.
router.use(autenticar);

// Antes de '/:setor' para não ser confundido com um setor chamado "pedidos-cliente"
router.get('/pedidos-cliente/resumo', tarefaSetorController.resumoPedidosCliente);
router.get('/:setor', tarefaSetorController.listar);
router.get('/:setor/resumo', tarefaSetorController.resumo);
router.post('/:setor', tarefaSetorController.criar);
router.put('/:setor/:id', tarefaSetorController.atualizar);
// Pedido do cliente: conclui anexando a guia (opcional) e avisa o cliente
router.post('/:setor/:id/concluir-pedido', uploadMiddleware.single('arquivo'), validarConteudoArquivo, tarefaSetorController.concluirPedidoCliente);
router.delete('/:setor/:id', tarefaSetorController.remover);

module.exports = router;
