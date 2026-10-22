/**
 * E-mails com controle: cada destinatário recebe o SEU e-mail, com um
 * código próprio. Com esse código o sistema sabe:
 *  - quando o e-mail foi aberto (imagem invisível de 1 pixel);
 *  - quando a guia foi baixada pelo botão "Baixar PDF" do e-mail.
 * Downloads pela Área do Cliente já ficam em downloads_portal (origem 'portal').
 *
 * Limites (explicar para quem for ler o relatório):
 *  - Só funciona com o sistema acessível pela internet (APP_URL público).
 *  - Abrir o ANEXO não avisa ninguém — só o botão do e-mail é contado.
 *  - "Aberto" é aproximado: o Outlook pode bloquear imagens (não conta a
 *    abertura) e alguns serviços (Apple Mail, Gmail) carregam a imagem sozinhos.
 */

const crypto = require('crypto');
const { query } = require('../config/db');
const HistoricoComunicacao = require('../models/HistoricoComunicacao');
const { enviarEmail } = require('./notificacaoService');
const { urlBaseSistema } = require('../utils/urlSistema');

const REGEX_TOKEN = /^[0-9a-f]{48}$/;

/** Links do e-mail para um código. */
function linksDoEmail(token) {
  const base = `${urlBaseSistema()}/api/rastreio/${token}`;
  return {
    pixel: `${base}/a.gif`,
    linkDocumento: (documentoId) => `${base}/d/${documentoId}`
  };
}

/**
 * Envia UM e-mail com controle.
 * `montar({ pixel, linkDocumento })` devolve { html, texto } já com os links.
 * Devolve { emailId, status: 'enviado'|'simulado'|'falhou', erro }.
 */
async function enviarEmailRastreado({ empresaId, destinatario, assunto, tipo = 'outro', documentos = [], montar, anexos = [], enviadoPor }) {
  const token = crypto.randomBytes(24).toString('hex');
  const { rows: [registro] } = await query(
    `INSERT INTO emails_enviados (token, empresa_id, destinatario, assunto, tipo, enviado_por)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [token, empresaId || null, String(destinatario).slice(0, 150), String(assunto || '').slice(0, 200), tipo, enviadoPor || null]
  );
  for (const doc of documentos) {
    await query('INSERT INTO emails_enviados_documentos (email_id, documento_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [registro.id, doc.id]);
  }

  const { html, texto } = montar(linksDoEmail(token));
  let status = 'enviado';
  let erro = null;
  try {
    const envio = await enviarEmail({ destinatario, assunto, mensagem: texto, html, anexos });
    if (envio && envio.simulado) status = 'simulado';
  } catch (err) {
    status = 'falhou';
    erro = err.message;
    console.error(`[e-mail] Falha ao enviar para ${destinatario}:`, err.message);
  }
  await query('UPDATE emails_enviados SET status = $2, erro = $3 WHERE id = $1', [registro.id, status, erro]);

  if (empresaId) {
    await HistoricoComunicacao.registrar({
      empresaId, canal: 'email', destinatario, assunto, mensagem: texto,
      status: status === 'falhou' ? 'falhou' : 'enviado', erro, enviadoPor
    }).catch((e) => console.error('Falha ao registrar histórico de comunicação:', e.message));
  }
  return { emailId: registro.id, status, erro };
}

/**
 * Manda para vários destinatários (um e-mail para cada) e resume o
 * resultado: 'enviado' se chegou em pelo menos um, 'simulado' se o e-mail
 * está desligado, 'falhou' se nenhum saiu.
 */
async function enviarParaTodos({ destinatarios, pausaMs = 0, ...dados }) {
  const resultados = [];
  for (const destinatario of destinatarios) {
    resultados.push(await enviarEmailRastreado({ ...dados, destinatario }));
    if (pausaMs) await new Promise((r) => setTimeout(r, pausaMs));
  }
  if (resultados.some((r) => r.status === 'enviado')) return 'enviado';
  if (resultados.some((r) => r.status === 'simulado')) return 'simulado';
  return 'falhou';
}

module.exports = { enviarEmailRastreado, enviarParaTodos, REGEX_TOKEN };
