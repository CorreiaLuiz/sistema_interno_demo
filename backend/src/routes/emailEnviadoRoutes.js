const express = require('express');
const controller = require('../controllers/emailEnviadoController');
const { autenticar } = require('../middlewares/auth');

// Links que vão dentro do e-mail do cliente — públicos (sem login),
// protegidos pelo código aleatório de cada e-mail
const rastreio = express.Router();
rastreio.get('/:token/a.gif', controller.abertura);
rastreio.get('/:token/d/:documentoId', controller.paginaDownload);
rastreio.get('/:token/d/:documentoId/arquivo', controller.baixarArquivo);

// Tela "E-mails enviados" — qualquer pessoa da equipe
const equipe = express.Router();
equipe.get('/', autenticar, controller.listar);

module.exports = { rastreio, equipe };
