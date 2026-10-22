const express = require('express');
const rateLimit = require('express-rate-limit');
const controller = require('../controllers/conectorController');
const { autenticar, permitir } = require('../middlewares/auth');

// Servidor MCP: entra com a chave do conector (não com o login da tela)
const mcp = express.Router();
mcp.use(rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  // conta por chave (cabeçalho ou endereço), guardando só um pedaço do hash
  keyGenerator: (req) => `mcp:${require('crypto').createHash('sha256').update(req.headers.authorization || req.originalUrl || req.ip || '').digest('hex').slice(0, 16)}`,
  message: { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Muitas consultas seguidas. Aguarde um minuto.' } },
  standardHeaders: true,
  legacyHeaders: false
}));
mcp.post('/', controller.mcp);
mcp.post('/:chave', controller.mcp);
mcp.get('/', controller.soPost);
mcp.get('/:chave', controller.soPost);

// Chaves do conector (tela Ajuda → Conectar o Claude)
const chaves = express.Router();
chaves.use(autenticar, permitir('claude.conectar'));
chaves.get('/chaves', controller.listarChaves);
chaves.post('/chaves', controller.criarChave);
chaves.delete('/chaves/:id', controller.revogarChave);

module.exports = { mcp, chaves };
