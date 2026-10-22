/**
 * Documentos que cada tipo de processo de legalização costuma exigir, e em
 * qual etapa cada um é usado (os nomes das etapas são os mesmos de
 * EtapaProcesso.ETAPAS_PADRAO). É a lista inicial de cada processo novo —
 * a equipe pode acrescentar ou remover itens em cada processo.
 *
 * obrigatorio: false = "se aplicável" (não conta no progresso "x de y").
 */
const CHECKLIST_PADRAO = {
  abertura: [
    { nome: 'Documentos pessoais dos sócios (RG e CPF ou CNH)', etapa: 'Junta Comercial' },
    { nome: 'Comprovante de endereço dos sócios', etapa: 'Junta Comercial' },
    { nome: 'Comprovante de endereço da empresa (IPTU ou contrato de locação)', etapa: 'Junta Comercial' },
    { nome: 'Consulta de viabilidade aprovada', etapa: 'Junta Comercial' },
    { nome: 'Contrato social assinado', etapa: 'Junta Comercial' },
    { nome: 'DBE / Coleta Web da Receita Federal', etapa: 'Receita Federal (DBE/CNPJ)' },
    { nome: 'Cadastro na SEFAZ (se tiver atividade de comércio/indústria)', etapa: 'Inscrição Estadual', obrigatorio: false },
    { nome: 'Vistoria / certificado dos Bombeiros', etapa: 'Alvará de Funcionamento' },
    { nome: 'Licença sanitária ou ambiental (se a atividade exigir)', etapa: 'Alvará de Funcionamento', obrigatorio: false }
  ],
  alteracao: [
    { nome: 'Documentos pessoais de sócios novos (se houver)', etapa: 'Elaboração do instrumento de alteração', obrigatorio: false },
    { nome: 'Comprovante do novo endereço (se mudar de endereço)', etapa: 'Elaboração do instrumento de alteração', obrigatorio: false },
    { nome: 'Consulta de viabilidade (se mudar endereço ou atividade)', etapa: 'Elaboração do instrumento de alteração', obrigatorio: false },
    { nome: 'Alteração contratual assinada por todos os sócios', etapa: 'Junta Comercial' },
    { nome: 'Cartão CNPJ atualizado', etapa: 'Atualização de cadastros (RFB/SEFAZ/Prefeitura)' }
  ],
  baixa: [
    { nome: 'Distrato social assinado', etapa: 'Distrato social' },
    { nome: 'Documentos pessoais dos sócios', etapa: 'Distrato social' },
    { nome: 'Certidões negativas (federal, estadual e municipal)', etapa: 'Baixa na Receita Federal' },
    { nome: 'Declarações finais entregues (DCTF, DEFIS/ECF)', etapa: 'Baixa na Receita Federal' },
    { nome: 'Pedido de baixa na SEFAZ', etapa: 'Baixa na Inscrição Estadual', obrigatorio: false },
    { nome: 'Pedido de baixa do alvará na Prefeitura', etapa: 'Baixa no Município' }
  ]
};

module.exports = { CHECKLIST_PADRAO };
