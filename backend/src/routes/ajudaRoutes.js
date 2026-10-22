const express = require('express');
const rateLimit = require('express-rate-limit');
const controller = require('../controllers/ajudaController');
const { autenticar, permitir, autenticarCliente } = require('../middlewares/auth');

const router = express.Router();

// Perguntas à IA custam: limite por pessoa (além do limite do dia, no controller)
const limitar = (max, chave) => rateLimit({
  windowMs: 60 * 60 * 1000,
  max,
  keyGenerator: chave,
  message: { erro: 'Você fez muitas perguntas seguidas. Aguarde um pouco e tente de novo.' },
  standardHeaders: true,
  legacyHeaders: false
});
const limiteEquipe = limitar(40, (req) => `equipe:${req.usuario.id}`);
const limiteCliente = limitar(20, (req) => `cliente:${req.cliente.id}`);

// Manual da Área do Cliente é público (ajuda também quem não consegue entrar).
// Sem login, a pergunta é respondida só com a busca no manual (sem IA, sem custo).
router.get('/cliente/manual', controller.manual('cliente'));
router.post('/cliente/buscar', limitar(60, (req) => `ip:${req.ip}`), controller.buscarPublico);
router.post('/cliente/perguntar', autenticarCliente, limiteCliente, controller.perguntar('cliente'));
router.post('/cliente/avaliar/:id', autenticarCliente, controller.avaliar('cliente'));

router.get('/equipe/manual', autenticar, controller.manual('equipe'));
router.post('/equipe/perguntar', autenticar, limiteEquipe, controller.perguntar('equipe'));
router.post('/equipe/avaliar/:id', autenticar, controller.avaliar('equipe'));

router.get('/perguntas', autenticar, permitir('ajuda.memoria'), controller.listarPerguntas);

// Memória do assistente: respostas ensinadas pelo administrador
router.get('/memoria', autenticar, permitir('ajuda.memoria'), controller.listarMemoria);
router.post('/memoria', autenticar, permitir('ajuda.memoria'), controller.criarMemoria);
router.put('/memoria/:id', autenticar, permitir('ajuda.memoria'), controller.atualizarMemoria);
router.delete('/memoria/:id', autenticar, permitir('ajuda.memoria'), controller.excluirMemoria);

module.exports = router;
