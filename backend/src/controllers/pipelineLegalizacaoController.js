const { query } = require('../config/db');
const ProcessoLegalizacao = require('../models/ProcessoLegalizacao');
const EtapaProcesso = require('../models/EtapaProcesso');
const ChecklistProcesso = require('../models/ChecklistProcesso');
const Empresa = require('../models/Empresa');
const LogAuditoria = require('../models/LogAuditoria');
const { Documento } = require('../models/Documento');
const { notificarMudancaStatus } = require('../services/notificacaoService');
const { AppError } = require('../middlewares/errorHandler');

/**
 * Quadro (pipeline) da Legalização e checklist de documentos de cada
 * processo. As colunas do quadro são as etapas reais do tipo de processo
 * (Junta Comercial, Receita Federal...) mais "Concluído".
 */

const TIPOS = ['abertura', 'alteracao', 'baixa'];
const COLUNA_CONCLUIDO = '__concluido__';
const DIA_MS = 24 * 60 * 60 * 1000;

/** Etapa em que o processo está: a primeira (pela ordem) que não foi concluída. */
function etapaAtual(etapas) {
  return etapas.find((e) => e.status !== 'concluido') || null;
}

/** Desde quando o processo está na etapa atual (fim da etapa anterior, ou abertura). */
function inicioDaEtapa(processo, etapas, atual) {
  const anteriores = etapas.filter((e) => e.ordem < atual.ordem && e.concluida_em);
  const ultimaConclusao = anteriores.reduce((max, e) => (new Date(e.concluida_em) > max ? new Date(e.concluida_em) : max), null);
  return ultimaConclusao || new Date(processo.criado_em);
}

