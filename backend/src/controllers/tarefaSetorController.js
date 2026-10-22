const TarefaSetor = require('../models/TarefaSetor');
const Empresa = require('../models/Empresa');
const HistoricoComunicacao = require('../models/HistoricoComunicacao');
const LogAuditoria = require('../models/LogAuditoria');
const ClientePortal = require('../models/ClientePortal');
const { Documento } = require('../models/Documento');
const { enviarEmail, notificarCliente } = require('../services/notificacaoService');
const { rotuloTipo } = require('../config/solicitacoesCliente');
const { urlBaseSistema } = require('../utils/urlSistema');
const { montarEmail } = require('../services/emailLayout');
const { UPLOAD_DIR } = require('../middlewares/upload');
const path = require('path');
const fs = require('fs');
const { criarEventoCalendario } = require('../services/outlookService');
const Notificacao = require('../models/Notificacao');
const { SETORES, ehGestorDoSetor, podeVerSetor, ehColaboradorDoSetor, setoresVisiveis, linkPedidosCliente } = require('../config/setores');
const { AppError } = require('../middlewares/errorHandler');

const ROTULOS_SETOR = Object.fromEntries(Object.entries(SETORES).map(([chave, cfg]) => [chave, cfg.rotulo]));

/**
 * Acesso de LEITURA (listar/resumo): administrador vê tudo; gestor e
 * colaborador só veem o próprio setor (ex: colaborador_fiscal só acessa
 * /fiscal). Na Legalização, quem vê é o analista de legalização.
 */
function verificarAcessoLeitura(req, setor) {
  if (!podeVerSetor(req.usuario.role, setor)) {
    throw new AppError('Você não tem permissão para acessar as tarefas deste setor.', 403);
  }
}

/** Acesso de GESTÃO (criar/excluir tarefas): administrador ou gestor do setor. */
function verificarAcessoGestao(req, setor) {
  if (!ehGestorDoSetor(req.usuario.role, setor)) {
    throw new AppError('Você não tem permissão para gerenciar tarefas deste setor.', 403);
  }
}

function validarSetor(setor) {
  if (!TarefaSetor.SETORES_VALIDOS.includes(setor)) {
    throw new AppError(`Setor inválido. Use um de: ${TarefaSetor.SETORES_VALIDOS.join(', ')}`, 400);
  }
}

/** Colaborador só enxerga as próprias tarefas; os demais veem todas (ou só as suas, se pedirem). */
function filtroResponsavel(req, setor, somenteMinhas) {
  if (ehColaboradorDoSetor(req.usuario.role, setor) || somenteMinhas) return req.usuario.email;
  return undefined;
}

/**
 * Avisa o responsável de uma tarefa nova ou repassada: aviso no sininho
 * do sistema (sempre) e e-mail (quando configurado), registrado no
 * histórico de comunicação. Nunca lança erro.
 */
async function notificarResponsavelTarefa({ tarefa, empresa, motivo, autorId }) {
  if (!tarefa.responsavel_email) return;
  const setor = tarefa.setor;
  const assunto = motivo === 'repasse'
    ? `Tarefa repassada para você (${ROTULOS_SETOR[setor]}) — ${empresa.razao_social}`
    : `Nova tarefa (${ROTULOS_SETOR[setor]}) — ${empresa.razao_social}`;
  const introducao = motivo === 'repasse'
    ? `Uma tarefa do setor de ${ROTULOS_SETOR[setor]} foi repassada para você`
    : `Uma nova tarefa do setor de ${ROTULOS_SETOR[setor]} foi cadastrada para você`;
  const prazoTexto = tarefa.prazo
    ? `

Prazo: ${new Date(tarefa.prazo).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`
    : '';
  const mensagem =
    `Olá${tarefa.responsavel_nome ? ', ' + tarefa.responsavel_nome : ''}! ${introducao} ` +
    `— empresa ${empresa.razao_social} (CNPJ ${empresa.cnpj}):

${tarefa.descricao}${prazoTexto}`;

  Notificacao.avisar({
    emails: [tarefa.responsavel_email], excetoUsuarioId: autorId,
    tipo: motivo === 'repasse' ? 'tarefa_repassada' : 'tarefa_nova',
    titulo: `${motivo === 'repasse' ? 'Tarefa repassada para você' : 'Nova tarefa para você'} — ${empresa.razao_social}`,
    mensagem: tarefa.descricao.slice(0, 300),
    link: SETORES[setor].pagina
  });

  let status = 'enviado';
  let erro = null;
  try {
    await enviarEmail({ destinatario: tarefa.responsavel_email, assunto, mensagem });
  } catch (err) {
    status = 'falhou';
    erro = err.message;
    console.error(`Falha ao notificar responsável pela tarefa de setor (${tarefa.responsavel_email}):`, err.message);
  }
  HistoricoComunicacao.registrar({
    empresaId: empresa.id, processoId: null, canal: 'email',
    destinatario: tarefa.responsavel_email, assunto, mensagem, status, erro
  }).catch((e) => console.error('Falha ao registrar histórico de comunicação:', e));
}

