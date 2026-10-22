// @ts-check
/**
 * Leitor de extratos OFX (versões 1.x em SGML e 2.x em XML).
 * Cada banco gera o arquivo de um jeito: uns fecham as tags, outros não,
 * uns usam vírgula decimal, o PagBank chega a pôr "R$" no saldo. Por isso
 * a leitura é por expressão regular, tag a tag, e tolerante.
 */

function decodificar(buffer) {
  const inicio = buffer.slice(0, 400).toString('latin1');
  const utf8 = /CHARSET:\s*UTF-?8|encoding="utf-?8"/i.test(inicio);
  return buffer.toString(utf8 ? 'utf8' : 'latin1');
}

function tag(texto, nome) {
  const m = texto.match(new RegExp(`<${nome}>([^<\\r\\n]*)`, 'i'));
  return m ? m[1].trim() : '';
}

/** "1.234,56" / "1,234.56" / "-50,00" / "R$ 10,00" → número. */
function numero(texto) {
  let t = String(texto || '').replace(/[^\d,.-]/g, '');
  if (!t) return null;
  const ultimaVirgula = t.lastIndexOf(',');
  const ultimoPonto = t.lastIndexOf('.');
  if (ultimaVirgula > ultimoPonto) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(/,/g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** "20260131120000[-3:BRT]" → "2026-01-31" */
function data(texto) {
  const m = String(texto || '').match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

// Linhas que não são movimento: o BB, o Itaú, o Cresol e o Sicoob mandam o
// saldo do dia/anterior como se fosse um lançamento. Só as frases dos bancos
// — no C6, por exemplo, "SALDO COMISSAO" é a descrição de um PIX de verdade.
const LINHA_DE_SALDO = /^(SALDO\s+(TOTAL|DO DIA|ANTERIOR|APLIC|MOVIMENTA|BLOQUEADO|DISPON|INICIAL|EM C)|SDO\s+(APLIC|CTA|CONTA)|S\s+A\s+L\s+D\s+O\b)/;
// Tipos de saída: alguns arquivos (um formato do Evolua) mandam o valor positivo
const TIPOS_SAIDA = new Set(['DEBIT', 'PAYMENT', 'OUT', 'FEE', 'SRVCHG', 'CASH', 'ATM', 'POS', 'DIRECTDEBIT']);

function lerOfx(buffer) {
  const texto = decodificar(buffer);
  if (!/<OFX>/i.test(texto)) throw new Error('Não é um arquivo OFX.');

  const inicio = data(tag(texto, 'DTSTART'));
  const fim = data(tag(texto, 'DTEND'));
  const geradoEm = data(tag(texto, 'DTSERVER'));
  // Período declarado só vale se for plausível (o Bradesco e um formato do
  // Evolua põem início = fim = dia do download)
  const diasNoPeriodo = inicio && fim ? (new Date(fim).getTime() - new Date(inicio).getTime()) / 86400000 : 0;
  const periodo = diasNoPeriodo >= 20 ? { inicio, fim } : null;
  // O Cresol (e outros) incluem parcelas agendadas para os meses seguintes:
  // o que tem data depois do dia em que o arquivo foi gerado ainda não aconteceu.
  const limite = geradoEm && (!inicio || geradoEm >= inicio) ? geradoEm : null;

  const blocos = texto.split(/<STMTTRN>/i).slice(1)
    .map((b) => b.split(/<\/STMTTRN>|<\/BANKTRANLIST>/i)[0]);

  const transacoes = [];
  let ignoradas = 0;
  for (const b of blocos) {
    let valor = numero(tag(b, 'TRNAMT'));
    const dia = data(tag(b, 'DTPOSTED'));
    if (valor === null || !dia) continue;
    const historico = (tag(b, 'MEMO') || tag(b, 'NAME')).trim();
    const textoLinha = historico.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
    if (LINHA_DE_SALDO.test(textoLinha) || (limite && dia > limite)) { ignoradas++; continue; }
    if (valor > 0 && TIPOS_SAIDA.has(tag(b, 'TRNTYPE').toUpperCase())) valor = -valor;
    transacoes.push({
      data: dia,
      valor: Math.round(valor * 100) / 100,
      fitid: tag(b, 'FITID'),
      historico: historico.slice(0, 120),
      foraDoPeriodo: !!(periodo && (dia < periodo.inicio || dia > periodo.fim))
    });
  }

  return {
    ignoradas,
    periodo,
    bancoCodigo: tag(texto, 'BANKID').replace(/\D/g, '').padStart(3, '0').slice(-3),
    agencia: tag(texto, 'BRANCHID'),
    conta: tag(texto, 'ACCTID'),
    instituicao: tag(texto, 'ORG'),
    inicio,
    fim,
    transacoes
  };
}

module.exports = { lerOfx, numero };
