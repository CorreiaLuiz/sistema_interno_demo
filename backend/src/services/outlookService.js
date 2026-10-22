/**
 * Integração com o Outlook (Microsoft Graph API).
 *
 * Cria um evento de verdade no calendário do responsável quando uma
 * tarefa de setor é cadastrada com prazo definido. Usa o fluxo
 * "client credentials" (permissão de aplicativo, não delegada): o
 * sistema age em nome da organização, sem precisar que cada usuário
 * faça login com a Microsoft — só precisa das credenciais do app
 * registrado no Azure (ver README/instruções de configuração).
 *
 * Igual ao padrão do notificacaoService.js: se as credenciais não
 * estiverem no .env, a função vira um stub (loga no console e não
 * quebra o fluxo de criação da tarefa) — nunca lança erro que
 * impediria a tarefa de ser salva.
 *
 * Variáveis de ambiente necessárias (ver .env.example):
 *   AZURE_TENANT_ID
 *   AZURE_CLIENT_ID
 *   AZURE_CLIENT_SECRET
 *
 * Pré-requisito no Azure: permissão de aplicativo (não delegada)
 * "Calendars.ReadWrite" no Microsoft Graph, com consentimento de
 * administrador concedido. Sem isso, a chamada retorna 403.
 */

const GRAPH_CONFIGURADO =
  !!process.env.AZURE_TENANT_ID &&
  !!process.env.AZURE_CLIENT_ID &&
  !!process.env.AZURE_CLIENT_SECRET;

let tokenCache = { valor: null, expiraEm: 0 };

/**
 * Obtém (e reaproveita, enquanto válido) um token de acesso do
 * Microsoft Graph via client credentials grant.
 */
async function obterTokenAcesso() {
  const agora = Date.now();
  if (tokenCache.valor && agora < tokenCache.expiraEm - 30_000) {
    return tokenCache.valor;
  }

  const { AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET } = process.env;
  const url = `https://login.microsoftonline.com/${AZURE_TENANT_ID}/oauth2/v2.0/token`;

  const corpo = new URLSearchParams({
    client_id: AZURE_CLIENT_ID,
    client_secret: AZURE_CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials'
  });

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: corpo
  });

  if (!resp.ok) {
    const detalhe = await resp.text().catch(() => '');
    throw new Error(`Falha ao autenticar no Microsoft Graph (${resp.status}): ${detalhe}`);
  }

  const dados = await resp.json();
  tokenCache = {
    valor: dados.access_token,
    expiraEm: agora + dados.expires_in * 1000
  };
  return tokenCache.valor;
}

/**
 * Cria um evento no calendário do usuário informado (por e-mail).
 *
 * @param {Object} params
 * @param {string} params.emailResponsavel - e-mail da conta Microsoft 365 do destinatário
 * @param {string} params.titulo
 * @param {string} params.descricao
 * @param {Date}   params.inicio
 * @param {number} [params.duracaoMinutos=30]
 * @returns {Promise<{ status: 'criado'|'ignorado'|'falhou', erro?: string }>}
 */
async function criarEventoCalendario({ emailResponsavel, titulo, descricao, inicio, duracaoMinutos = 30 }) {
  if (!GRAPH_CONFIGURADO) {
    console.log(
      `[Outlook - SIMULADO] Evento "${titulo}" seria criado no calendário de ${emailResponsavel} ` +
      `em ${inicio.toISOString()}. Configure AZURE_TENANT_ID, AZURE_CLIENT_ID e AZURE_CLIENT_SECRET ` +
      `no .env para criar o evento de verdade.`
    );
    return { status: 'ignorado' };
  }

  try {
    const token = await obterTokenAcesso();
    const fim = new Date(inicio.getTime() + duracaoMinutos * 60_000);

    const evento = {
      subject: titulo,
      body: { contentType: 'Text', content: descricao || '' },
      start: { dateTime: inicio.toISOString(), timeZone: 'America/Sao_Paulo' },
      end: { dateTime: fim.toISOString(), timeZone: 'America/Sao_Paulo' },
      isReminderOn: true,
      reminderMinutesBeforeStart: 60
    };

    const resp = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(emailResponsavel)}/events`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(evento)
      }
    );

    if (!resp.ok) {
      const detalhe = await resp.text().catch(() => '');
      throw new Error(`Graph retornou ${resp.status}: ${detalhe}`);
    }

    return { status: 'criado' };
  } catch (err) {
    console.error('Falha ao criar evento no Outlook:', err.message);
    return { status: 'falhou', erro: err.message };
  }
}

/**
 * Envia um e-mail pela caixa `remetente` usando o Microsoft Graph.
 * Alternativa ao SMTP para contas Microsoft 365 em que o "SMTP AUTH"
 * (login com usuário e senha) está bloqueado — que é o padrão atual da
 * Microsoft. Requer a permissão de aplicativo "Mail.Send" no app do
 * Azure, com consentimento de administrador. Lança erro se falhar.
 */
async function enviarEmailGraph({ remetente, destinatarios, assunto, mensagem, html, responderPara, anexos = [] }) {
  if (!GRAPH_CONFIGURADO) {
    throw new Error('AZURE_TENANT_ID, AZURE_CLIENT_ID e AZURE_CLIENT_SECRET não estão configurados no .env.');
  }

  const token = await obterTokenAcesso();
  const resp = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(remetente)}/sendMail`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          subject: assunto,
          body: html ? { contentType: 'HTML', content: html } : { contentType: 'Text', content: mensagem || '' },
          toRecipients: destinatarios.map((address) => ({ emailAddress: { address } })),
          ...(responderPara ? { replyTo: [{ emailAddress: { address: responderPara } }] } : {}),
          // Anexos (ex: guias em PDF) — o Graph aceita até ~3 MB por anexo nesse formato
          ...(anexos.length ? {
            attachments: anexos.map((a) => ({
              '@odata.type': '#microsoft.graph.fileAttachment',
              name: a.nome,
              contentType: a.tipo || 'application/pdf',
              contentBytes: require('fs').readFileSync(a.caminho).toString('base64'),
              // Imagem do layout (logo) embutida no corpo, não como anexo
              ...(a.cid ? { isInline: true, contentId: a.cid } : {})
            }))
          } : {})
        },
        saveToSentItems: true
      })
    }
  );

  if (!resp.ok) {
    const detalhe = await resp.text().catch(() => '');
    throw new Error(`Graph recusou o envio do e-mail (${resp.status}): ${detalhe.slice(0, 300)}`);
  }
}

module.exports = { criarEventoCalendario, enviarEmailGraph, GRAPH_CONFIGURADO };
