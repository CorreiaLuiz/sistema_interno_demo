const fs = require('fs');
const path = require('path');
const { query } = require('../config/db');
const { Documento } = require('../models/Documento');
const { REGEX_TOKEN } = require('../services/rastreioEmail');
const { urlBaseSistema } = require('../utils/urlSistema');
const { ESCRITORIO } = require('../services/emailLayout');
const { UPLOAD_DIR } = require('../middlewares/upload');

/**
 * Controle dos e-mails enviados aos clientes.
 *
 * Rotas públicas (usadas pelo próprio e-mail, sem login):
 *   GET /api/rastreio/:token/a.gif               → registra a abertura
 *   GET /api/rastreio/:token/d/:documentoId      → página "baixando sua guia…"
 *   GET /api/rastreio/:token/d/:documentoId/arquivo → registra e entrega o PDF
 * A página intermediária existe porque antivírus de e-mail (ex: Outlook
 * "Links Seguros") visitam os links sozinhos — sem ela, todo e-mail
 * pareceria "baixado". Esses robôs não executam o redirecionamento da página.
 *
 * Rota da equipe: GET /api/emails-enviados (lista + resumo).
 */

const GIF_1PX = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALIDADE_LINK_DIAS = 180;

async function registrarAbertura(emailId) {
  await query(
    `UPDATE emails_enviados SET aberturas = aberturas + 1,
            aberto_em = COALESCE(aberto_em, NOW()), ultima_abertura_em = NOW()
     WHERE id = $1`,
    [emailId]
  );
}

