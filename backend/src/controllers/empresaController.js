const Empresa = require('../models/Empresa');
const Certidao = require('../models/Certidao');
const ProcessoLegalizacao = require('../models/ProcessoLegalizacao');
const EtapaProcesso = require('../models/EtapaProcesso');
const Usuario = require('../models/Usuario');
const OnboardingEmpresa = require('../models/OnboardingEmpresa');
const ClientePortal = require('../models/ClientePortal');
const HistoricoComunicacao = require('../models/HistoricoComunicacao');
const LogAuditoria = require('../models/LogAuditoria');
const { enviarEmail } = require('../services/notificacaoService');
const { enviarAvisoEntrada, enviarAvisoSaida } = require('../services/avisosEscritorioService');
const { responsaveisDoEstagio } = require('../config/onboardingResponsaveis');
const { AppError } = require('../middlewares/errorHandler');

// Validação simples de CNPJ (formato); validação de dígito verificador pode
// ser adicionada depois via lib especializada (ex: cnpj-validator).
function formatoCnpjValido(cnpj) {
  return /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(cnpj) || /^\d{14}$/.test(cnpj);
}

/**
 * Normaliza os campos do informativo de entrada vindos do formulário:
 * competência "AAAA-MM" (input type=month) vira o dia 1º do mês, e
 * fator R chega como "sim"/"nao"/"" ou booleano. A situação
 * 'saiu_escritorio' só pode ser definida pelo botão de saída.
 */
function normalizarDadosEmpresa(body) {
  const dados = { ...body };

  if (dados.situacao === 'saiu_escritorio') {
    throw new AppError('Use o botão "Registrar saída do escritório" para marcar a saída da empresa.', 400);
  }

  if (dados.competencia_inicio !== undefined) {
    const valor = String(dados.competencia_inicio || '').trim();
    if (!valor) {
      delete dados.competencia_inicio;
    } else if (/^\d{4}-\d{2}(-\d{2})?$/.test(valor)) {
      dados.competencia_inicio = `${valor.slice(0, 7)}-01`;
    } else {
      throw new AppError('Competência de início inválida. Use o formato AAAA-MM.', 400);
    }
  }

  if (dados.fator_r !== undefined) {
    if (dados.fator_r === true || dados.fator_r === 'sim') dados.fator_r = true;
    else if (dados.fator_r === false || dados.fator_r === 'nao') dados.fator_r = false;
    else delete dados.fator_r;
  }

  if (dados.pro_labore !== undefined) {
    dados.pro_labore = String(dados.pro_labore || '').trim().slice(0, 255) || undefined;
  }

  return dados;
}

async function listar(req, res, next) {
  try {
    const { busca, situacao, pagina, limite } = req.query;
    const resultado = await Empresa.listar({
      busca,
      situacao,
      pagina: pagina ? Number(pagina) : 1,
      limite: limite ? Number(limite) : 20
    });
    res.json(resultado);
  } catch (err) {
    next(err);
  }
}

async function buscarPorId(req, res, next) {
  try {
    const empresa = await Empresa.buscarPorId(req.params.id);
    if (!empresa) throw new AppError('Empresa não encontrada.', 404);
    res.json(empresa);
  } catch (err) {
    next(err);
  }
}

