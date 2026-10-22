const { query } = require('../config/db');
const LogAuditoria = require('../models/LogAuditoria');
const { AppError } = require('../middlewares/errorHandler');
const pt = require('../services/planejamento');
const { buscarEmpresas, mesAnterior } = require('../services/planejamento/extracao');

/**
 * Planejamento tributário (setores Contábil e Fiscal):
 *  GET  /analises                → última análise de cada empresa + números do topo
 *  GET  /dominio?q=              → busca empresa no Domínio (nome, CNPJ ou código)
 *  POST /analisar                → analisa agora { cnpj, fim? }
 *  GET  /analises/:id            → detalhe (resultado, respostas, histórico da empresa)
 *  GET  /analises/:id/pdf?versao= → PDF interno (rascunho) ou do cliente
 *  POST /analises/:id/aprovar    → gera o PDF do cliente           (gestores)
 *  POST /analises/:id/enviar     → manda ao cliente por e-mail/WhatsApp (gestores)
 *  GET  /contatos/:cnpj          → e-mail/WhatsApp sugeridos
 *  POST /questionarios           → cria o link do questionário e (opcional) envia
 *  POST /radar  /  GET /radar    → analisa a carteira do Simples em segundo plano
 * Públicas (sem login, link com token):
 *  GET  /publico/questionario/:token  ·  POST /publico/questionario/:token
 */

// Erros das regras do planejamento viram mensagem para a tela; os do
// PostgreSQL continuam escondidos pelo errorHandler.
const paraTela = (err) => (err.code && /^[0-9A-Z]{5}$/.test(err.code) ? err : new AppError(err.message, err.status || 400));

function idValido(valor) {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('Análise inválida.', 404);
  return id;
}

/** Resumo enxuto para a lista (o resultado completo só no detalhe). */
function resumo(a) {
  const r = a.resultado || {};
  const atual = (r.regimes_2026 || [])[0];
  return {
    id: a.id, cnpj: a.cnpj, nome: a.nome, codigo_dominio: a.codigo_dominio, periodo_fim: a.periodo_fim, origem: a.origem,
    status: a.status, erro: a.erro, gerado_em: a.gerado_em, aprovado_em: a.aprovado_em, enviado_em: a.enviado_em,
    receita: r.base_anual ? r.base_anual.rbt12 : null,
    regime_atual_total: a.regime_atual_total !== null ? Number(a.regime_atual_total) : null,
    carga_atual: atual ? atual.carga_sobre_receita : null,
    melhor_regime: a.melhor_regime, economia: a.economia !== null ? Number(a.economia) : null,
    // só com o questionário respondido (sem ele a conta usa premissas padrão)
    hibrido_compensa: r.reforma_2027 && a.respostas ? r.reforma_2027.credito_para_clientes.clientes_aproveitam &&
      (r.reforma_2027.credito_para_clientes.hibrido - r.reforma_2027.credito_para_clientes.puro) > r.reforma_2027.custo_extra_hibrido : null,
    alertas: r.alertas ? r.alertas.length : 0,
    com_respostas: Boolean(a.respostas),
    questionario: a.q_status || null
  };
}

