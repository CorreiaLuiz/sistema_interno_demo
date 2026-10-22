/**
 * Serviço de notificações multicanal (e-mail e WhatsApp).
 *
 * Sem configuração no .env, os envios ficam SIMULADOS (só aparecem no
 * console). Toda tentativa (real ou simulada) é registrada em
 * `historico_comunicacao`, com status 'enviado' ou 'falhou' e o erro.
 *
 *   E-MAIL — duas opções:
 *   - SMTP: preencha NOTIF_EMAIL_HOST/PORT/USER/PASS. No Microsoft 365
 *     a caixa precisa ter "SMTP autenticado" liberado pelo administrador.
 *   - Microsoft Graph (recomendado para Microsoft 365): NOTIF_EMAIL_VIA=graph
 *     + AZURE_TENANT_ID/CLIENT_ID/CLIENT_SECRET, com a permissão de
 *     aplicativo "Mail.Send". Envia pela caixa de NOTIF_EMAIL_FROM.
 *   Teste com: node src/utils/testarEmail.js seu-email@destino.com
 *
 *   WHATSAPP (já implementado — só falta configurar):
 *   - Este serviço já está integrado com o formato de "API (push)" de
 *     provedores de atendimento que expõem esse padrão de disparo (URL
 *     autenticada + JSON com number/body/externalKey). Para ativar,
 *     gere a URL autenticada no painel do provedor (normalmente em
 *     Configurações → API/Webhook → Adicionar) e coloque em
 *     NOTIF_WHATSAPP_API_URL no .env. Nenhum código precisa mudar.
 *   - Se você usar outro provedor com formato de requisição diferente
 *     (Z-API, Evolution API, WhatsApp Business Platform oficial da
 *     Meta), ajuste o corpo da função `enviarWhatsapp` abaixo — a
 *     estrutura de detecção automática (stub vs. real) continua igual.
 *
 * As credenciais (API keys, tokens de instância, etc.) devem ficar no
 * .env — nunca hardcoded aqui. Ver .env.example para os nomes sugeridos
 * (NOTIF_EMAIL_* e NOTIF_WHATSAPP_*).
 */

const HistoricoComunicacao = require('../models/HistoricoComunicacao');
const { montarEmail, emailSimples } = require('./emailLayout');

// Transporter reaproveitado entre chamadas (evita reconectar ao SMTP a
// cada e-mail enviado). Só é criado quando NOTIF_EMAIL_HOST existe.
let transporterEmail = null;

function obterTransporterEmail() {
  if (transporterEmail) return transporterEmail;

  const nodemailer = require('nodemailer');
  transporterEmail = nodemailer.createTransport({
    host: process.env.NOTIF_EMAIL_HOST,
    port: Number(process.env.NOTIF_EMAIL_PORT) || 587,
    // secure=true é exigido pela porta 465 (SSL direto); porta 587/25
    // usa STARTTLS e deve ficar com secure=false.
    secure: process.env.NOTIF_EMAIL_SECURE === 'true',
    auth: {
      user: process.env.NOTIF_EMAIL_USER,
      pass: process.env.NOTIF_EMAIL_PASS
    }
  });
  return transporterEmail;
}

/**
 * Qual caminho de envio usar:
 *   - "graph": Microsoft Graph (NOTIF_EMAIL_VIA=graph + AZURE_* no .env)
 *   - "smtp":  servidor SMTP (NOTIF_EMAIL_HOST no .env)
 *   - "simulado": nada configurado — só loga no console
 */
function modoEnvioEmail() {
  if (process.env.NOTIF_EMAIL_VIA === 'graph') return 'graph';
  if (process.env.NOTIF_EMAIL_HOST) return 'smtp';
  return 'simulado';
}

/** Deixa o erro de login do Office 365 com uma explicação do que fazer. */
function explicarErroSmtp(err) {
  if (/535 5\.7\.(3|139)/.test(err.message || '')) {
    err.message =
      'O Office 365 recusou o login SMTP da conta de envio (' + (process.env.NOTIF_EMAIL_USER || '?') + '). ' +
      'Causas comuns: "SMTP autenticado" desativado para a caixa no Microsoft 365, senha alterada, ' +
      'ou MFA ativo sem senha de aplicativo. Alternativa: usar NOTIF_EMAIL_VIA=graph. Detalhe: ' + err.message;
  }
  return err;
}