async function listar(req, res, next) {
  try {
    const { setor } = req.params;
    validarSetor(setor);
    verificarAcessoLeitura(req, setor);

    const { empresa_id, status, pagina, limite, minhas, atrasadas, pedidos_cliente } = req.query;
    if (status && !TarefaSetor.STATUS_VALIDOS.includes(status)) {
      throw new AppError(`Status inválido. Use um de: ${TarefaSetor.STATUS_VALIDOS.join(', ')}`, 400);
    }

    const resultado = await TarefaSetor.listar({
      setor, empresaId: empresa_id, status,
      responsavelEmail: filtroResponsavel(req, setor, minhas === '1'),
      somenteAtrasadas: atrasadas === '1',
      somentePedidosCliente: pedidos_cliente === '1',
      pagina: pagina ? Number(pagina) : 1,
      limite: limite ? Math.min(Number(limite), 5000) : 20
    });
    res.json(resultado);
  } catch (err) {
    next(err);
  }
}

async function resumo(req, res, next) {
  try {
    const { setor } = req.params;
    validarSetor(setor);
    verificarAcessoLeitura(req, setor);

    const contadores = await TarefaSetor.resumoPorSetor(setor, filtroResponsavel(req, setor, req.query.minhas === '1'));
    const resultado = TarefaSetor.STATUS_VALIDOS.reduce((acc, s) => { acc[s] = 0; return acc; }, {});
    contadores.forEach((c) => {
      if (c.status === 'atrasadas') resultado.atrasadas = c.total;
      else resultado[c.status] = c.total;
    });
    resultado.atrasadas = resultado.atrasadas || 0;
    res.json(resultado);
  } catch (err) {
    next(err);
  }
}

/**
 * Pedidos de clientes ainda sem resposta, por setor — só dos setores que
 * o usuário pode ver (quadro do Dashboard).
 */
async function resumoPedidosCliente(req, res, next) {
  try {
    const setores = setoresVisiveis(req.usuario.role);
    const porSetor = await TarefaSetor.contarPedidosClienteAbertos(setores);
    res.json(setores.map((setor) => ({
      setor, rotulo: SETORES[setor].rotulo, pagina: linkPedidosCliente(setor), abertos: porSetor[setor] || 0
    })));
  } catch (err) {
    next(err);
  }
}