async function criar(req, res, next) {
  try {
    const { razao_social, cnpj, responsavel_legalizacao_id } = req.body;

    if (!razao_social || !cnpj) {
      throw new AppError('Razão social e CNPJ são obrigatórios.', 400);
    }
    if (!formatoCnpjValido(cnpj)) {
      throw new AppError('Formato de CNPJ inválido. Use 00.000.000/0000-00 ou 14 dígitos.', 400);
    }

    const empresa = await Empresa.criar(normalizarDadosEmpresa(req.body));
    LogAuditoria.registrar({
      usuarioId: req.usuario.id, acao: 'CREATE', entidade: 'empresa', entidadeId: empresa.id,
      detalhes: { razao_social: empresa.razao_social, cnpj: empresa.cnpj }
    });

    // Esteira de integração de empresa nova (fluxo fixo descrito pelo
    // escritório: Cadastro → Legalização → Cadastro no Domínio →
    // Fechamento setorial). Toda empresa cadastrada entra
    // automaticamente aqui, já no estágio de Legalização. Roda em
    // paralelo à resposta da API — nunca deve travar nem quebrar o
    // cadastro da empresa se o e-mail falhar.
    (async () => {
      try {
        await OnboardingEmpresa.iniciar(empresa.id, 'legalizacao');

        // Informativo interno para todo o escritório: empresa nova a partir da competência X
        await enviarAvisoEntrada(empresa, req.usuario);

        for (const resp of responsaveisDoEstagio('legalizacao')) {
          if (!resp.email) continue;
          const assunto = `Nova empresa para Legalização — ${empresa.razao_social}`;
          const mensagem =
            `Olá, ${resp.nome}! A empresa ${empresa.razao_social} (CNPJ ${empresa.cnpj}) ` +
            `foi cadastrada e está pronta para a etapa de Legalização. Você é responsável por essa parte agora.`;
          let status = 'enviado';
          let erro = null;
          try {
            await enviarEmail({ destinatario: resp.email, assunto, mensagem });
          } catch (err) {
            status = 'falhou';
            erro = err.message;
            console.error(`Falha ao notificar ${resp.nome} sobre nova empresa para legalização:`, err);
          }
          HistoricoComunicacao.registrar({
            empresaId: empresa.id, processoId: null, canal: 'email',
            destinatario: resp.email, assunto, mensagem, status, erro
          }).catch((e) => console.error('Falha ao registrar histórico de comunicação:', e));
        }
      } catch (err) {
        console.error('Falha ao iniciar esteira de onboarding da empresa:', err);
      }
    })();

    // Se um responsável de Legalização foi indicado no cadastro, já cria
    // sozinho o processo de abertura atribuído a ele — junto com o
    // checklist padrão de etapas — e avisa por e-mail. Fecha o primeiro
    // elo da corrente: Empresa cadastrada → tarefa cai pra Legalização.
    if (responsavel_legalizacao_id) {
      (async () => {
        try {
          const processo = await ProcessoLegalizacao.criar({
            empresa_id: empresa.id,
            tipo: 'abertura',
            status: 'em_andamento',
            responsavel_id: responsavel_legalizacao_id,
            descricao: 'Abertura gerada automaticamente ao cadastrar a empresa.'
          });
          await EtapaProcesso.criarEtapasPadrao(processo.id, 'abertura');

          LogAuditoria.registrar({
            usuarioId: req.usuario.id, acao: 'CREATE', entidade: 'processo_legalizacao', entidadeId: processo.id,
            detalhes: { empresa_id: empresa.id, tipo: 'abertura', origem: 'handoff_cadastro_empresa', responsavel_legalizacao_id }
          });

          const responsavel = await Usuario.buscarPorId(responsavel_legalizacao_id);
          if (responsavel && responsavel.email) {
            const assunto = `Nova empresa para abertura — ${empresa.razao_social}`;
            const mensagem =
              `Olá, ${responsavel.nome}! A empresa ${empresa.razao_social} (CNPJ ${empresa.cnpj}) ` +
              `foi cadastrada e o processo de abertura já está atribuído a você. Acesse a tela de Legalização para começar.`;
            let status = 'enviado';
            let erro = null;
            try {
              await enviarEmail({ destinatario: responsavel.email, assunto, mensagem });
            } catch (err) {
              status = 'falhou';
              erro = err.message;
              console.error('Falha ao notificar responsável pela abertura:', err);
            }
            HistoricoComunicacao.registrar({
              empresaId: empresa.id, processoId: processo.id, canal: 'email',
              destinatario: responsavel.email, assunto, mensagem, status, erro
            }).catch((e) => console.error('Falha ao registrar histórico de comunicação:', e));
          }
        } catch (err) {
          console.error('Falha ao criar processo de abertura automático:', err);
        }
      })();
    }

    res.status(201).json(empresa);
  } catch (err) {
    next(err);
  }
}