/**
 * Envia um e-mail sempre no layout do escritório (logo, cores, rodapé).
 * Quem já montou o HTML (montarEmail) passa `html`; senão o texto de
 * `mensagem` é colocado no layout automaticamente. O texto puro vai junto
 * para programas de e-mail que não mostram HTML.
 * `destinatario` pode ser um e-mail ou uma lista (todos vão no "Para",
 * como nos avisos gerais do escritório). `responderPara` define para quem
 * vão as respostas — útil para o aviso sair da caixa do sistema mas a
 * resposta chegar em quem fez a ação.
 */
async function enviarEmail({ destinatario, assunto, mensagem, html, responderPara, anexos = [] }) {
  const modo = modoEnvioEmail();
  const layout = html ? { html, anexosLayout: montarEmail({ titulo: assunto }).anexosLayout } : emailSimples(assunto, mensagem);
  const todosAnexos = [...layout.anexosLayout, ...anexos];
  const remetente = process.env.NOTIF_EMAIL_FROM || process.env.NOTIF_EMAIL_USER;
  const destinatarios = Array.isArray(destinatario) ? destinatario : [destinatario];

  if (modo === 'simulado') {
    console.log(`[stub e-mail] Para: ${destinatarios.join(', ')} | Assunto: ${assunto}${anexos.length ? ` | ${anexos.length} anexo(s)` : ''}`);
    return { sucesso: true, simulado: true };
  }

  if (modo === 'graph') {
    const { enviarEmailGraph } = require('./outlookService');
    await enviarEmailGraph({ remetente, destinatarios, assunto, html: layout.html, responderPara, anexos: todosAnexos });
  } else {
    try {
      await obterTransporterEmail().sendMail({
        from: { name: 'Privilege Contabilidade', address: remetente }, to: destinatarios, subject: assunto,
        text: mensagem, html: layout.html,
        ...(responderPara ? { replyTo: responderPara } : {}),
        attachments: todosAnexos.map((a) => ({ filename: a.nome, path: a.caminho, contentType: a.tipo, ...(a.cid ? { cid: a.cid } : {}) }))
      });
    } catch (err) {
      throw explicarErroSmtp(err);
    }
  }

  console.log(`[email] Enviado com sucesso para ${destinatarios.join(', ')} (via ${modo}).`);
  return { sucesso: true, simulado: false };
}

/**
 * Confirma se as credenciais de e-mail configuradas no .env conseguem
 * autenticar no servidor SMTP, sem enviar nenhum e-mail. Usado pelo
 * script backend/src/utils/testarEmail.js para testar a configuração
 * antes de usar de verdade.
 */
async function verificarConexaoEmail() {
  const modo = modoEnvioEmail();
  if (modo === 'simulado') {
    throw new Error('Nem NOTIF_EMAIL_HOST nem NOTIF_EMAIL_VIA=graph estão configurados no .env — o e-mail está em modo simulado.');
  }
  if (modo === 'graph') {
    // Não há como "testar" o Mail.Send sem enviar; aqui confere só se o
    // app do Azure consegue autenticar. Envie um e-mail de teste para validar tudo.
    const { GRAPH_CONFIGURADO } = require('./outlookService');
    if (!GRAPH_CONFIGURADO) throw new Error('NOTIF_EMAIL_VIA=graph, mas AZURE_TENANT_ID/CLIENT_ID/CLIENT_SECRET estão vazios.');
    return true;
  }
  try {
    await obterTransporterEmail().verify();
  } catch (err) {
    throw explicarErroSmtp(err);
  }
  return true;
}

/**
 * Formata um telefone brasileiro para o padrão exigido pela API de
 * WhatsApp (DDI + DDD + número, só dígitos, ex: "5598991199469").
 * Aceita o telefone em qualquer formato comum ("(11) 91234-5678", etc).
 */