async function criar(req, res, next) {
  try {
    const { setor } = req.params;
    validarSetor(setor);
    verificarAcessoGestao(req, setor);

    const { empresa_id, descricao, responsavel_nome, responsavel_email, prazo } = req.body;
    if (!empresa_id || !descricao || !responsavel_email) {
      throw new AppError('empresa_id, descricao e responsavel_email são obrigatórios.', 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(responsavel_email)) {
      throw new AppError('E-mail do responsável inválido.', 400);
    }
    let prazoData = null;
    if (prazo) {
      prazoData = new Date(prazo);
      if (isNaN(prazoData.getTime())) {
        throw new AppError('Prazo inválido. Envie uma data/hora ISO (ex: 2026-09-20T14:00:00).', 400);
      }
    }

    const empresa = await Empresa.buscarPorId(empresa_id);
    if (!empresa) throw new AppError('Empresa não encontrada.', 404);

    const tarefa = await TarefaSetor.criar({
      empresa_id, setor, descricao, responsavel_nome, responsavel_email, prazo: prazoData,
      criado_por: req.usuario.id
    });

    LogAuditoria.registrar({
      usuarioId: req.usuario.id, acao: 'CREATE', entidade: 'tarefa_setor', entidadeId: tarefa.id,
      detalhes: { setor, empresa_id, responsavel_email }
    });

    // Notifica o responsável por e-mail em segundo plano (real se o envio
    // estiver configurado no .env, senão fica só no console/log).
    notificarResponsavelTarefa({ tarefa, empresa, motivo: 'nova', autorId: req.usuario.id });

    // Cria o evento no Outlook do responsável, se um prazo foi informado.
    // Roda em paralelo ao e-mail, sem bloquear a resposta da API —
    // se o Graph falhar (credenciais erradas, permissão pendente, etc.),
    // a tarefa já foi salva normalmente; só o evento de calendário que fica de fora.
    if (prazoData) {
      criarEventoCalendario({
        emailResponsavel: responsavel_email,
        titulo: `Tarefa (${ROTULOS_SETOR[setor]}) — ${empresa.razao_social}`,
        descricao: descricao,
        inicio: prazoData
      }).catch((e) => console.error('Falha ao criar evento no Outlook:', e));
    }

    res.status(201).json(tarefa);
  } catch (err) {
    next(err);
  }
}

async function atualizar(req, res, next) {
  try {
    const { setor, id } = req.params;
    validarSetor(setor);

    const existente = await TarefaSetor.buscarPorId(id);
    if (!existente || existente.setor !== setor) throw new AppError('Tarefa não encontrada.', 404);

    const ehGestor = ehGestorDoSetor(req.usuario.role, setor);
    const ehResponsavelPelaPropriaTarefa =
      ehColaboradorDoSetor(req.usuario.role, setor) &&
      existente.responsavel_email &&
      existente.responsavel_email.toLowerCase() === req.usuario.email.toLowerCase();

    if (!ehGestor && !ehResponsavelPelaPropriaTarefa) {
      throw new AppError('Você não tem permissão para editar esta tarefa.', 403);
    }

    if (req.body.status && !TarefaSetor.STATUS_VALIDOS.includes(req.body.status)) {
      throw new AppError(`Status inválido. Use um de: ${TarefaSetor.STATUS_VALIDOS.join(', ')}`, 400);
    }
    if (req.body.prazo) {
      const prazoData = new Date(req.body.prazo);
      if (isNaN(prazoData.getTime())) {
        throw new AppError('Prazo inválido. Envie uma data/hora ISO (ex: 2026-09-20T14:00:00).', 400);
      }
      req.body.prazo = prazoData;
    }

    // Colaborador só pode marcar o status da própria tarefa — nunca
    // reatribuir o responsável ou reescrever a descrição.
    const dadosPermitidos = ehGestor
      ? req.body
      : { status: req.body.status };

    if (dadosPermitidos.responsavel_email !== undefined && dadosPermitidos.responsavel_email !== null) {
      dadosPermitidos.responsavel_email = String(dadosPermitidos.responsavel_email).trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dadosPermitidos.responsavel_email)) {
        throw new AppError('E-mail do responsável inválido.', 400);
      }
    }

    const tarefa = await TarefaSetor.atualizar(id, dadosPermitidos);

    const responsavelMudou =
      tarefa.responsavel_email &&
      tarefa.responsavel_email.toLowerCase() !== (existente.responsavel_email || '').toLowerCase();

    LogAuditoria.registrar({
      usuarioId: req.usuario.id, acao: 'UPDATE', entidade: 'tarefa_setor', entidadeId: id,
      detalhes: responsavelMudou
        ? { responsavel_anterior: existente.responsavel_email, responsavel_novo: tarefa.responsavel_email }
        : undefined
    });

    // Tarefa repassada para outra pessoa: o novo responsável precisa saber.
    if (responsavelMudou) {
      notificarResponsavelTarefa({
        tarefa, empresa: { id: existente.empresa_id, razao_social: existente.razao_social, cnpj: existente.cnpj },
        motivo: 'repasse', autorId: req.usuario.id
      });
    }

    res.json(tarefa);
  } catch (err) {
    next(err);
  }
}

/**
 * Conclui um pedido feito pelo cliente na Área do Cliente: guarda a
 * resposta, anexa a guia/arquivo (que fica visível para o cliente) e
 * avisa o cliente por e-mail e WhatsApp.
 */