async function atualizar(req, res, next) {
  try {
    const existente = await Empresa.buscarPorId(req.params.id);
    if (!existente) throw new AppError('Empresa não encontrada.', 404);

    const empresa = await Empresa.atualizar(req.params.id, normalizarDadosEmpresa(req.body));
    LogAuditoria.registrar({
      usuarioId: req.usuario.id, acao: 'UPDATE', entidade: 'empresa', entidadeId: empresa.id
    });
    res.json(empresa);
  } catch (err) {
    next(err);
  }
}

/**
 * Registra a saída da empresa do escritório (só administrador): marca a
 * situação, desativa os links da Área do Cliente e avisa todo o
 * escritório no modelo "EMPRESA - SAÍDA DO ESCRITÓRIO EM dd/mm/aaaa".
 * body: { data_saida: 'AAAA-MM-DD' (último dia de responsabilidade), observacao }
 */
async function registrarSaida(req, res, next) {
  try {
    const { data_saida, observacao } = req.body;
    if (!data_saida || !/^\d{4}-\d{2}-\d{2}$/.test(data_saida)) {
      throw new AppError('Informe a data de encerramento da responsabilidade (AAAA-MM-DD).', 400);
    }

    const existente = await Empresa.buscarPorId(req.params.id);
    if (!existente) throw new AppError('Empresa não encontrada.', 404);
    if (existente.situacao === 'saiu_escritorio') {
      throw new AppError('A saída desta empresa já foi registrada.', 400);
    }

    const empresa = await Empresa.registrarSaida(req.params.id, {
      dataSaida: data_saida,
      observacao: observacao ? String(observacao).trim().slice(0, 2000) : null
    });
    // Ninguém mais acessa a Área do Cliente desta empresa
    await ClientePortal.removerTodosDaEmpresa(empresa.id);

    LogAuditoria.registrar({
      usuarioId: req.usuario.id, acao: 'UPDATE', entidade: 'empresa', entidadeId: empresa.id,
      detalhes: { acao_especifica: 'saida_do_escritorio', data_saida, situacao_anterior: existente.situacao }
    });

    enviarAvisoSaida(empresa, req.usuario);

    res.json(empresa);
  } catch (err) {
    next(err);
  }
}

async function remover(req, res, next) {
  try {
    const existente = await Empresa.buscarPorId(req.params.id);
    if (!existente) throw new AppError('Empresa não encontrada.', 404);

    await Empresa.remover(req.params.id);
    LogAuditoria.registrar({
      usuarioId: req.usuario.id, acao: 'DELETE', entidade: 'empresa', entidadeId: req.params.id,
      detalhes: { razao_social: existente.razao_social, cnpj: existente.cnpj }
    });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

async function adicionarSocio(req, res, next) {
  try {
    const { nome } = req.body;
    if (!nome) throw new AppError('Nome do sócio é obrigatório.', 400);

    const empresa = await Empresa.buscarPorId(req.params.id);
    if (!empresa) throw new AppError('Empresa não encontrada.', 404);

    const socio = await Empresa.adicionarSocio(req.params.id, req.body);
    res.status(201).json(socio);
  } catch (err) {
    next(err);
  }
}

async function removerSocio(req, res, next) {
  try {
    await Empresa.removerSocio(req.params.socioId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

/**
 * Dispara a consulta automática de uma CND para a empresa e grava/atualiza
 * o resultado na tabela de certidões (upsert por empresa+tipo).
 */
async function listarComunicacoes(req, res, next) {
  try {
    const comunicacoes = await HistoricoComunicacao.listarPorEmpresa(req.params.id);
    res.json(comunicacoes);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listar, buscarPorId, criar, atualizar, remover, registrarSaida, adicionarSocio, removerSocio,
  listarComunicacoes
};
