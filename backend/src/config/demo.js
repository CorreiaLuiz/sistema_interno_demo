/**
 * Modo demonstração (MODO_DEMO=true no .env): o sistema roda sozinho, com
 * dados fictícios, sem depender de nada de fora — o SERPRO e o Domínio
 * respondem com dados de exemplo e e-mail/WhatsApp ficam só simulados.
 */
const MODO_DEMO = process.env.MODO_DEMO === 'true';

const SENHA_DEMO = 'demo1234';

// Logins mostrados na tela de entrada da demonstração
const CONTAS_DEMO = [
  { papel: 'administrador', nome: 'Administrador Demo', email: 'admin@demo.com.br', rotulo: 'Administrador (vê tudo)' },
  { papel: 'analista_legalizacao', nome: 'Analista de Legalização', email: 'legalizacao@demo.com.br', rotulo: 'Legalização' },
  { papel: 'supervisor_fiscal', nome: 'Supervisor Fiscal', email: 'fiscal@demo.com.br', rotulo: 'Fiscal' },
  { papel: 'supervisor_contabilidade', nome: 'Supervisor Contábil', email: 'contabil@demo.com.br', rotulo: 'Contabilidade' },
  { papel: 'supervisor_folha_pagamento', nome: 'Supervisor da Folha', email: 'folha@demo.com.br', rotulo: 'Folha de Pagamento' }
];
const CLIENTE_DEMO = { nome: 'Cliente Demo', email: 'cliente@demo.com.br' };

module.exports = { MODO_DEMO, SENHA_DEMO, CONTAS_DEMO, CLIENTE_DEMO };
