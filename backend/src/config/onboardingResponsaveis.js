/**
 * Responsáveis fixos de cada estágio da esteira de integração de
 * empresa nova (ver OnboardingEmpresa.js). Nomes e e-mails vêm do
 * .env — trocar um responsável é só editar o .env, sem mexer em código.
 *
 * Enquanto os e-mails reais dos responsáveis de cada estágio
 * não estiverem configurados, cada um cai no valor de
 * ONBOARDING_EMAIL_TESTE (usado para testar a esteira inteira num
 * único e-mail antes de apontar pra pessoa de verdade).
 */

const EMAIL_TESTE = process.env.ONBOARDING_EMAIL_TESTE || '';

const RESPONSAVEIS = {
  legalizacao: [
    { nome: 'Legalização', email: process.env.ONBOARDING_LEGALIZACAO_EMAIL || EMAIL_TESTE }
  ],
  cadastro_dominio: [
    { nome: 'Cadastro', email: process.env.ONBOARDING_CADASTRO_EMAIL || EMAIL_TESTE }
  ],
  fechamento_setorial: [
    { nome: 'Responsável Fiscal', setor: 'Fiscal', email: process.env.ONBOARDING_FISCAL_EMAIL || EMAIL_TESTE },
    { nome: 'Responsável Contábil', setor: 'Contábil', email: process.env.ONBOARDING_CONTABIL_EMAIL || EMAIL_TESTE },
    { nome: 'Responsável da Folha', setor: 'Folha de Pagamento', email: process.env.ONBOARDING_FOLHA_EMAIL || EMAIL_TESTE }
  ]
};

const RESPONSAVEIS_CONFIGURADOS =
  RESPONSAVEIS.legalizacao.every((r) => r.email) &&
  RESPONSAVEIS.cadastro_dominio.every((r) => r.email) &&
  RESPONSAVEIS.fechamento_setorial.every((r) => r.email);

function responsaveisDoEstagio(estagio) {
  return RESPONSAVEIS[estagio] || [];
}

/** true se o e-mail informado é um dos responsáveis pelo estágio atual (comparação sem diferenciar maiúsculas). */
function ehResponsavelPeloEstagio(email, estagio) {
  const lista = responsaveisDoEstagio(estagio);
  return lista.some((r) => r.email && r.email.toLowerCase() === (email || '').toLowerCase());
}

module.exports = { RESPONSAVEIS, RESPONSAVEIS_CONFIGURADOS, responsaveisDoEstagio, ehResponsavelPeloEstagio };
