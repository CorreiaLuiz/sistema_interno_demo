// @ts-check
/**
 * DAS direto da Receita pelo Integra Contador.
 *   Simples Nacional: Emitir PGDASD/GERARDAS12  (precisa da declaração do mês já transmitida)
 *   MEI:              Emitir PGMEI/GERARDASPDF21
 * Gerar de novo um mês já gerado não dá erro: sai outra guia igual (com multa e juros
 * se já passou do vencimento). Nada muda na declaração.
 */

const integra = require('./integraContadorService');

/** periodo: 'AAAA-MM' ou 'AAAAMM'. Devolve o PDF (Buffer). */
async function gerarDas({ cnpj, regime, periodo }) {
  const pa = String(periodo || '').replace(/\D/g, '');
  if (!/^\d{4}(0[1-9]|1[0-2])$/.test(pa)) throw new integra.ErroIntegra('Mês inválido.', { httpStatus: 400 });
  const mei = regime === 'mei';
  const r = await integra.chamar('Emitir', {
    contribuinte: cnpj,
    idSistema: mei ? 'PGMEI' : 'PGDASD',
    idServico: mei ? 'GERARDASPDF21' : 'GERARDAS12',
    dados: { periodoApuracao: pa }
  });
  const lista = [].concat(r.dados || []);
  const comPdf = lista.find((d) => d && d.pdf);
  if (!comPdf) {
    const msgs = (r.mensagens || []).map((m) => m.texto).filter(Boolean).join(' | ');
    throw new integra.ErroIntegra(msgs || 'A Receita não devolveu a guia.', { httpStatus: 502 });
  }
  const pdf = Buffer.from(comPdf.pdf, 'base64');
  if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new integra.ErroIntegra('A Receita devolveu um arquivo que não é PDF.');
  return pdf;
}

module.exports = { gerarDas };
