/**
 * Layout de e-mail com a identidade da Privilege Contabilidade (logo,
 * bordô e dourado, rodapé com endereço e telefones).
 *
 * Feito com tabelas e estilos inline — é o único jeito de ficar igual no
 * Outlook, Gmail e celular. O logo vai como imagem embutida (cid), então
 * aparece mesmo sem o sistema estar na internet.
 *
 *   montarEmail({ titulo, chamada, resumo, saudacao, paragrafos, itens, total,
 *                 avisoAnexo, botao, linkSecundario, observacao, pixel })
 *     → { html, texto, anexosLayout }
 *   emailSimples(assunto, mensagem) → mesmo formato, a partir de um texto comum
 */

const path = require('path');
const fs = require('fs');

const ESCRITORIO = {
  nome: 'Privilege Contabilidade e Consultoria',
  endereco: 'Rua Pará, 127 — Sala 103, Centro · Francisco Beltrão/PR',
  telefone: '(46) 3035-1018',
  whatsapp: '(46) 3035-1061',
  linkWhatsapp: 'https://wa.me/554630351061',
  linkTelefone: 'tel:+554630351018',
  email: 'contato@privilegecontabilidade.com.br'
};

const COR = {
  bordo: '#660000', bordoEscuro: '#430A0D', quasePreto: '#180608', dourado: '#C99B59', douradoClaro: '#E9D3AE',
  creme: '#F7F1E7', cremeClaro: '#FCF9F4', texto: '#2B1A1B', suave: '#6E5E5F', borda: '#EADFD0', fundo: '#EFE8DE'
};

const FONTE = "'Segoe UI', Helvetica, Arial, sans-serif";
const FONTE_TITULO = "Georgia, 'Times New Roman', serif";

const CAMINHO_LOGO = path.join(__dirname, '../../../frontend/assets/logo-mark.png');
const CID_LOGO = 'logo-privilege';

const escapar = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Escapa e transforma links soltos no texto em links clicáveis. */
function textoComLinks(s) {
  return escapar(s).replace(/(https?:\/\/[^\s<]+)/g, `<a href="$1" style="color:${COR.bordo}; word-break:break-all;">$1</a>`);
}

function anexosDoLayout() {
  return fs.existsSync(CAMINHO_LOGO)
    ? [{ nome: 'logo-privilege.png', caminho: CAMINHO_LOGO, tipo: 'image/png', cid: CID_LOGO }]
    : [];
}

/** Botão "à prova de Outlook" (tabela + link). */
function botaoHtml({ texto, url }, { cheio = true, tamanho = 'grande' } = {}) {
  const pad = tamanho === 'grande' ? '15px 34px' : '8px 16px';
  const fonte = tamanho === 'grande' ? '16px' : '13px';
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:separate;"><tr>
    <td style="border-radius:10px; background:${cheio ? COR.bordo : '#FFFFFF'}; ${cheio ? '' : `border:1px solid ${COR.bordo};`}">
      <a href="${escapar(url)}" style="display:inline-block; padding:${pad}; font-family:${FONTE}; font-size:${fonte}; font-weight:bold; color:${cheio ? '#FFFFFF' : COR.bordo}; text-decoration:none; border-radius:10px;">${escapar(texto)}</a>
    </td></tr></table>`;
}

/** Cartão de uma guia/documento: etiqueta (ex: "DAS"), título, detalhe, valor e "Baixar PDF". */
function cartaoItem(i) {
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px; border-collapse:separate; background:${COR.cremeClaro}; border:1px solid ${COR.borda}; border-left:4px solid ${COR.dourado}; border-radius:10px;">
    <tr>
      <td class="item-esq" style="padding:16px 18px; vertical-align:top;">
        ${i.etiqueta ? `<span style="display:inline-block; font-family:${FONTE}; font-size:11px; font-weight:bold; letter-spacing:1px; text-transform:uppercase; color:${COR.bordo}; background:#F3E4D0; border-radius:20px; padding:3px 10px; margin-bottom:8px;">${escapar(i.etiqueta)}</span><br>` : ''}
        <span style="font-family:${FONTE}; font-size:16px; font-weight:bold; color:${COR.texto};">${escapar(i.rotulo)}</span>
        ${i.detalhe ? `<div style="font-family:${FONTE}; font-size:13px; line-height:1.5; color:${COR.suave}; margin-top:4px;">${escapar(i.detalhe)}</div>` : ''}
        ${i.link ? `<div style="margin-top:12px;">${botaoHtml({ texto: 'Baixar PDF', url: i.link }, { cheio: false, tamanho: 'pequeno' })}</div>` : ''}
      </td>
      ${i.valor ? `<td class="item-dir" align="right" style="padding:16px 18px; vertical-align:top; white-space:nowrap;">
        <div style="font-family:${FONTE}; font-size:11px; letter-spacing:1px; text-transform:uppercase; color:${COR.suave};">Valor</div>
        <div style="font-family:${FONTE}; font-size:20px; font-weight:bold; color:${COR.bordo}; margin-top:2px;">${escapar(i.valor)}</div>
      </td>` : ''}
    </tr>
  </table>`;
}