function formatarNumeroWhatsapp(telefone) {
  const digitos = String(telefone || '').replace(/\D/g, '');
  if (!digitos) return null;
  // Se já não começar com o DDI do Brasil (55) e tiver DDD+número (10 ou 11 dígitos), adiciona
  if (!digitos.startsWith('55') && (digitos.length === 10 || digitos.length === 11)) {
    return `55${digitos}`;
  }
  return digitos;
}

async function enviarWhatsapp({ destinatario, mensagem }) {
  const numero = formatarNumeroWhatsapp(destinatario);
  if (!numero) throw new Error('Telefone da empresa inválido ou não cadastrado.');

  // --- INÍCIO DO STUB (ativa automaticamente quando NOTIF_WHATSAPP_API_URL é configurada) ---
  if (!process.env.NOTIF_WHATSAPP_API_URL) {
    console.log(`[stub whatsapp] Para: ${numero} | Mensagem: ${mensagem}`);
    return { sucesso: true, simulado: true };
  }

  // Integração real — formato de "API (push)" documentado pelo provedor
  // de atendimento (a URL já vem autenticada, gerada em
  // Configurações -> API/Webhook no painel do provedor).
  const resp = await fetch(process.env.NOTIF_WHATSAPP_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      number: numero,
      body: mensagem,
      externalKey: `sistema-legalizacao-${Date.now()}`
    })
  });

  if (!resp.ok) {
    const detalhe = await resp.text().catch(() => '');
    throw new Error(`Falha ao enviar WhatsApp (HTTP ${resp.status}): ${detalhe.slice(0, 200)}`);
  }
  // --- FIM DO STUB ---

  return { sucesso: true, simulado: false };
}

/**
 * Notifica a empresa sobre uma mudança de status em um processo de
 * legalização, por e-mail e/ou WhatsApp (conforme dados de contato
 * disponíveis), e registra tudo em historico_comunicacao.
 */
async function notificarMudancaStatus({ empresa, processo, statusAnterior, statusNovo }) {
  console.log(`[notificacao] Disparada para empresa "${empresa.razao_social}" | e-mail: ${empresa.email || '(vazio)'} | telefone: ${empresa.telefone || '(vazio)'}`);

  const rotulos = {
    em_andamento: 'Em andamento',
    exigencia: 'Em exigência',
    concluido: 'Concluído',
    cancelado: 'Cancelado'
  };

  const assunto = `Atualização do seu processo — ${empresa.razao_social}`;
  const mensagem =
    `Olá! O processo de ${processo.tipo} da empresa ${empresa.razao_social} ` +
    `mudou de status: ${rotulos[statusAnterior] || statusAnterior} → ${rotulos[statusNovo] || statusNovo}.`;

  const resultados = [];

  if (empresa.email) {
    let status = 'enviado';
    let erro = null;
    try {
      await enviarEmail({ destinatario: empresa.email, assunto, mensagem });
    } catch (err) {
      status = 'falhou';
      erro = err.message;
    }
    const registro = await HistoricoComunicacao.registrar({
      empresaId: empresa.id, processoId: processo.id, canal: 'email',
      destinatario: empresa.email, assunto, mensagem, status, erro
    });
    resultados.push(registro);
  }

  if (empresa.telefone) {
    let status = 'enviado';
    let erro = null;
    try {
      await enviarWhatsapp({ destinatario: empresa.telefone, mensagem });
      console.log(`[notificacao] WhatsApp enviado com sucesso para ${empresa.telefone}.`);
    } catch (err) {
      status = 'falhou';
      erro = err.message;
      console.error(`[notificacao] Falha ao enviar WhatsApp para ${empresa.telefone}:`, err.message);
    }
    const registro = await HistoricoComunicacao.registrar({
      empresaId: empresa.id, processoId: processo.id, canal: 'whatsapp',
      destinatario: empresa.telefone, assunto: null, mensagem, status, erro
    });
    resultados.push(registro);
  } else {
    console.log('[notificacao] Empresa sem telefone cadastrado — WhatsApp não enviado.');
  }

  return resultados;
}

