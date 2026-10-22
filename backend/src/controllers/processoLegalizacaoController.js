const ProcessoLegalizacao = require('../models/ProcessoLegalizacao');
const Empresa = require('../models/Empresa');
const EtapaProcesso = require('../models/EtapaProcesso');
const Usuario = require('../models/Usuario');
const TarefaSetor = require('../models/TarefaSetor');
const HistoricoComunicacao = require('../models/HistoricoComunicacao');
const LogAuditoria = require('../models/LogAuditoria');
const { notificarMudancaStatus, notificarResponsavelEtapa, enviarEmail } = require('../services/notificacaoService');
const Notificacao = require('../models/Notificacao');
const { AppError } = require('../middlewares/errorHandler');

const ROTULOS_SETOR = { fiscal: 'Fiscal', contabilidade: 'Contabilidade', folha_pagamento: 'Folha de Pagamento' };

const TIPOS_VALIDOS = ['abertura', 'alteracao', 'baixa'];
const STATUS_VALIDOS = ['em_andamento', 'exigencia', 'concluido', 'cancelado'];

async function listar(req, res, next) {
  try {
    const { empresa_id, status, tipo, pagina, limite } = req.query;

    if (status && !STATUS_VALIDOS.includes(status)) {
      throw new AppError(`Status inválido. Use um de: ${STATUS_VALIDOS.join(', ')}`, 400);
    }
    if (tipo && !TIPOS_VALIDOS.includes(tipo)) {
      throw new AppError(`Tipo inválido. Use um de: ${TIPOS_VALIDOS.join(', ')}`, 400);
    }

    const resultado = await ProcessoLegalizacao.listar({
      empresaId: empresa_id,
      status,
      tipo,
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
    const processo = await ProcessoLegalizacao.buscarPorId(req.params.id);
    if (!processo) throw new AppError('Processo não encontrado.', 404);
    res.json(processo);
  } catch (err) {
    next(err);
  }
}

async function criar(req, res, next) {
  try {
    const { empresa_id, tipo } = req.body;

    if (!empresa_id || !tipo) {
      throw new AppError('empresa_id e tipo são obrigatórios.', 400);
    }
    if (!TIPOS_VALIDOS.includes(tipo)) {
      throw new AppError(`Tipo inválido. Use um de: ${TIPOS_VALIDOS.join(', ')}`, 400);
    }

    const empresa = await Empresa.buscarPorId(empresa_id);
    if (!empresa) throw new AppError('Empresa não encontrada.', 404);

    const dados = { ...req.body, responsavel_id: req.body.responsavel_id || req.usuario.id };
    const processo = await ProcessoLegalizacao.criar(dados);
    LogAuditoria.registrar({
      usuarioId: req.usuario.id, acao: 'CREATE', entidade: 'processo_legalizacao', entidadeId: processo.id,
      detalhes: { empresa_id: dados.empresa_id, tipo: dados.tipo }
    });

    // Popula o checklist de etapas padrão para o tipo de processo
    await EtapaProcesso.criarEtapasPadrao(processo.id, processo.tipo);

    res.status(201).json(processo);
  } catch (err) {
    next(err);
  }
}

async function atualizar(req, res, next) {
  try {
    if (req.body.tipo && !TIPOS_VALIDOS.includes(req.body.tipo)) {
      throw new AppError(`Tipo inválido. Use um de: ${TIPOS_VALIDOS.join(', ')}`, 400);
    }
    if (req.body.status && !STATUS_VALIDOS.includes(req.body.status)) {
      throw new AppError(`Status inválido. Use um de: ${STATUS_VALIDOS.join(', ')}`, 400);
    }

    const existente = await ProcessoLegalizacao.buscarPorId(req.params.id);
    if (!existente) throw new AppError('Processo não encontrado.', 404);

    const statusAnterior = existente.status;
    const processo = await ProcessoLegalizacao.atualizar(req.params.id, req.body, req.usuario.id);

    // Dispara notificação automática (e-mail/WhatsApp) quando o status muda —
    // roda em segundo plano, sem atrasar a resposta ao usuário, e nunca
    // quebra a requisição principal se o envio falhar.
    if (req.body.status && req.body.status !== statusAnterior) {
      const empresa = await Empresa.buscarPorId(processo.empresa_id);
      notificarMudancaStatus({ empresa, processo, statusAnterior, statusNovo: req.body.status })
        .catch((err) => console.error('Falha ao notificar mudança de status:', err));

      // Processo caiu em exigência: aviso no sininho do responsável
      if (req.body.status === 'exigencia' && processo.responsavel_id) {
        Notificacao.avisar({
          usuarioIds: [processo.responsavel_id], excetoUsuarioId: req.usuario.id,
          tipo: 'processo_exigencia',
          titulo: `Processo em exigência — ${empresa.razao_social}`,
          mensagem: [processo.descricao, processo.orgao, processo.protocolo && `Protocolo ${processo.protocolo}`].filter(Boolean).join(' · ') || null,
          link: `/pages/empresa.html?id=${empresa.id}#legalizacao`
        });
      }

      // Handoff automático: ao concluir o processo, quem está concluindo
      // pode indicar diretamente o e-mail do responsável em cada setor
      // (Fiscal/Contabilidade/Folha de Pagamento) para já nascer a
      // tarefa de acompanhamento por lá, sem precisar trocar de tela.
      // req.body.notificar_setores = { fiscal: 'email', contabilidade: 'email', folha_pagamento: 'email' }
      if (req.body.status === 'concluido' && req.body.notificar_setores) {
        criarTarefasHandoff({
          empresa, processo, setores: req.body.notificar_setores, criadoPor: req.usuario.id
        }).catch((err) => console.error('Falha ao criar tarefas de handoff entre setores:', err));
      }
    }

    res.json(processo);
  } catch (err) {
    next(err);
  }
}

/**
 * Cria automaticamente uma tarefa em cada setor indicado (Fiscal,
 * Contabilidade, Folha de Pagamento), atribuída ao e-mail informado,
 * quando um processo de legalização é concluído. Reaproveita a mesma
 * tabela/lógica de tarefas_setor e dispara a notificação por e-mail
 * igual a quando um supervisor cria a tarefa manualmente.
 */
async function criarTarefasHandoff({ empresa, processo, setores, criadoPor }) {
  const rotulosTipo = { abertura: 'Abertura', alteracao: 'Alteração', baixa: 'Baixa' };

  for (const [setor, email] of Object.entries(setores)) {
    if (!TarefaSetor.SETORES_VALIDOS.includes(setor)) continue;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;

    const descricao =
      `Processo de ${rotulosTipo[processo.tipo] || processo.tipo} concluído na Legalização — ` +
      `iniciar o cadastro/acompanhamento da empresa ${empresa.razao_social} no setor de ${ROTULOS_SETOR[setor]}.`;

    const tarefa = await TarefaSetor.criar({
      empresa_id: empresa.id, setor, descricao,
      responsavel_nome: null, responsavel_email: email, criado_por: criadoPor
    });

    LogAuditoria.registrar({
      usuarioId: criadoPor, acao: 'CREATE', entidade: 'tarefa_setor', entidadeId: tarefa.id,
      detalhes: { setor, empresa_id: empresa.id, responsavel_email: email, origem: 'handoff_legalizacao' }
    });

    const assunto = `Nova tarefa (${ROTULOS_SETOR[setor]}) — ${empresa.razao_social}`;
    Notificacao.avisar({
      emails: [email], excetoUsuarioId: criadoPor, tipo: 'tarefa_nova',
      titulo: `Nova tarefa para você — ${empresa.razao_social}`,
      mensagem: descricao, link: `/pages/${setor === 'folha_pagamento' ? 'folha-pagamento' : setor}.html`
    });

    let status = 'enviado';
    let erro = null;
    try {
      await enviarEmail({ destinatario: email, assunto, mensagem: descricao });
    } catch (err) {
      status = 'falhou';
      erro = err.message;
      console.error(`Falha ao notificar handoff para ${setor} (${email}):`, err);
    }
    HistoricoComunicacao.registrar({
      empresaId: empresa.id, processoId: processo.id, canal: 'email',
      destinatario: email, assunto, mensagem: descricao, status, erro
    }).catch((e) => console.error('Falha ao registrar histórico de comunicação do handoff:', e));
  }
}

async function remover(req, res, next) {
  try {
    const existente = await ProcessoLegalizacao.buscarPorId(req.params.id);
    if (!existente) throw new AppError('Processo não encontrado.', 404);

    await ProcessoLegalizacao.remover(req.params.id);
    LogAuditoria.registrar({
      usuarioId: req.usuario.id, acao: 'DELETE', entidade: 'processo_legalizacao', entidadeId: req.params.id
    });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

async function resumoStatus(req, res, next) {
  try {
    const contadores = await ProcessoLegalizacao.contarPorStatus();
    const resumo = STATUS_VALIDOS.reduce((acc, status) => {
      acc[status] = 0;
      return acc;
    }, {});
    contadores.forEach((c) => { resumo[c.status] = c.total; });
    res.json(resumo);
  } catch (err) {
    next(err);
  }
}

async function listarEtapas(req, res, next) {
  try {
    const processo = await ProcessoLegalizacao.buscarPorId(req.params.id);
    if (!processo) throw new AppError('Processo não encontrado.', 404);

    const etapas = await EtapaProcesso.listarPorProcesso(req.params.id);
    res.json(etapas);
  } catch (err) {
    next(err);
  }
}

async function adicionarEtapa(req, res, next) {
  try {
    const { nome, ordem } = req.body;
    if (!nome) throw new AppError('Nome da etapa é obrigatório.', 400);

    const processo = await ProcessoLegalizacao.buscarPorId(req.params.id);
    if (!processo) throw new AppError('Processo não encontrado.', 404);

    const etapa = await EtapaProcesso.adicionarEtapa(req.params.id, { nome, ordem });
    res.status(201).json(etapa);
  } catch (err) {
    next(err);
  }
}

async function atualizarEtapa(req, res, next) {
  try {
    const existente = await EtapaProcesso.buscarPorId(req.params.etapaId);
    if (!existente || existente.processo_id !== req.params.id) throw new AppError('Etapa não encontrada.', 404);

    const { status, responsavel_id, observacoes } = req.body;

    if (status !== undefined && !EtapaProcesso.STATUS_VALIDOS.includes(status)) {
      throw new AppError(`Status inválido. Use um de: ${EtapaProcesso.STATUS_VALIDOS.join(', ')}`, 400);
    }

    // Resolve os valores finais: o que veio no body, ou o que já estava, nunca "undefined"
    const novoStatus = status !== undefined ? status : existente.status;
    const novoResponsavelId = responsavel_id !== undefined ? responsavel_id : existente.responsavel_id;
    const novasObservacoes = observacoes !== undefined ? observacoes : existente.observacoes;

    const etapa = await EtapaProcesso.atualizar(req.params.etapaId, {
      status: novoStatus,
      responsavelId: novoResponsavelId,
      observacoes: novasObservacoes
    });

    LogAuditoria.registrar({
      usuarioId: req.usuario.id, acao: 'UPDATE', entidade: 'etapa_processo', entidadeId: etapa.id,
      detalhes: { nome: etapa.nome, status: novoStatus, responsavel_id: novoResponsavelId }
    });

    // Só notifica quando a etapa é designada para um NOVO responsável —
    // mudar status ou observações não gera e-mail. Roda em segundo plano,
    // sem atrasar a resposta nem quebrar a requisição se algo falhar.
    const responsavelMudou = novoResponsavelId && novoResponsavelId !== existente.responsavel_id;

    if (responsavelMudou) {
      (async () => {
        try {
          const etapaAtualizada = await EtapaProcesso.buscarPorId(etapa.id);
          const empresa = await Empresa.buscarPorId(etapaAtualizada.empresa_id);
          if (empresa && etapaAtualizada.responsavel_email) {
            Notificacao.avisar({
              emails: [etapaAtualizada.responsavel_email], excetoUsuarioId: req.usuario.id,
              tipo: 'etapa_designada',
              titulo: `Etapa designada para você — ${empresa.razao_social}`,
              mensagem: `"${etapaAtualizada.nome}" do processo de ${etapaAtualizada.processo_tipo}`,
              link: `/pages/empresa.html?id=${empresa.id}#legalizacao`
            });
            await notificarResponsavelEtapa({ etapa: etapaAtualizada, empresa });
          }
        } catch (err) {
          console.error('Falha ao notificar responsável pela etapa:', err);
        }
      })();
    }

    res.json(etapa);
  } catch (err) {
    next(err);
  }
}

/**
 * Lista usuários elegíveis para serem responsáveis por uma etapa
 * (administradores e analistas de legalização) — usado para popular o
 * <select> de responsável na tela de Legalização. Acessível a qualquer
 * usuário autenticado, não só administradores.
 */
async function listarResponsaveisElegiveis(req, res, next) {
  try {
    const usuarios = await Usuario.listarElegiveisParaEtapa();
    res.json(usuarios);
  } catch (err) {
    next(err);
  }
}

async function removerEtapa(req, res, next) {
  try {
    const existente = await EtapaProcesso.buscarPorId(req.params.etapaId);
    if (!existente || existente.processo_id !== req.params.id) throw new AppError('Etapa não encontrada.', 404);

    await EtapaProcesso.remover(req.params.etapaId);
    LogAuditoria.registrar({
      usuarioId: req.usuario.id, acao: 'DELETE', entidade: 'etapa_processo', entidadeId: req.params.etapaId,
      detalhes: { nome: existente.nome, processo_id: existente.processo_id }
    });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listar, buscarPorId, criar, atualizar, remover, resumoStatus,
  listarEtapas, adicionarEtapa, atualizarEtapa, removerEtapa, listarResponsaveisElegiveis
};