async function concluirPedidoCliente(req, res, next) {
  try {
    const { setor, id } = req.params;
    validarSetor(setor);

    const existente = await TarefaSetor.buscarPorId(id);
    if (!existente || existente.setor !== setor) throw new AppError('Tarefa não encontrada.', 404);
    if (!existente.solicitado_por_cliente) throw new AppError('Esta tarefa não é um pedido do cliente.', 400);

    const ehGestor = ehGestorDoSetor(req.usuario.role, setor);
    const ehResponsavel = ehColaboradorDoSetor(req.usuario.role, setor) && existente.responsavel_email &&
      existente.responsavel_email.toLowerCase() === req.usuario.email.toLowerCase();
    if (!ehGestor && !ehResponsavel) {
      throw new AppError('Você não tem permissão para concluir este pedido.', 403);
    }

    const resposta = String(req.body.resposta || '').trim().slice(0, 2000);
    if (!req.file && !resposta) {
      throw new AppError('Anexe a guia/arquivo ou escreva uma resposta para o cliente.', 400);
    }

    let documento = null;
    if (req.file) {
      documento = await Documento.criar({
        empresa_id: existente.empresa_id,
        nome_original: req.file.originalname,
        nome_armazenado: req.file.filename,
        caminho: path.join('uploads', req.file.filename),
        tipo_mime: req.file.mimetype,
        tamanho_bytes: req.file.size,
        categoria: 'guia',
        descricao: `${rotuloTipo(existente.tipo_solicitacao)}${existente.competencia ? ` — ${existente.competencia.slice(5, 7)}/${existente.competencia.slice(0, 4)}` : ''}`.slice(0, 255),
        enviado_por: req.usuario.id,
        visivel_cliente: true
      });
    }

    const tarefa = await TarefaSetor.concluirPedidoCliente(id, { resposta, documentoId: documento && documento.id });

    LogAuditoria.registrar({
      usuarioId: req.usuario.id, acao: 'UPDATE', entidade: 'tarefa_setor', entidadeId: id,
      detalhes: { acao_especifica: 'pedido_cliente_concluido', documento_id: documento && documento.id }
    });

    const cliente = await ClientePortal.buscarPorId(existente.solicitado_por_cliente);
    let envio = null;
    if (cliente && cliente.ativo) {
      const competenciaTexto = existente.competencia
        ? ` (competência ${existente.competencia.slice(5, 7)}/${existente.competencia.slice(0, 4)})` : '';
      const mensagem = `Olá${cliente.nome ? ', ' + cliente.nome : ''}! Seu pedido "${rotuloTipo(existente.tipo_solicitacao)}"` +
        `${competenciaTexto} da empresa ${existente.razao_social} foi concluído.` +
        (resposta ? `\n\nMensagem do escritório: ${resposta}` : '') +
        (documento ? `\n\nO arquivo "${documento.nome_original}" já está disponível na sua Área do Cliente.` : '') +
        `\n\nAcesse: ${urlBaseSistema()}/pages/cliente-login.html#pedidos`;
      // O arquivo vai anexado no e-mail — menos o certificado digital, que só se baixa pelo portal
      const anexar = documento && !/\.(pfx|p12)$/i.test(documento.nome_original);
      const urlPedidos = `${urlBaseSistema()}/pages/cliente-login.html#pedidos`;
      envio = await notificarCliente({
        cliente, empresaId: existente.empresa_id, enviadoPor: req.usuario.id,
        assunto: `Pedido concluído — ${existente.razao_social}`,
        mensagem,
        anexos: anexar ? [{ nome: documento.nome_original, caminho: path.join(UPLOAD_DIR, documento.nome_armazenado), tipo: documento.tipo_mime }] : [],
        rastreio: {
          tipo: 'pedido',
          documentos: documento ? [documento] : [],
          montar: ({ pixel, linkDocumento }) => montarEmail({
            chamada: 'Pedido concluído',
            titulo: 'Seu pedido está pronto',
            resumo: `${rotuloTipo(existente.tipo_solicitacao)}${competenciaTexto} — ${existente.razao_social}`,
            itens: documento ? [{ etiqueta: rotuloTipo(existente.tipo_solicitacao), rotulo: documento.nome_original }] : [],
            avisoAnexo: anexar ? 'O arquivo também está em anexo neste e-mail.' : null,
            saudacao: `Olá${cliente.nome ? ', ' + cliente.nome : ''}!`,
            paragrafos: [
              `O pedido "${rotuloTipo(existente.tipo_solicitacao)}"${competenciaTexto} da empresa ${existente.razao_social} foi concluído pela nossa equipe.`,
              ...(resposta ? [`Mensagem do escritório:\n${resposta}`] : []),
              ...(documento && !anexar ? [`O arquivo já está disponível na sua Área do Cliente.`] : [])
            ],
            botao: anexar ? { texto: 'Baixar o arquivo', url: linkDocumento(documento.id) } : { texto: 'Ver na Área do Cliente', url: urlPedidos },
            linkSecundario: anexar ? { texto: 'ou veja na Área do Cliente', url: urlPedidos } : null,
            observacao: 'O pedido e o arquivo ficam guardados na sua Área do Cliente.',
            pixel
          })
        }
      });
    }

    res.json({ tarefa, documento, envio });
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    next(err);
  }
}

async function remover(req, res, next) {
  try {
    const { setor, id } = req.params;
    validarSetor(setor);
    verificarAcessoGestao(req, setor);

    const existente = await TarefaSetor.buscarPorId(id);
    if (!existente || existente.setor !== setor) throw new AppError('Tarefa não encontrada.', 404);

    await TarefaSetor.remover(id);

    LogAuditoria.registrar({
      usuarioId: req.usuario.id, acao: 'DELETE', entidade: 'tarefa_setor', entidadeId: id
    });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

module.exports = { listar, resumo, resumoPedidosCliente, criar, atualizar, concluirPedidoCliente, remover, notificarResponsavelTarefa };
