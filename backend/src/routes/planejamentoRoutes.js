const express = require('express');
const rateLimit = require('express-rate-limit');
const controller = require('../controllers/planejamentoController');
const { autenticar, permitir } = require('../middlewares/auth');

// Planejamento tributário — setores Contábil e Fiscal. Aprovar e enviar ao
// cliente fica com administrador e supervisores.

const equipe = express.Router();
equipe.use(autenticar, permitir('planejamento.ver'));
equipe.get('/analises', controller.listar);
equipe.get('/dominio', controller.buscarNoDominio);
equipe.post('/analisar', controller.analisar);
equipe.get('/analises/:id', controller.detalhar);
equipe.get('/analises/:id/pdf', controller.baixarPdf);
equipe.post('/analises/:id/aprovar', permitir('planejamento.gerenciar'), controller.aprovar);
equipe.post('/analises/:id/enviar', permitir('planejamento.gerenciar'), controller.enviar);
equipe.get('/contatos/:cnpj', controller.contatos);
equipe.post('/questionarios', controller.criarQuestionario);
equipe.post('/radar', permitir('planejamento.gerenciar'), controller.iniciarRadar);
equipe.get('/radar', controller.verRadar);

// Questionário pelo link (sem login). Limite por IP contra adivinhação de links.
const limitador = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { erro: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' },
  standardHeaders: true,
  legacyHeaders: false
});
const publico = express.Router();
publico.use(limitador);
publico.get('/questionario/:token', controller.questionarioPublico);
publico.post('/questionario/:token', controller.responderQuestionario);

module.exports = { equipe, publico };