/**
 * @param {object} o
 * @param {string} o.titulo           título grande (na faixa bordô)
 * @param {string} [o.chamada]        texto pequeno dourado acima do título (ex: "Guia para pagamento")
 * @param {string} [o.resumo]         texto que aparece na prévia da caixa de entrada
 * @param {string} [o.saudacao]       ex: "Olá, Maria!"
 * @param {string[]} [o.paragrafos]
 * @param {{rotulo:string, etiqueta?:string, valor?:string, detalhe?:string, link?:string}[]} [o.itens]
 * @param {string} [o.total]          valor total (mostrado quando há mais de um item)
 * @param {string} [o.avisoAnexo]     ex: "2 PDFs em anexo"
 * @param {{texto:string, url:string}} [o.botao]
 * @param {{texto:string, url:string}} [o.linkSecundario]  link discreto abaixo do botão
 * @param {string} [o.observacao]     texto pequeno no fim do cartão
 * @param {string} [o.pixel]          URL da imagem invisível que registra a abertura
 */
function montarEmail({ titulo, chamada, resumo, saudacao, paragrafos = [], itens = [], total, avisoAnexo, botao, linkSecundario, observacao, pixel }) {
  const temLogo = fs.existsSync(CAMINHO_LOGO);
  const p = (t) => `<p style="margin:0 0 16px; font-family:${FONTE}; font-size:15px; line-height:1.65; color:${COR.texto};">${textoComLinks(t).replace(/\n/g, '<br>')}</p>`;

  const htmlTotal = total && itens.length > 1 ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 12px;">
      <tr>
        <td style="font-family:${FONTE}; font-size:14px; color:${COR.suave}; padding:0 4px;">Total das guias</td>
        <td align="right" style="font-family:${FONTE}; font-size:20px; font-weight:bold; color:${COR.bordoEscuro}; padding:0 4px;">${escapar(total)}</td>
      </tr>
    </table>` : '';

  const htmlAnexo = avisoAnexo
    ? `<p style="margin:4px 0 22px; font-family:${FONTE}; font-size:13px; color:${COR.suave};">&#128206;&nbsp; ${escapar(avisoAnexo)}</p>`
    : '';

  const htmlBotao = botao ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 ${linkSecundario ? '10px' : '26px'};">
      <tr><td align="center">${botaoHtml(botao)}</td></tr>
    </table>` : '';

  const htmlLinkSecundario = linkSecundario
    ? `<p style="margin:0 0 26px; text-align:center; font-family:${FONTE}; font-size:13px;"><a href="${escapar(linkSecundario.url)}" style="color:${COR.bordo};">${escapar(linkSecundario.texto)}</a></p>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${escapar(titulo)}</title>
<style>
  @media only screen and (max-width: 620px) {
    .moldura { padding: 16px 8px !important; }
    .miolo { padding: 26px 20px 8px !important; }
    .ajuda { padding: 0 20px 24px !important; }
    .faixa { padding: 26px 20px 30px !important; }
    .titulo { font-size: 24px !important; }
    .item-esq, .item-dir { display: block !important; width: auto !important; text-align: left !important; }
    .item-dir { padding-top: 0 !important; }
  }
</style>
</head>
<body style="margin:0; padding:0; background:${COR.fundo}; -webkit-text-size-adjust:100%;">
${resumo ? `<div style="display:none; max-height:0; overflow:hidden; opacity:0; mso-hide:all;">${escapar(resumo)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${COR.fundo}" style="background:${COR.fundo};">
  <tr><td class="moldura" align="center" style="padding:32px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px; border-collapse:separate;">

      <!-- Faixa bordô: marca + título -->
      <tr><td class="faixa" bgcolor="${COR.bordo}" style="background:${COR.bordo}; background-image:linear-gradient(135deg, ${COR.bordo} 0%, ${COR.bordoEscuro} 100%); border-radius:16px 16px 0 0; padding:28px 36px 34px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          ${temLogo ? `<td style="padding-right:12px; vertical-align:middle;">
            <table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="#FFFFFF" style="background:#FFFFFF; border-radius:50%; width:44px; height:44px; text-align:center; vertical-align:middle;">
              <img src="cid:${CID_LOGO}" width="38" alt="Privilege" style="display:inline-block; width:38px; height:auto; border:0; vertical-align:middle;">
            </td></tr></table>
          </td>` : ''}
          <td style="vertical-align:middle;">
            <div style="font-family:${FONTE}; font-size:17px; font-weight:bold; letter-spacing:3px; color:#FFFFFF;">PRIVILEGE</div>
            <div style="font-family:${FONTE}; font-size:10px; letter-spacing:2px; color:${COR.douradoClaro}; text-transform:uppercase;">Contabilidade e Consultoria</div>
          </td>
        </tr></table>
        <div style="height:1px; line-height:1px; background:rgba(233,211,174,0.35); margin:24px 0 22px;">&nbsp;</div>
        ${chamada ? `<div style="font-family:${FONTE}; font-size:12px; font-weight:bold; letter-spacing:2px; text-transform:uppercase; color:${COR.dourado}; margin-bottom:8px;">${escapar(chamada)}</div>` : ''}
        <h1 class="titulo" style="margin:0; font-family:${FONTE_TITULO}; font-size:28px; line-height:1.25; font-weight:normal; color:#FFFFFF;">${escapar(titulo)}</h1>
      </td></tr>
      <tr><td style="height:4px; line-height:4px; font-size:0; background:${COR.dourado};">&nbsp;</td></tr>

      <!-- Conteúdo -->
      <tr><td class="miolo" bgcolor="#FFFFFF" style="background:#FFFFFF; padding:34px 36px 12px;">
        ${saudacao ? p(saudacao) : ''}
        ${paragrafos.map(p).join('')}
        ${itens.length ? `<div style="height:6px;"></div>${itens.map(cartaoItem).join('')}` : ''}
        ${htmlTotal}
        ${htmlAnexo}
        ${htmlBotao}
        ${htmlLinkSecundario}
        ${observacao ? `<p style="margin:0 0 22px; font-family:${FONTE}; font-size:13px; line-height:1.6; color:${COR.suave};">${textoComLinks(observacao).replace(/\n/g, '<br>')}</p>` : ''}
      </td></tr>

      <!-- Precisa de ajuda? -->
      <tr><td class="ajuda" bgcolor="#FFFFFF" style="background:#FFFFFF; padding:0 36px 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COR.creme}; border-radius:12px; border-collapse:separate;">
          <tr><td style="padding:18px 20px;">
            <div style="font-family:${FONTE}; font-size:14px; font-weight:bold; color:${COR.bordoEscuro}; margin-bottom:6px;">Precisa de ajuda?</div>
            <div style="font-family:${FONTE}; font-size:13px; line-height:1.7; color:${COR.suave};">
              Fale com a gente pelo
              <a href="${ESCRITORIO.linkWhatsapp}" style="color:${COR.bordo}; font-weight:bold; text-decoration:none;">WhatsApp ${ESCRITORIO.whatsapp}</a>,
              pelo telefone <a href="${ESCRITORIO.linkTelefone}" style="color:${COR.bordo}; font-weight:bold; text-decoration:none;">${ESCRITORIO.telefone}</a>
              ou respondendo este e-mail.
            </div>
          </td></tr>
        </table>
      </td></tr>

      <!-- Rodapé -->
      <tr><td align="center" bgcolor="${COR.quasePreto}" style="background:${COR.quasePreto}; background-image:linear-gradient(135deg, ${COR.bordoEscuro} 0%, ${COR.quasePreto} 100%); border-radius:0 0 16px 16px; padding:26px 28px;">
        <div style="font-family:${FONTE}; font-size:13px; font-weight:bold; letter-spacing:2px; color:${COR.dourado};">PRIVILEGE</div>
        <div style="font-family:${FONTE}; font-size:12px; line-height:1.8; color:${COR.creme}; margin-top:8px;">
          ${ESCRITORIO.endereco}<br>
          <a href="${ESCRITORIO.linkTelefone}" style="color:${COR.creme}; text-decoration:none;">${ESCRITORIO.telefone}</a>
          &nbsp;·&nbsp; <a href="${ESCRITORIO.linkWhatsapp}" style="color:${COR.creme}; text-decoration:none;">WhatsApp ${ESCRITORIO.whatsapp}</a><br>
          <a href="mailto:${ESCRITORIO.email}" style="color:${COR.douradoClaro};">${ESCRITORIO.email}</a>
        </div>
      </td></tr>
      <tr><td align="center" style="padding:16px 10px 0; font-family:${FONTE}; font-size:11px; line-height:1.6; color:${COR.suave};">
        Você recebeu este e-mail porque é cliente da ${ESCRITORIO.nome}.
        ${pixel ? `<img src="${escapar(pixel)}" width="1" height="1" alt="" style="display:block; width:1px; height:1px; border:0;">` : ''}
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  // Versão só texto (para quem não abre HTML)
  const texto = [
    titulo, '',
    saudacao, ...(saudacao ? [''] : []),
    ...paragrafos.flatMap((t) => [t, '']),
    ...itens.map((i) => `• ${i.etiqueta ? `[${i.etiqueta}] ` : ''}${i.rotulo}${i.valor ? ` — ${i.valor}` : ''}${i.detalhe ? ` (${i.detalhe})` : ''}${i.link ? `\n  Baixar: ${i.link}` : ''}`),
    ...(total && itens.length > 1 ? [`Total: ${total}`] : []),
    ...(itens.length ? [''] : []),
    ...(avisoAnexo ? [avisoAnexo, ''] : []),
    ...(botao ? [`${botao.texto}: ${botao.url}`, ''] : []),
    ...(linkSecundario ? [`${linkSecundario.texto}: ${linkSecundario.url}`, ''] : []),
    ...(observacao ? [observacao, ''] : []),
    `Precisa de ajuda? WhatsApp ${ESCRITORIO.whatsapp} · Telefone ${ESCRITORIO.telefone}`, '',
    '—', ESCRITORIO.nome, ESCRITORIO.endereco
  ].filter((l) => l !== undefined).join('\n');

  return { html, texto, anexosLayout: anexosDoLayout() };
}

/** Coloca um e-mail de texto comum dentro do layout do escritório. */
function emailSimples(assunto, mensagem) {
  const blocos = String(mensagem || '').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const html = montarEmail({ titulo: assunto, paragrafos: blocos }).html;
  return { html, anexosLayout: anexosDoLayout() };
}

module.exports = { montarEmail, emailSimples, ESCRITORIO };