async function listar(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT DISTINCT ON (a.cnpj) a.*,
              (SELECT CASE WHEN q.respondido_em IS NOT NULL THEN 'respondido'
                           WHEN q.expira_em < NOW() THEN 'expirado' ELSE 'aguardando' END
                 FROM pt_questionarios q WHERE q.cnpj = a.cnpj ORDER BY q.criado_em DESC LIMIT 1) AS q_status
         FROM pt_analises a
        ORDER BY a.cnpj, a.gerado_em DESC`
    );
    const analises = rows.map(resumo).sort((x, y) => (y.economia || 0) - (x.economia || 0));
    res.json({ analises, radar: pt.statusRadar(), mesPadrao: mesAnterior() });
  } catch (err) { next(err); }
}

async function buscarNoDominio(req, res, next) {
  try {
    res.json(await buscarEmpresas(req.query.q).catch((e) => { throw paraTela(e); }));
  } catch (err) { next(err); }
}

async function analisar(req, res, next) {
  try {
    const fim = req.body.fim && /^\d{4}-\d{2}$/.test(req.body.fim) ? req.body.fim : undefined;
    const a = await pt.analisar({ cnpj: req.body.cnpj, fim, origem: 'manual', usuarioId: req.usuario.id }).catch((e) => { throw paraTela(e); });
    LogAuditoria.registrar({ usuarioId: req.usuario.id, acao: 'fez análise de planejamento tributário', entidade: 'planejamento', detalhes: { analise: a.id, cnpj: a.cnpj, status: a.status } });
    res.status(201).json(resumo(a));
  } catch (err) { next(err); }
}

async function detalhar(req, res, next) {
  try {
    const a = await pt.buscarAnalise(idValido(req.params.id)).catch((e) => { throw paraTela(e); });
    const historico = (await query(
      `SELECT id, gerado_em, origem, status, melhor_regime, economia FROM pt_analises WHERE cnpj = $1 ORDER BY gerado_em DESC LIMIT 20`,
      [a.cnpj]
    )).rows;
    const questionarios = (await query(
      `SELECT q.id, q.criado_em, q.expira_em, q.respondido_em, q.envio, u.nome AS criado_por
         FROM pt_questionarios q LEFT JOIN usuarios u ON u.id = q.criado_por WHERE q.cnpj = $1 ORDER BY q.criado_em DESC LIMIT 10`,
      [a.cnpj]
    )).rows;
    res.json({ ...a, cnpj_formatado: pt.cnpjFormatado(a.cnpj), historico, questionarios });
  } catch (err) { next(err); }
}

async function baixarPdf(req, res, next) {
  try {
    const versao = req.query.versao === 'cliente' ? 'cliente' : 'interno';
    const { caminho, analise } = await pt.pdfDaAnalise(idValido(req.params.id), versao).catch((e) => { throw paraTela(e); });
    const nome = `Planejamento ${versao === 'cliente' ? '' : '(rascunho) '}- ${analise.nome || analise.cnpj}.pdf`.replace(/[\\/:*?"<>|]/g, '');
    res.download(caminho, nome);
  } catch (err) { next(err); }
}

async function aprovar(req, res, next) {
  try {
    const a = await pt.aprovar(idValido(req.params.id), req.usuario).catch((e) => { throw paraTela(e); });
    LogAuditoria.registrar({ usuarioId: req.usuario.id, acao: 'aprovou planejamento tributário', entidade: 'planejamento', detalhes: { analise: a.id, cnpj: a.cnpj } });
    res.json(resumo(a));
  } catch (err) { next(err); }
}

async function enviar(req, res, next) {
  try {
    const a = await pt.enviarAoCliente(idValido(req.params.id), { email: req.body.email, telefone: req.body.telefone }, req.usuario)
      .catch((e) => { throw paraTela(e); });
    LogAuditoria.registrar({ usuarioId: req.usuario.id, acao: 'enviou planejamento tributário ao cliente', entidade: 'planejamento', detalhes: { analise: a.id, cnpj: a.cnpj, envio: a.envio } });
    res.json({ ...resumo(a), envio: a.envio });
  } catch (err) { next(err); }
}

async function contatos(req, res, next) {
  try {
    res.json(await pt.contatosSugeridos(req.params.cnpj).catch((e) => { throw paraTela(e); }));
  } catch (err) { next(err); }
}

async function criarQuestionario(req, res, next) {
  try {
    const q = await pt.criarQuestionario({
      cnpj: req.body.cnpj, enviar: Boolean(req.body.enviar), usuario: req.usuario,
      contato: { email: req.body.email, telefone: req.body.telefone }
    }).catch((e) => { throw paraTela(e); });
    LogAuditoria.registrar({ usuarioId: req.usuario.id, acao: 'gerou questionário de planejamento tributário', entidade: 'planejamento', entidadeId: q.id, detalhes: { cnpj: q.cnpj, envio: q.canais } });
    res.status(201).json({ id: q.id, link: q.link, expira_em: q.expira_em, canais: q.canais });
  } catch (err) { next(err); }
}

async function iniciarRadar(req, res, next) {
  try {
    const fim = req.body.fim && /^\d{4}-\d{2}$/.test(req.body.fim) ? req.body.fim : undefined;
    const status = await pt.iniciarRadar({ usuarioId: req.usuario.id, fim }).catch((e) => { throw paraTela(e); });
    LogAuditoria.registrar({ usuarioId: req.usuario.id, acao: 'iniciou o radar de planejamento tributário', entidade: 'planejamento', detalhes: { total: status.total } });
    res.status(202).json(status);
  } catch (err) { next(err); }
}

function verRadar(req, res) {
  res.json(pt.statusRadar());
}

// ---------- Públicas (questionário pelo link) ----------
async function questionarioPublico(req, res, next) {
  try {
    const q = await pt.questionarioPublico(req.params.token).catch((e) => { throw paraTela(e); });
    res.json({ empresa: q.nome_empresa, cnpj: pt.cnpjFormatado(q.cnpj), respondido: Boolean(q.respondido_em) });
  } catch (err) { next(err); }
}

async function responderQuestionario(req, res, next) {
  try {
    res.json(await pt.responderQuestionario(req.params.token, req.body || {}).catch((e) => { throw paraTela(e); }));
  } catch (err) { next(err); }
}

module.exports = {
  listar, buscarNoDominio, analisar, detalhar, baixarPdf, aprovar, enviar, contatos, criarQuestionario,
  iniciarRadar, verRadar, questionarioPublico, responderQuestionario
};