async function abertura(req, res) {
  try {
    if (REGEX_TOKEN.test(req.params.token)) {
      const { rows: [email] } = await query('SELECT id FROM emails_enviados WHERE token = $1', [req.params.token]);
      if (email) await registrarAbertura(email.id);
    }
  } catch (err) {
    console.error('[rastreio] Falha ao registrar abertura:', err.message);
  }
  // Sempre devolve a imagem — o e-mail nunca pode "quebrar"
  res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, no-cache, must-revalidate, private', Pragma: 'no-cache' });
  res.end(GIF_1PX);
}

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function tamanhoLegivel(bytes) {
  if (!bytes) return '';
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

const ICONES = {
  baixar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>',
  ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
  alerta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v6"/><path d="M12 16.5v.5"/></svg>',
  relogio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  whats: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.4.8 3.2.7a2.8 2.8 0 0 0 1.8-1.3 2.3 2.3 0 0 0 .2-1.3c-.1-.1-.2-.2-.5-.3z"/></svg>'
};

/**
 * Página pública (aberta pelo cliente a partir do e-mail) no visual do escritório.
 * tipo: 'baixar' (download começando), 'alerta' (erro) ou 'relogio' (expirado).
 */
function paginaPublica(res, { status = 200, tipo = 'alerta', titulo, texto, arquivo, urlArquivo }) {
  const portal = `${urlBaseSistema()}/pages/cliente-login.html`;
  const baixando = tipo === 'baixar';
  const cartaoArquivo = arquivo ? `
      <div class="arquivo">
        <div class="pdf">PDF</div>
        <div class="arquivo-info">
          <strong>${esc(arquivo.titulo)}</strong>
          <span>${[arquivo.empresa, arquivo.nome, arquivo.tamanho].filter(Boolean).map(esc).join(' · ')}</span>
        </div>
      </div>` : '';

  res.status(status).type('html').send(`<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">
<title>${esc(titulo)} — Privilege Contabilidade</title>
<link rel="icon" type="image/png" href="/assets/favicon.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Montserrat:wght@600;700&display=swap" rel="stylesheet">
<style>
  :root { --bordo:#660000; --bordo-escuro:#430A0D; --quase-preto:#180608; --dourado:#C99B59; --dourado-claro:#E9D3AE;
          --creme:#F7F1E7; --texto:#2B1A1B; --suave:#6E5E5F; --borda:#EADFD0; --verde:#0E9D66; --ambar:#B4740A; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; background:#F4EFE8; color:var(--texto); font-family:'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
         -webkit-font-smoothing:antialiased; display:flex; flex-direction:column; }
  .faixa { background:linear-gradient(135deg, var(--bordo) 0%, var(--bordo-escuro) 60%, var(--quase-preto) 100%); height:260px; position:relative; overflow:hidden; }
  .faixa::after { content:''; position:absolute; inset:0; background:repeating-linear-gradient(0deg, transparent 0 31px, rgba(233,211,174,0.07) 31px 32px); }
  .marca { position:relative; z-index:1; display:flex; align-items:center; gap:12px; max-width:520px; margin:0 auto; padding:28px 20px 0; }
  .marca .selo { width:44px; height:44px; border-radius:50%; background:#fff; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
  .marca .selo img { width:34px; height:auto; }
  .marca b { display:block; color:#fff; font-family:'Montserrat', sans-serif; font-size:16px; letter-spacing:3px; }
  .marca small { display:block; color:var(--dourado-claro); font-size:10px; letter-spacing:2px; text-transform:uppercase; margin-top:2px; }
  main { flex:1; width:100%; max-width:520px; margin:-150px auto 0; padding:0 16px 32px; position:relative; z-index:2; }
  .cartao { background:#fff; border-radius:20px; box-shadow:0 24px 60px -24px rgba(24,6,8,0.35), 0 2px 6px rgba(24,6,8,0.06);
            padding:36px 32px 30px; text-align:center; animation:subir .5s ease-out backwards; }
  .icone { width:72px; height:72px; margin:0 auto 20px; border-radius:50%; display:flex; align-items:center; justify-content:center; position:relative; }
  .icone svg { width:32px; height:32px; }
  .icone.baixar { background:#F6ECDD; color:var(--bordo); }
  .icone.baixar svg { animation:descer 1.2s ease-in-out infinite; }
  .icone.baixar::before { content:''; position:absolute; inset:-6px; border-radius:50%; border:3px solid transparent; border-top-color:var(--dourado); animation:girar 1s linear infinite; }
  .icone.ok { background:#E3F5EC; color:var(--verde); animation:pulo .4s ease-out; }
  .icone.alerta { background:#FBEAEA; color:#AF1230; }
  .icone.relogio { background:#FBF1DE; color:var(--ambar); }
  h1 { font-family:'Montserrat', sans-serif; font-size:24px; line-height:1.25; margin:0 0 10px; color:var(--bordo-escuro); }
  .texto { font-size:15px; line-height:1.6; color:var(--suave); margin:0 auto 24px; max-width:380px; }
  .arquivo { display:flex; align-items:center; gap:14px; text-align:left; background:#FCF9F4; border:1px solid var(--borda); border-left:4px solid var(--dourado);
             border-radius:12px; padding:14px 16px; margin-bottom:24px; }
  .pdf { width:44px; height:52px; border-radius:6px; background:linear-gradient(160deg, #B3261E, #7F1A15); color:#fff; font-size:11px; font-weight:700;
         letter-spacing:.5px; display:flex; align-items:flex-end; justify-content:center; padding-bottom:8px; flex-shrink:0; position:relative; }
  .pdf::before { content:''; position:absolute; top:0; right:0; border-width:0 12px 12px 0; border-style:solid; border-color:#F4EFE8 #F4EFE8 rgba(255,255,255,.35) rgba(255,255,255,.35); border-radius:0 6px 0 3px; }
  .arquivo-info { min-width:0; }
  .arquivo-info strong { display:block; font-size:15px; color:var(--texto); overflow-wrap:anywhere; }
  .arquivo-info span { display:block; font-size:13px; color:var(--suave); margin-top:3px; overflow-wrap:anywhere; }
  .barra { height:6px; border-radius:6px; background:#F3E9DA; overflow:hidden; margin:-8px 0 24px; }
  .barra span { display:block; height:100%; width:40%; border-radius:6px; background:linear-gradient(90deg, var(--dourado), var(--bordo)); animation:correr 1.1s ease-in-out infinite; }
  .feito .barra span { width:100%; animation:none; background:var(--verde); transition:width .3s; }
  .botoes { display:flex; flex-direction:column; gap:10px; }
  .btn { display:block; padding:15px 20px; border-radius:12px; font-weight:600; font-size:15px; text-decoration:none; transition:transform .15s, box-shadow .15s, background .15s; }
  .btn-principal { background:var(--bordo); color:#fff; box-shadow:0 8px 20px -8px rgba(102,0,0,.6); }
  .btn-principal:hover { background:var(--bordo-escuro); transform:translateY(-1px); }
  .btn-secundario { color:var(--bordo); border:1px solid var(--borda); background:#fff; }
  .btn-secundario:hover { border-color:var(--dourado); background:#FCF9F4; }
  .ajuda { display:flex; align-items:center; justify-content:center; gap:8px; margin-top:22px; padding-top:20px; border-top:1px solid var(--borda); font-size:13px; color:var(--suave); }
  .ajuda a { color:var(--verde); font-weight:600; text-decoration:none; display:inline-flex; align-items:center; gap:5px; }
  .ajuda svg { width:16px; height:16px; }
  footer { text-align:center; font-size:12px; line-height:1.7; color:var(--suave); padding:0 16px 28px; }
  footer b { color:var(--bordo); letter-spacing:2px; font-family:'Montserrat', sans-serif; font-size:12px; }
  @keyframes subir { from { opacity:0; transform:translateY(16px); } }
  @keyframes girar { to { transform:rotate(360deg); } }
  @keyframes descer { 0%,100% { transform:translateY(-2px); } 50% { transform:translateY(3px); } }
  @keyframes correr { 0% { transform:translateX(-100%); } 100% { transform:translateX(260%); } }
  @keyframes pulo { 0% { transform:scale(.6); } 70% { transform:scale(1.08); } 100% { transform:scale(1); } }
  @media (max-width:480px) { .cartao { padding:30px 20px 24px; } h1 { font-size:21px; } .faixa { height:230px; } main { margin-top:-130px; } }
  @media (prefers-reduced-motion: reduce) { *, *::before { animation:none !important; transition:none !important; } }
</style>
</head>
<body>
  <div class="faixa">
    <div class="marca">
      <span class="selo"><img src="/assets/logo-mark.png" alt=""></span>
      <span><b>PRIVILEGE</b><small>Contabilidade e Consultoria</small></span>
    </div>
  </div>
  <main>
    <div class="cartao${baixando ? '' : ' feito'}" id="cartao">
      <div class="icone ${tipo}" id="icone">${ICONES[tipo] || ICONES.alerta}</div>
      <h1 id="titulo">${esc(titulo)}</h1>
      <p class="texto" id="texto">${esc(texto)}</p>
      ${cartaoArquivo}
      ${baixando ? '<div class="barra" aria-hidden="true"><span></span></div>' : ''}
      <div class="botoes">
        ${baixando ? `<a class="btn btn-principal" id="btn-baixar" href="${esc(urlArquivo)}">Baixar agora</a>` : ''}
        <a class="btn ${baixando ? 'btn-secundario' : 'btn-principal'}" href="${esc(portal)}">Acessar a Área do Cliente</a>
      </div>
      <div class="ajuda">Precisa de ajuda?
        <a href="${ESCRITORIO.linkWhatsapp}" target="_blank" rel="noopener">${ICONES.whats} WhatsApp ${ESCRITORIO.whatsapp}</a>
      </div>
    </div>
  </main>
  <footer><b>PRIVILEGE</b><br>${esc(ESCRITORIO.endereco)}<br>Telefone ${esc(ESCRITORIO.telefone)}</footer>
${baixando ? `<script>
  // Começa o download sozinho e depois mostra "Download iniciado"
  (function () {
    var url = ${JSON.stringify(urlArquivo)};
    setTimeout(function () {
      location.href = url;
      setTimeout(function () {
        document.getElementById('cartao').classList.add('feito');
        var icone = document.getElementById('icone');
        icone.className = 'icone ok';
        icone.innerHTML = ${JSON.stringify(ICONES.ok)};
        document.getElementById('titulo').textContent = 'Download iniciado!';
        document.getElementById('texto').textContent = 'Confira a pasta Downloads do seu computador ou celular. Não apareceu? Toque em "Baixar novamente".';
        document.getElementById('btn-baixar').textContent = 'Baixar novamente';
      }, 1200);
    }, 900);
  })();
</script>` : ''}
</body></html>`);
}

/** Confere o link do e-mail e devolve { email, documento } ou responde com a página de erro. */
async function validarLink(req, res) {
  const { token, documentoId } = req.params;
  const invalido = () => paginaPublica(res, { status: 404, titulo: 'Link não encontrado', texto: 'Este link não é válido. Você encontra todas as suas guias na Área do Cliente.' });
  if (!REGEX_TOKEN.test(token) || !UUID.test(documentoId)) return invalido();

  const { rows: [email] } = await query(
    `SELECT e.id, e.destinatario, e.enviado_em FROM emails_enviados e
     JOIN emails_enviados_documentos ed ON ed.email_id = e.id AND ed.documento_id = $2
     WHERE e.token = $1`,
    [token, documentoId]
  );
  if (!email) return invalido();

  const idadeDias = (Date.now() - new Date(email.enviado_em).getTime()) / 86400000;
  if (idadeDias > VALIDADE_LINK_DIAS) {
    return paginaPublica(res, { status: 410, tipo: 'relogio', titulo: 'Este link expirou', texto: 'Por segurança, os links dos e-mails valem por 6 meses. A guia continua disponível na sua Área do Cliente.' });
  }

  const documento = await Documento.buscarPorId(documentoId);
  // Removido, escondido do cliente ou certificado digital: só pela Área do Cliente
  if (!documento || !documento.visivel_cliente || /\.(pfx|p12)$/i.test(documento.nome_original)
      || !fs.existsSync(path.join(UPLOAD_DIR, documento.nome_armazenado))) {
    return paginaPublica(res, { status: 404, titulo: 'Arquivo indisponível', texto: 'Este arquivo não está mais disponível por este link. Fale com o escritório ou acesse a Área do Cliente.' });
  }
  return { email, documento };
}

/** Página intermediária: redireciona para o arquivo (robôs de antivírus não seguem). */
async function paginaDownload(req, res, next) {
  try {
    const ok = await validarLink(req, res);
    if (!ok) return;
    const { documento } = ok;
    const { rows: [empresa] } = await query('SELECT razao_social FROM empresas WHERE id = $1', [documento.empresa_id]);
    const ehGuia = documento.categoria === 'guia';
    res.set('Cache-Control', 'no-store');
    paginaPublica(res, {
      tipo: 'baixar',
      titulo: ehGuia ? 'Baixando sua guia…' : 'Baixando seu arquivo…',
      texto: 'Seu download vai começar em instantes.',
      arquivo: {
        titulo: documento.descricao || documento.nome_original,
        empresa: empresa && empresa.razao_social,
        nome: documento.descricao ? documento.nome_original : null,
        tamanho: tamanhoLegivel(documento.tamanho_bytes)
      },
      urlArquivo: `${req.params.documentoId}/arquivo`
    });
  } catch (err) {
    next(err);
  }
}

async function baixarArquivo(req, res, next) {
  try {
    const ok = await validarLink(req, res);
    if (!ok) return;
    const { email, documento } = ok;
    const { rows: [cliente] } = await query('SELECT id FROM clientes_portal WHERE LOWER(email) = LOWER($1)', [email.destinatario]);
    await query(
      `INSERT INTO downloads_portal (documento_id, documento_nome, cliente_id, empresa_id, ip, origem, email_id)
       VALUES ($1, $2, $3, $4, $5, 'email', $6)`,
      [documento.id, documento.nome_original, cliente ? cliente.id : null, documento.empresa_id, req.ip ? String(req.ip).slice(0, 64) : null, email.id]
    );
    // Quem baixou pelo botão certamente abriu o e-mail (mesmo com imagens bloqueadas)
    await query('UPDATE emails_enviados SET aberto_em = COALESCE(aberto_em, NOW()) WHERE id = $1', [email.id]);
    res.download(path.join(UPLOAD_DIR, documento.nome_armazenado), documento.nome_original);
  } catch (err) {
    next(err);
  }
}

// ---------- Tela da equipe ----------

const SITUACOES = {
  falhou: `status = 'falhou'`,
  nao_abriu: `status <> 'falhou' AND aberto_em IS NULL AND NOT baixou`,
  abriu: `aberto_em IS NOT NULL`,
  baixou: `baixou`,
  nao_baixou: `status <> 'falhou' AND tem_documento AND NOT baixou`
};

async function listar(req, res, next) {
  try {
    const dias = Math.max(0, Math.min(3650, parseInt(req.query.dias, 10) || 0));
    const busca = String(req.query.busca || '').trim().slice(0, 100);
    const situacao = Object.hasOwn(SITUACOES, String(req.query.situacao)) ? req.query.situacao : null;
    const limite = Math.max(1, Math.min(200, parseInt(req.query.limite, 10) || 50));
    const pagina = Math.max(1, parseInt(req.query.pagina, 10) || 1);

    const params = [];
    const filtros = [];
    if (dias) { params.push(dias); filtros.push(`e.enviado_em >= NOW() - ($${params.length} || ' days')::interval`); }
    if (busca) {
      params.push(`%${busca}%`);
      filtros.push(`(emp.razao_social ILIKE $${params.length} OR emp.cnpj ILIKE $${params.length} OR e.destinatario ILIKE $${params.length} OR e.assunto ILIKE $${params.length})`);
    }
    if (req.query.empresa_id && UUID.test(req.query.empresa_id)) { params.push(req.query.empresa_id); filtros.push(`e.empresa_id = $${params.length}`); }

    // Downloads de cada e-mail: pelo botão do próprio e-mail + pela Área do Cliente (mesmos documentos)
    const base = `
      WITH base AS (
        SELECT e.id, e.enviado_em, e.destinatario, e.assunto, e.tipo, e.status, e.erro,
               e.aberto_em, e.ultima_abertura_em, e.aberturas,
               emp.id AS empresa_id, emp.razao_social AS empresa_nome, u.nome AS enviado_por_nome,
               COALESCE((SELECT json_agg(json_build_object('id', d.id, 'nome', d.nome_original, 'descricao', d.descricao) ORDER BY d.nome_original)
                         FROM emails_enviados_documentos ed JOIN documentos d ON d.id = ed.documento_id
                         WHERE ed.email_id = e.id), '[]') AS documentos,
               COALESCE((SELECT json_agg(json_build_object('origem', dp.origem, 'quando', dp.criado_em, 'documento', dp.documento_nome,
                                                           'quem', COALESCE(c.nome, c.email, e.destinatario)) ORDER BY dp.criado_em)
                         FROM downloads_portal dp LEFT JOIN clientes_portal c ON c.id = dp.cliente_id
                         WHERE dp.email_id = e.id
                            OR (dp.origem = 'portal' AND dp.criado_em >= e.enviado_em
                                AND dp.documento_id IN (SELECT documento_id FROM emails_enviados_documentos WHERE email_id = e.id))), '[]') AS downloads
        FROM emails_enviados e
        LEFT JOIN empresas emp ON emp.id = e.empresa_id
        LEFT JOIN usuarios u ON u.id = e.enviado_por
        ${filtros.length ? 'WHERE ' + filtros.join(' AND ') : ''}
      ), calc AS (
        SELECT *, json_array_length(downloads) > 0 AS baixou, json_array_length(documentos) > 0 AS tem_documento FROM base
      )`;

    const { rows: [resumo] } = await query(
      `${base}
       SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'falhou')::int AS falhou,
              COUNT(*) FILTER (WHERE aberto_em IS NOT NULL)::int AS abertos,
              COUNT(*) FILTER (WHERE baixou)::int AS baixados,
              COUNT(*) FILTER (WHERE status <> 'falhou' AND aberto_em IS NULL AND NOT baixou)::int AS nao_abertos
       FROM calc`,
      params
    );

    const filtroSituacao = situacao ? `WHERE ${SITUACOES[situacao]}` : '';
    const { rows: [{ total_filtrado }] } = await query(`${base} SELECT COUNT(*)::int AS total_filtrado FROM calc ${filtroSituacao}`, params);
    const { rows: emails } = await query(
      `${base} SELECT * FROM calc ${filtroSituacao} ORDER BY enviado_em DESC LIMIT ${limite} OFFSET ${(pagina - 1) * limite}`,
      params
    );

    // Endereço interno (localhost / rede do escritório): o celular do cliente não alcança os links
    const somenteRedeLocal = /^https?:\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/i.test(urlBaseSistema());
    res.json({ resumo, emails, total: total_filtrado, pagina, limite, somente_rede_local: somenteRedeLocal && !require('../config/demo').MODO_DEMO });
  } catch (err) {
    next(err);
  }
}

module.exports = { abertura, paginaDownload, baixarArquivo, listar };