async function pipeline(req, res, next) {
  try {
    const tipo = req.query.tipo || 'abertura';
    if (!TIPOS.includes(tipo)) throw new AppError('Tipo de processo inválido.', 400);

    // Processos em aberto + concluídos nos últimos 30 dias (cancelados ficam de fora)
    const { rows: processos } = await query(
      `SELECT p.*, e.razao_social, e.nome_fantasia, e.cnpj, u.nome AS responsavel_nome
       FROM processos_legalizacao p
       JOIN empresas e ON e.id = p.empresa_id
       LEFT JOIN usuarios u ON u.id = p.responsavel_id
       WHERE p.tipo = $1
         AND (p.status IN ('em_andamento', 'exigencia')
              OR (p.status = 'concluido' AND COALESCE(p.data_conclusao, p.atualizado_em::date) >= CURRENT_DATE - 30))
       ORDER BY p.criado_em`,
      [tipo]
    );

    await ChecklistProcesso.iniciarPendentes(processos);
    const ids = processos.map((p) => p.id);
    const [etapas, contagens] = await Promise.all([
      EtapaProcesso.listarPorProcessos(ids),
      ChecklistProcesso.contagens(ids)
    ]);

    // Colunas: etapas padrão do tipo + etapas extras que algum processo tenha
    const colunas = [...(EtapaProcesso.ETAPAS_PADRAO[tipo] || [])];
    const cartoes = processos.map((p) => {
      const etapasDoProcesso = etapas.filter((e) => e.processo_id === p.id);
      const atual = p.status === 'concluido' ? null : etapaAtual(etapasDoProcesso);
      const coluna = atual ? atual.nome : COLUNA_CONCLUIDO;
      if (atual && !colunas.includes(atual.nome)) colunas.push(atual.nome);
      const inicio = atual ? inicioDaEtapa(p, etapasDoProcesso, atual) : null;
      const docs = contagens[p.id] || { total: 0, recebidos: 0 };
      return {
        id: p.id,
        empresa_id: p.empresa_id,
        razao_social: p.razao_social,
        nome_fantasia: p.nome_fantasia,
        cnpj: p.cnpj,
        status: p.status,
        protocolo: p.protocolo,
        orgao: p.orgao,
        data_prevista_conclusao: p.data_prevista_conclusao,
        responsavel_nome: (atual && atual.responsavel_nome) || p.responsavel_nome,
        coluna,
        etapa_status: atual ? atual.status : 'concluido',
        exigencia: p.status === 'exigencia' || (atual && atual.status === 'exigencia'),
        dias_na_etapa: inicio ? Math.max(0, Math.floor((Date.now() - inicio.getTime()) / DIA_MS)) : null,
        atrasado: !!(p.data_prevista_conclusao && p.status !== 'concluido' && new Date(p.data_prevista_conclusao) < new Date(new Date().toDateString())),
        documentos: docs,
        etapas: etapasDoProcesso.map((e) => e.nome)
      };
    });

    res.json({
      tipo,
      colunas: [...colunas.map((nome) => ({ chave: nome, rotulo: nome })), { chave: COLUNA_CONCLUIDO, rotulo: 'Concluído' }],
      cartoes
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Arrastar o cartão: leva o processo para a etapa escolhida. Etapas
 * anteriores ficam concluídas, a escolhida em andamento e as seguintes
 * pendentes. Levar para "Concluído" conclui todas e o processo.
 */
async function mover(req, res, next) {
  try {
    const { destino } = req.body;
    const processo = await ProcessoLegalizacao.buscarPorId(req.params.id);
    if (!processo) throw new AppError('Processo não encontrado.', 404);
    if (processo.status === 'cancelado') throw new AppError('Processo cancelado não pode ser movido.', 400);

    const etapas = await EtapaProcesso.listarPorProcesso(processo.id);
    const paraConcluido = destino === COLUNA_CONCLUIDO;
    const alvo = paraConcluido ? null : etapas.find((e) => e.nome === destino);
    if (!paraConcluido && !alvo) throw new AppError('Este processo não tem essa etapa.', 400);

    for (const etapa of etapas) {
      let novoStatus;
      if (paraConcluido || etapa.ordem < alvo.ordem) novoStatus = 'concluido';
      else if (etapa.id === alvo.id) novoStatus = etapa.status === 'exigencia' ? 'exigencia' : 'em_andamento';
      else novoStatus = 'pendente';
      if (novoStatus !== etapa.status) {
        await EtapaProcesso.atualizar(etapa.id, { status: novoStatus, responsavelId: etapa.responsavel_id, observacoes: etapa.observacoes });
      }
    }

    // Status do processo acompanha: concluído, ou reaberto se saiu de "Concluído"
    let novoStatusProcesso = null;
    if (paraConcluido && processo.status !== 'concluido') novoStatusProcesso = 'concluido';
    if (!paraConcluido && processo.status === 'concluido') novoStatusProcesso = 'em_andamento';
    if (novoStatusProcesso) {
      await ProcessoLegalizacao.atualizar(processo.id, {
        status: novoStatusProcesso,
        comentario_status: paraConcluido ? 'Concluído pelo quadro da Legalização.' : `Reaberto pelo quadro (voltou para ${destino}).`
      }, req.usuario.id);
      const empresa = await Empresa.buscarPorId(processo.empresa_id);
      notificarMudancaStatus({ empresa, processo, statusAnterior: processo.status, statusNovo: novoStatusProcesso })
        .catch((err) => console.error('Falha ao notificar mudança de status:', err));
    }

    LogAuditoria.registrar({
      usuarioId: req.usuario.id, acao: 'UPDATE', entidade: 'processo_legalizacao', entidadeId: processo.id,
      detalhes: { acao_especifica: 'pipeline_mover', para: paraConcluido ? 'Concluído' : destino }
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

// ---------------- Checklist de documentos ----------------

async function processoOuFalhar(id) {
  const { rows: [processo] } = await query('SELECT id, tipo, empresa_id FROM processos_legalizacao WHERE id = $1', [id]);
  if (!processo) throw new AppError('Processo não encontrado.', 404);
  return processo;
}

async function itemDoProcessoOuFalhar(processoId, itemId) {
  const item = await ChecklistProcesso.buscarPorId(itemId);
  if (!item || item.processo_id !== processoId) throw new AppError('Item do checklist não encontrado.', 404);
  return item;
}

async function listarChecklist(req, res, next) {
  try {
    await processoOuFalhar(req.params.id);
    res.json(await ChecklistProcesso.listar(req.params.id));
  } catch (err) {
    next(err);
  }
}

async function adicionarItem(req, res, next) {
  try {
    await processoOuFalhar(req.params.id);
    const nome = String(req.body.nome || '').trim().slice(0, 150);
    if (!nome) throw new AppError('Informe o nome do documento.', 400);
    const item = await ChecklistProcesso.adicionar(req.params.id, {
      nome,
      etapaNome: req.body.etapa_nome ? String(req.body.etapa_nome).slice(0, 100) : null,
      obrigatorio: req.body.obrigatorio !== false
    });
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
}

async function atualizarItem(req, res, next) {
  try {
    await processoOuFalhar(req.params.id);
    await itemDoProcessoOuFalhar(req.params.id, req.params.itemId);

    const { recebido, documento_id } = req.body;
    if (recebido !== undefined && typeof recebido !== 'boolean') throw new AppError('recebido deve ser true ou false.', 400);
    if (documento_id) {
      const doc = await Documento.buscarPorId(documento_id);
      if (!doc || doc.processo_id !== req.params.id) throw new AppError('Documento não pertence a este processo.', 400);
    }

    const item = await ChecklistProcesso.atualizar(req.params.itemId, {
      recebido: documento_id && recebido === undefined ? true : recebido,
      documentoId: documento_id, usuarioId: req.usuario.id
    });
    LogAuditoria.registrar({
      usuarioId: req.usuario.id, acao: 'UPDATE', entidade: 'processo_legalizacao', entidadeId: req.params.id,
      detalhes: { acao_especifica: 'checklist_documento', documento: item.nome, recebido: item.recebido }
    });
    res.json(item);
  } catch (err) {
    next(err);
  }
}

async function removerItem(req, res, next) {
  try {
    await processoOuFalhar(req.params.id);
    await itemDoProcessoOuFalhar(req.params.id, req.params.itemId);
    await ChecklistProcesso.remover(req.params.itemId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

module.exports = { pipeline, mover, listarChecklist, adicionarItem, atualizarItem, removerItem, COLUNA_CONCLUIDO };
