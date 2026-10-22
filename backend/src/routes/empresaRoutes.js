const express = require('express');
const router = express.Router();
const empresaController = require('../controllers/empresaController');
const cndFederalController = require('../controllers/cndFederalController');
const acessoClienteController = require('../controllers/acessoClienteController');
const fichaEmpresaController = require('../controllers/fichaEmpresaController');
const { autenticar, permitir } = require('../middlewares/auth');

// Todas as rotas de empresa exigem autenticação
router.use(autenticar);

router.get('/', empresaController.listar);
router.get('/:id', empresaController.buscarPorId);
// Ficha completa: processos, vencimentos, documentos, tarefas, pedidos, comunicação
router.get('/:id/ficha', fichaEmpresaController.ficha);

router.post('/', permitir('empresas.editar'), empresaController.criar);
router.put('/:id', permitir('empresas.editar'), empresaController.atualizar);
router.delete('/:id', permitir('empresas.excluir'), empresaController.remover);

// Saída da empresa do escritório — avisa todo o escritório por e-mail
router.post('/:id/saida', permitir('empresas.excluir'), empresaController.registrarSaida);

// Sócios
router.post('/:id/socios', permitir('empresas.editar'), empresaController.adicionarSocio);
router.delete('/:id/socios/:socioId', permitir('empresas.editar'), empresaController.removerSocio);

// CND Federal pela API do SERPRO (ver src/controllers/cndFederalController.js) — cada consulta é cobrada
router.get('/:id/cnd-federal', permitir('empresas.cnd'), cndFederalController.ver);
router.post('/:id/cnd-federal', permitir('empresas.cnd'), cndFederalController.consultar);
// Relatório de Situação Fiscal pelo Integra Contador (também cobrado)
router.post('/:id/situacao-fiscal', permitir('empresas.cnd'), cndFederalController.situacaoFiscal);

// Área do Cliente — quem tem login para acessar os dados desta empresa
router.get('/:id/acessos-cliente', permitir('empresas.area_cliente'), acessoClienteController.listar);
router.post('/:id/acessos-cliente', permitir('empresas.area_cliente'), acessoClienteController.liberar);
router.post('/:id/acessos-cliente/:clienteId/reenviar', permitir('empresas.area_cliente'), acessoClienteController.reenviarConvite);
router.delete('/:id/acessos-cliente/:clienteId', permitir('empresas.area_cliente'), acessoClienteController.remover);

// Histórico de comunicação (e-mail/WhatsApp) enviado para a empresa
router.get('/:id/comunicacoes', empresaController.listarComunicacoes);

module.exports = router;
