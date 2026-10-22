const { query } = require('../config/db');
const Notificacao = require('../models/Notificacao');
const LogAuditoria = require('../models/LogAuditoria');
const { enviarEmail } = require('../services/notificacaoService');
const { AppError } = require('../middlewares/errorHandler');

/**
 * Formulário "Agende o seu diagnóstico" da página Sobre.
 *   POST  /api/contatos-site          → público (sem login), limitado por IP
 *   GET   /api/contatos-site          → administrador: lista
 *   PATCH /api/contatos-site/:id      → administrador: { status, observacao }
 *
 * Quem preenche recebe só "obrigado"; o escritório recebe um aviso no sininho
 * (administradores) e um e-mail interno (CONTATO_SITE_EMAIL ou ADMIN_EMAIL).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const STATUS = ['novo', 'em_contato', 'cliente', 'descartado'];
const LIMITE_DIA = 100; // mais que isso num dia é robô — para de gravar

const texto = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

async function criar(req, res, next) {
  try {
    // Campo-armadilha escondido no formulário: pessoa não vê, robô preenche
    if (req.body.site) return res.status(201).json({ ok: true });

    const nome = texto(req.body.nome, 120);
    const email = texto(req.body.email, 160).toLowerCase();
    const whatsapp = texto(req.body.whatsapp, 30).replace(/[^\d()+\- ]/g, '');
    const faturamento = texto(req.body.faturamento, 60) || null;
    const objetivo = texto(req.body.objetivo, 80) || null;
    if (nome.length < 2) throw new AppError('Informe o seu nome.', 400);
    if (!EMAIL.test(email)) throw new AppError('Informe um e-mail válido.', 400);

    const { rows: [hoje] } = await query(`SELECT COUNT(*)::int AS n FROM contatos_site WHERE criado_em >= CURRENT_DATE`);
    if (hoje.n >= LIMITE_DIA) throw new AppError('Recebemos muitos pedidos hoje. Fale com a gente pelo WhatsApp ou telefone.', 429);

    const { rows: [c] } = await query(
      `INSERT INTO contatos_site (nome, email, whatsapp, faturamento, objetivo, ip) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [nome, email, whatsapp || null, faturamento, objetivo, req.ip ? String(req.ip).slice(0, 64) : null]
    );

    await Notificacao.avisar({
      papeis: ['administrador'], tipo: 'contato_site', titulo: 'Novo pedido de diagnóstico pelo site',
      mensagem: `${nome}${objetivo ? ` — ${objetivo}` : ''}`, link: '/pages/contatos-site.html'
    });
    const para = process.env.CONTATO_SITE_EMAIL || process.env.ADMIN_EMAIL;
    if (para) {
      enviarEmail({
        destinatario: para,
        assunto: `Pedido de diagnóstico pelo site: ${nome}`,
        mensagem: [
          'Chegou um pedido de diagnóstico pelo formulário do site.',
          `Nome: ${nome}\nE-mail: ${email}${whatsapp ? `\nWhatsApp: ${whatsapp}` : ''}${faturamento ? `\nFaturamento: ${faturamento}` : ''}${objetivo ? `\nPrecisa de: ${objetivo}` : ''}`,
          'A lista completa fica no sistema, em Contatos do site.'
        ].join('\n\n'),
        responderPara: email
      }).catch((err) => console.error('[contatos-site] e-mail interno falhou:', err.message));
    }
    res.status(201).json({ ok: true, id: c.id });
  } catch (err) {
    next(err);
  }
}

async function listar(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT c.id, c.nome, c.email, c.whatsapp, c.faturamento, c.objetivo, c.status, c.observacao, c.criado_em, c.atualizado_em, u.nome AS atualizado_por_nome
         FROM contatos_site c LEFT JOIN usuarios u ON u.id = c.atualizado_por
        ORDER BY c.criado_em DESC LIMIT 500`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

async function atualizar(req, res, next) {
  try {
    if (!UUID.test(req.params.id)) throw new AppError('Contato não encontrado.', 404);
    const { status } = req.body;
    if (status !== undefined && !STATUS.includes(status)) throw new AppError('Situação inválida.', 400);
    const observacao = req.body.observacao === undefined ? undefined : texto(req.body.observacao, 1000);
    const { rows: [c] } = await query(
      `UPDATE contatos_site SET status = COALESCE($2, status), observacao = COALESCE($3, observacao), atualizado_por = $4, atualizado_em = NOW()
        WHERE id = $1 RETURNING id, status, observacao`,
      [req.params.id, status || null, observacao === undefined ? null : observacao, req.usuario.id]
    );
    if (!c) throw new AppError('Contato não encontrado.', 404);
    LogAuditoria.registrar({ usuarioId: req.usuario.id, acao: 'atualizou contato do site', entidade: 'contatos_site', entidadeId: c.id, detalhes: { status: c.status } });
    res.json(c);
  } catch (err) {
    next(err);
  }
}

module.exports = { criar, listar, atualizar };
