/**
 * O que cada perfil pode fazer. O administrador muda isso na tela
 * Usuários → "Permissões dos perfis" (tabela permissoes_perfil); o que não foi
 * mudado vale o "padrao" daqui (que é como o sistema sempre funcionou).
 *
 * O administrador tem TODAS as permissões, sempre (não dá para tirar — senão
 * ninguém mais conseguiria arrumar). Permissões "soAdmin" não podem ser dadas a
 * outros perfis.
 *
 * Usar nas rotas: permitir('empresas.editar'); nas telas: pode('empresas.editar').
 */

const SUP_COL = (setor) => [`supervisor_${setor}`, `colaborador_${setor}`];

const PERMISSOES = [
  // Empresas
  { chave: 'empresas.editar', grupo: 'Empresas', rotulo: 'Cadastrar e editar empresas e sócios', padrao: ['analista_legalizacao'] },
  { chave: 'empresas.excluir', grupo: 'Empresas', rotulo: 'Excluir empresa e registrar saída do escritório', padrao: [] },
  { chave: 'empresas.area_cliente', grupo: 'Empresas', rotulo: 'Liberar e tirar o acesso dos clientes à Área do Cliente', padrao: ['analista_legalizacao', 'supervisor_fiscal', 'supervisor_contabilidade', 'supervisor_folha_pagamento'] },
  { chave: 'empresas.cnd', grupo: 'Empresas', rotulo: 'Consultar CND Federal e situação fiscal (cobrado pelo SERPRO)', padrao: ['analista_legalizacao', 'analista_certidoes'] },

  // Legalização
  { chave: 'legalizacao.editar', grupo: 'Legalização', rotulo: 'Criar e mover processos, etapas, checklist e certificados digitais', padrao: ['analista_legalizacao'] },
  { chave: 'legalizacao.excluir', grupo: 'Legalização', rotulo: 'Excluir processos e certificados digitais', padrao: [] },

  // Certidões e licenças
  { chave: 'certidoes.editar', grupo: 'Certidões e licenças', rotulo: 'Cadastrar, editar e renovar certidões', padrao: ['analista_certidoes'] },
  { chave: 'certidoes.excluir', grupo: 'Certidões e licenças', rotulo: 'Excluir certidões', padrao: [] },
  { chave: 'licencas.editar', grupo: 'Certidões e licenças', rotulo: 'Cadastrar, editar e renovar licenças e alvarás', padrao: ['analista_licencas'] },
  { chave: 'licencas.excluir', grupo: 'Certidões e licenças', rotulo: 'Excluir licenças e alvarás', padrao: [] },

  // Receita, guias e fiscal
  { chave: 'caixa_postal.usar', grupo: 'Receita, guias e fiscal', rotulo: 'Caixa Postal da Receita (cobrado pelo SERPRO)', padrao: ['analista_legalizacao', 'analista_certidoes', ...SUP_COL('fiscal'), ...SUP_COL('contabilidade'), ...SUP_COL('folha_pagamento')] },
  { chave: 'guias.importar', grupo: 'Receita, guias e fiscal', rotulo: 'Importar guias e enviar aos clientes', padrao: [...SUP_COL('fiscal'), ...SUP_COL('folha_pagamento')] },

  // Contabilidade
  { chave: 'conferencia_bancaria.usar', grupo: 'Contabilidade', rotulo: 'Conferência bancária (extratos x Domínio)', padrao: SUP_COL('contabilidade') },
  { chave: 'planejamento.ver', grupo: 'Contabilidade', rotulo: 'Planejamento tributário: analisar empresas', padrao: [...SUP_COL('contabilidade'), ...SUP_COL('fiscal')] },
  { chave: 'planejamento.gerenciar', grupo: 'Contabilidade', rotulo: 'Planejamento tributário: aprovar, enviar ao cliente e rodar o radar', padrao: ['supervisor_contabilidade', 'supervisor_fiscal'] },

  // Administração
  { chave: 'auditoria.ver', grupo: 'Administração', rotulo: 'Ver a auditoria (histórico de ações)', padrao: [] },
  { chave: 'contatos_site.gerenciar', grupo: 'Administração', rotulo: 'Ver e responder os contatos do site', padrao: [] },
  { chave: 'ajuda.memoria', grupo: 'Administração', rotulo: 'Ver as perguntas feitas ao assistente e ensinar respostas', padrao: [] },
  { chave: 'claude.conectar', grupo: 'Administração', rotulo: 'Conectar o Claude ao sistema (só consulta, com as permissões da própria pessoa)', padrao: [] },
  { chave: 'usuarios.gerenciar', grupo: 'Administração', rotulo: 'Cadastrar usuários e mudar permissões', padrao: [], soAdmin: true }
];

/** Perfis que aparecem na tela (o administrador é fixo). */
const PERFIS = [
  { papel: 'analista_legalizacao', rotulo: 'Legalização' },
  { papel: 'analista_certidoes', rotulo: 'Certidões' },
  { papel: 'analista_licencas', rotulo: 'Licenças' },
  { papel: 'supervisor_fiscal', rotulo: 'Supervisor Fiscal' },
  { papel: 'colaborador_fiscal', rotulo: 'Colaborador Fiscal' },
  { papel: 'supervisor_contabilidade', rotulo: 'Supervisor Contábil' },
  { papel: 'colaborador_contabilidade', rotulo: 'Colaborador Contábil' },
  { papel: 'supervisor_folha_pagamento', rotulo: 'Supervisor Folha' },
  { papel: 'colaborador_folha_pagamento', rotulo: 'Colaborador Folha' },
  { papel: 'visualizador', rotulo: 'Visualizador' }
];

module.exports = { PERMISSOES, PERFIS };