/**
 * Notifica por e-mail o NOVO responsável de uma etapa, no momento em que
 * ela é designada para ele. O status gravado em `historico_comunicacao`
 * reflete o que realmente aconteceu ('enviado' ou 'falhou').
 */
async function notificarResponsavelEtapa({ etapa, empresa }) {
  if (!etapa.responsavel_email) {
    console.log('[notificacao] Etapa sem responsável com e-mail cadastrado — notificação não enviada.');
    return null;
  }

  const assunto = `Etapa designada para você — ${empresa.razao_social}`;
  const mensagem =
    `Olá, ${etapa.responsavel_nome}! Você foi definido como responsável pela etapa ` +
    `"${etapa.nome}" do processo de ${etapa.processo_tipo} da empresa ${empresa.razao_social}.`;

  let status = 'enviado';
  let erro = null;
  try {
    await enviarEmail({ destinatario: etapa.responsavel_email, assunto, mensagem });
  } catch (err) {
    status = 'falhou';
    erro = err.message;
    console.error(`[notificacao] Falha ao notificar responsável pela etapa (${etapa.responsavel_email}):`, err.message);
  }

  const registro = await HistoricoComunicacao.registrar({
    empresaId: empresa.id,
    processoId: etapa.processo_id,
    canal: 'email',
    destinatario: etapa.responsavel_email,
    assunto,
    mensagem,
    status,
    erro
  });

  return registro;
}

/**
 * Avisa um cliente da Área do Cliente pelos dois canais: e-mail (sempre)
 * e WhatsApp (se ele tiver telefone). Cada tentativa fica registrada em
 * historico_comunicacao. Nunca lança erro — devolve o que funcionou, para
 * a tela da equipe saber se precisa mandar o link de outro jeito.
 */
async function notificarCliente({ cliente, empresaId, assunto, mensagem, html, anexos = [], enviadoPor, rastreio }) {
  const resultado = { email: false, whatsapp: false };

  // Com `rastreio` ({ tipo, documentos, montar }) o e-mail vai com controle de
  // abertura/download (e o próprio rastreio grava o histórico de comunicação)
  const enviarEmailCliente = async () => {
    if (!rastreio) return enviarEmail({ destinatario: cliente.email, assunto, mensagem, html, anexos });
    const { enviarEmailRastreado } = require('./rastreioEmail');
    const r = await enviarEmailRastreado({ ...rastreio, empresaId, destinatario: cliente.email, assunto, anexos, enviadoPor });
    if (r.status === 'falhou') throw Object.assign(new Error(r.erro), { jaRegistrado: true });
    return { simulado: r.status === 'simulado', jaRegistrado: true };
  };

  const canais = [
    { canal: 'email', destino: cliente.email, enviar: enviarEmailCliente },
    { canal: 'whatsapp', destino: cliente.telefone, enviar: () => enviarWhatsapp({ destinatario: cliente.telefone, mensagem: `*${assunto}*\n\n${mensagem}` }) }
  ];

  for (const { canal, destino, enviar } of canais) {
    if (!destino) continue;
    let status = 'enviado';
    let erro = null;
    let jaRegistrado = false;
    try {
      const envio = await enviar();
      resultado[canal] = !envio.simulado;
      jaRegistrado = Boolean(envio.jaRegistrado);
    } catch (err) {
      status = 'falhou';
      erro = err.message;
      jaRegistrado = Boolean(err.jaRegistrado);
      console.error(`[notificacao] Falha ao avisar cliente por ${canal} (${destino}):`, err.message);
    }
    if (jaRegistrado) continue;
    await HistoricoComunicacao.registrar({
      empresaId, processoId: null, canal, destinatario: destino,
      assunto: canal === 'email' ? assunto : null, mensagem, status, erro, enviadoPor
    }).catch((e) => console.error('Falha ao registrar histórico de comunicação:', e.message));
  }

  return resultado;
}

module.exports = {
  enviarEmail, enviarWhatsapp, notificarMudancaStatus, formatarNumeroWhatsapp,
  notificarResponsavelEtapa, verificarConexaoEmail, notificarCliente
};
