// @ts-check
/**
 * Relatório de Situação Fiscal (SITFIS) pelo Integra Contador — o mesmo
 * "Informações de apoio para emissão de certidão" do e-CAC.
 *
 * Duas etapas no SERPRO:
 *   1. Apoiar  SITFIS/SOLICITARPROTOCOLO91 → protocolo (+ tempo de espera)
 *   2. Emitir  SITFIS/RELATORIOSITFIS92    → PDF (ou 202/204 "ainda processando")
 * O protocolo vale só no dia; se o SERPRO devolver 304, o protocolo vem no ETag.
 */

const integra = require('./integraContadorService');
const { extrairTexto } = require('./leitorGuias');

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const ESPERA_MAXIMA_MS = 90000;

const tempoDoEtag = (r) => Number((/tempoEspera:(\d+)/.exec((r.headers && r.headers.etag) || '') || [])[1]) || null;

async function solicitarProtocolo(cnpj) {
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const r = await integra.chamar('Apoiar', { contribuinte: cnpj, idSistema: 'SITFIS', idServico: 'SOLICITARPROTOCOLO91', versaoSistema: '2.0', dados: '' });
    const dados = r.dados || {};
    let protocolo = dados.protocoloRelatorio;
    if (!protocolo && r.headers && r.headers.etag) protocolo = (/protocoloRelatorio:([^"]+)/.exec(r.headers.etag) || [])[1];
    if (protocolo) return { protocolo, espera: dados.tempoEspera || 2000 };
    // AV02: limite de pedidos em processamento — espera o tempo indicado e tenta de novo
    await esperar(Math.min(Math.max(dados.tempoEspera || tempoDoEtag(r) || 3000, 1000), 20000));
  }
  throw new integra.ErroIntegra('O SERPRO não liberou o relatório agora. Tente de novo em alguns minutos.');
}

/** Emite o relatório. Devolve { pdf: Buffer, texto, analise }. */
async function emitirRelatorio(cnpj) {
  const { protocolo, espera } = await solicitarProtocolo(cnpj);
  const inicio = Date.now();
  let aguardar = espera;
  while (Date.now() - inicio < ESPERA_MAXIMA_MS) {
    await esperar(Math.min(Math.max(aguardar, 1000), 20000));
    const r = await integra.chamar('Emitir', { contribuinte: cnpj, idSistema: 'SITFIS', idServico: 'RELATORIOSITFIS92', versaoSistema: '2.0', dados: { protocoloRelatorio: protocolo } });
    if (r.dados && r.dados.pdf) {
      const pdf = Buffer.from(r.dados.pdf, 'base64');
      const texto = await extrairTexto(pdf).catch(() => '');
      return { pdf, texto, analise: analisarRelatorio(texto) };
    }
    aguardar = (r.dados && r.dados.tempoEspera) || tempoDoEtag(r) || 3000;
  }
  throw new integra.ErroIntegra('A Receita ainda está preparando o relatório. Tente de novo em alguns minutos.');
}

const dataISO = (br) => (br ? `${br.slice(6, 10)}-${br.slice(3, 5)}-${br.slice(0, 2)}` : null);

/**
 * Lê o texto do relatório:
 *  - certidão já emitida (tipo, código, emissão, validade)
 *  - seções "Pendência - ..." (débito, omissão de declaração, dívida ativa...) → impedem a CND
 *  - débitos com exigibilidade suspensa (não impedem: dão "positiva com efeitos de negativa")
 */
function analisarRelatorio(texto) {
  const t = String(texto || '').replace(/\s+/g, ' ');
  const resumo = { certidao: null, pendencias: [], suspensos: [], pgfnSemPendencias: /n[aã]o foram detectadas pend[eê]ncias[^.]*Procuradoria/i.test(t) };

  const c = /Certid[aã]o (Negativa|Positiva com Efeitos de Negativa|Positiva)[^:]*:\s*([0-9A-F]{4}(?:\.[0-9A-F]{4}){3})\s*Emiss[aã]o:\s*(\d{2}\/\d{2}\/\d{4})\s*Data de Validade:\s*(\d{2}\/\d{2}\/\d{4})/i.exec(t);
  if (c) resumo.certidao = { tipo: `Certidão ${c[1]}`, codigo: c[2], emissao: dataISO(c[3]), validade: dataISO(c[4]) };

  // Títulos das seções: "Pendência - Débito (SIEF)", "Pendência - Omissão de DCTF"...
  for (const m of t.matchAll(/Pend[eê]ncia\s*-\s*([^_]{3,80}?)\s*_{3,}/gi)) {
    const nome = m[1].trim();
    if (!resumo.pendencias.includes(nome)) resumo.pendencias.push(nome);
  }
  for (const m of t.matchAll(/(D[eé]bito com Exigibilidade Suspensa[^_]{0,60}?|Processo com Exigibilidade Suspensa[^_]{0,60}?|Parcelamento com Exigibilidade Suspensa[^_]{0,60}?)\s*_{3,}/gi)) {
    const nome = m[1].trim();
    if (!resumo.suspensos.includes(nome)) resumo.suspensos.push(nome);
  }
  const semNadaReceita = /N[aã]o foram detectadas pend[eê]ncias\/exigibilidades suspensas[^.]*Receita Federal/i.test(t);

  let situacao = 'indefinida';
  if (resumo.pendencias.length) situacao = 'pendencia';
  else if (/Diagn[oó]stico Fiscal na Receita Federal/i.test(t) || semNadaReceita || resumo.certidao) situacao = 'regular';
  return { situacao, ...resumo };
}

module.exports = { emitirRelatorio, analisarRelatorio };
