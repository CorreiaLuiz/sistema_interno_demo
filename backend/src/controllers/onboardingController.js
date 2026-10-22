const OnboardingEmpresa = require('../models/OnboardingEmpresa');
const Empresa = require('../models/Empresa');
const LogAuditoria = require('../models/LogAuditoria');
const { enviarEmail } = require('../services/notificacaoService');
const { enviarAvisoDominio } = require('../services/avisosEscritorioService');
const HistoricoComunicacao = require('../models/HistoricoComunicacao');
const { responsaveisDoEstagio, ehResponsavelPeloEstagio } = require('../config/onboardingResponsaveis');
const Notificacao = require('../models/Notificacao');
const { AppError } = require('../middlewares/errorHandler');

const ROTULOS_ESTAGIO = {
  legalizacao: 'Legalização',
  cadastro_dominio: 'Cadastro no Domínio',
  fechamento_setorial: 'Fechamento setorial'
};

async function buscar(req, res, next) {
  try {
    const empresa = await Empresa.buscarPorId(req.params.empresaId);
    if (!empresa) throw new AppError('Empresa não encontrada.', 404);

    const onboarding = await OnboardingEmpresa.buscarPorEmpresa(req.params.empresaId);
    if (!onboarding) {
      return res.json({ empresa_id: empresa.id, estagio: null, mensagem: 'Esta empresa não está na esteira de integração.' });
    }

    const historico = await OnboardingEmpresa.historico(req.params.empresaId);
    res.json({
      ...onboarding,
      responsaveis_estagio_atual: responsaveisDoEstagio(onboarding.estagio),
      historico
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Avança a esteira para o próximo estágio fixo. Só quem está
 * configurado como responsável pelo estágio ATUAL (ou administrador)
 * pode chamar isso — é o "concluir minha parte e passar adiante".
 */
async function avancar(req, res, next) {
  try {
    const { empresaId } = req.params;
    const empresa = await Empresa.buscarPorId(empresaId);
    if (!empresa) throw new AppError('Empresa não encontrada.', 404);

    const onboarding = await OnboardingEmpresa.buscarPorEmpresa(empresaId);
    if (!onboarding) throw new AppError('Esta empresa não está na esteira de integração.', 404);

    const estagioAtual = onboarding.estagio;
    const proximoEstagio = OnboardingEmpresa.PROXIMO_ESTAGIO[estagioAtual];
    if (!proximoEstagio) {
      throw new AppError('Este é o último estágio automatizado da esteira — a partir daqui a distribuição é manual, pelo coordenador de cada setor.', 400);
    }

    const podeAvancar =
      req.usuario.role === 'administrador' || ehResponsavelPeloEstagio(req.usuario.email, estagioAtual);
    if (!podeAvancar) {
      throw new AppError('Você não é responsável pelo estágio atual desta empresa.', 403);
    }

    const atualizado = await OnboardingEmpresa.avancar(empresaId, proximoEstagio, req.usuario.id);

    LogAuditoria.registrar({
      usuarioId: req.usuario.id, acao: 'UPDATE', entidade: 'onboarding_empresa', entidadeId: empresaId,
      detalhes: { de: estagioAtual, para: proximoEstagio }
    });

    // Dispara as notificações em paralelo à resposta da API — não faz
    // sentido o usuário esperar todos os e-mails saírem pra ver a tela
    // atualizar (mesmo padrão fire-and-forget usado no resto do sistema).
    (async () => {
      // Aviso para todo o escritório só quando a empresa acaba de ser
      // cadastrada no Domínio — os demais avanços avisam apenas quem é o
      // próximo responsável.
      if (estagioAtual === 'cadastro_dominio') {
        await enviarAvisoDominio(empresa, req.usuario);
      }

      const proximosResponsaveis = responsaveisDoEstagio(proximoEstagio);
      Notificacao.avisar({
        emails: proximosResponsaveis.map((r) => r.email), excetoUsuarioId: req.usuario.id,
        tipo: 'esteira_etapa',
        titulo: `Empresa pronta para ${ROTULOS_ESTAGIO[proximoEstagio]} — ${empresa.razao_social}`,
        mensagem: `Etapa anterior concluída por ${req.usuario.nome}. Agora é a sua parte.`,
        link: `/pages/empresa.html?id=${empresaId}`
      });
      for (const resp of proximosResponsaveis) {
        if (!resp.email) continue; // sem e-mail configurado ainda — pula silenciosamente
        const assunto = `Nova empresa para ${ROTULOS_ESTAGIO[proximoEstagio]} — ${empresa.razao_social}`;
        const mensagem =
          `Olá, ${resp.nome}! A empresa ${empresa.razao_social} (CNPJ ${empresa.cnpj}) ` +
          `está pronta para a etapa de ${ROTULOS_ESTAGIO[proximoEstagio]}${resp.setor ? ` (setor ${resp.setor})` : ''}. ` +
          `Você é responsável por essa parte agora.`;

        let status = 'enviado';
        let erro = null;
        try {
          await enviarEmail({ destinatario: resp.email, assunto, mensagem });
        } catch (err) {
          status = 'falhou';
          erro = err.message;
          console.error(`Falha ao notificar ${resp.nome} (${resp.email}) sobre novo estágio:`, err);
        }
        HistoricoComunicacao.registrar({
          empresaId, processoId: null, canal: 'email',
          destinatario: resp.email, assunto, mensagem, status, erro
        }).catch((e) => console.error('Falha ao registrar histórico de comunicação:', e));
      }
    })();

    res.json(atualizado);
  } catch (err) {
    next(err);
  }
}

module.exports = { buscar, avancar };