/**
 * Leitura de guias em PDF (DAS, DARF/DCTFWeb, FGTS Digital, guias
 * estaduais e municipais): extrai o texto do PDF e procura CNPJ,
 * competência, vencimento, valor e número do documento.
 *
 * Testado com DAS do PGDAS-D. Os demais tipos usam as mesmas regras
 * gerais (CNPJ + datas + valor) e devem ser conferidos com um exemplo
 * real de cada antes de confiar 100%.
 */

const MESES = {
  janeiro: '01', fevereiro: '02', marco: '03', março: '03', abril: '04', maio: '05', junho: '06',
  julho: '07', agosto: '08', setembro: '09', outubro: '10', novembro: '11', dezembro: '12'
};

let pdfjs = null;
async function carregarPdfjs() {
  // pdfjs-dist é um módulo ESM: carregado sob demanda a partir do CommonJS
  if (!pdfjs) pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs;
}

/** Texto de todas as páginas do PDF (uma linha por quebra do próprio PDF). */
async function extrairTexto(buffer) {
  const { getDocument } = await carregarPdfjs();
  const pdf = await getDocument({ data: new Uint8Array(buffer), verbosity: 0, isEvalSupported: false }).promise;
  let texto = '';
  const paginas = Math.min(pdf.numPages, 5); // guias têm 1–2 páginas; limita arquivos gigantes
  for (let i = 1; i <= paginas; i++) {
    const pagina = await pdf.getPage(i);
    const conteudo = await pagina.getTextContent();
    texto += conteudo.items.map((item) => item.str + (item.hasEOL ? '\n' : ' ')).join('') + '\n';
  }
  await pdf.destroy();
  return texto;
}

const soDigitos = (v) => String(v || '').replace(/\D/g, '');

function paraDataIso(ddmmaaaa) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(ddmmaaaa || '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function paraNumero(valorBr) {
  if (!valorBr) return null;
  const n = Number(String(valorBr).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function detectarTipo(texto) {
  // Títulos às vezes vêm quebrados em duas linhas no PDF
  const t = texto.toLowerCase().replace(/\s+/g, ' ');
  if (t.includes('documento de arrecadação do simples nacional') || t.includes('documento de arrecadacao do simples nacional')) return 'DAS';
  if (/fgts digital|guia do fgts|\bgfd\b/.test(t)) return 'FGTS';
  if (/documento de arrecada[çc][ãa]o de receitas federais|\bdarf\b|dctfweb/.test(t)) return 'DARF';
  if (/\bicms\b|gr-pr|secretaria (de estado )?da fazenda|\bgare\b/.test(t)) return 'Estadual';
  if (/\biss\b|issqn|prefeitura|munic[íi]pio de/.test(t)) return 'Municipal';
  return 'Guia';
}

/** Primeiro CNPJ do documento (formatado ou só números). */
function acharCnpj(texto) {
  const formatado = /(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/.exec(texto);
  if (formatado) return soDigitos(formatado[1]);
  const puro = /(?:CNPJ[^\d]{0,15})(\d{14})/i.exec(texto);
  return puro ? puro[1] : null;
}

function acharCompetencia(texto) {
  // "agosto/2026" (DAS)
  const porExtenso = /(janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s*\/\s*(\d{4})/i.exec(texto);
  if (porExtenso) {
    const mes = MESES[porExtenso[1].toLowerCase().replace('ç', 'c')] || MESES[porExtenso[1].toLowerCase()];
    return `${porExtenso[2]}-${mes}`;
  }
  // "Período de Apuração ... 08/2026" ou "Competência 08/2026"
  const rotulado = /(?:per[íi]odo de apura[çc][ãa]o|compet[êe]ncia)[^\d]{0,60}(\d{2})\/(\d{4})/i.exec(texto);
  if (rotulado) return `${rotulado[2]}-${rotulado[1]}`;
  const solto = /\b(0[1-9]|1[0-2])\/(20\d{2})\b/.exec(texto);
  return solto ? `${solto[2]}-${solto[1]}` : null;
}

function acharVencimento(texto) {
  // DAS: a data de vencimento vem logo depois do período por extenso ("agosto/2026   21/09/2026")
  const das = /(?:janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s*\/\s*\d{4}\s+(\d{2}\/\d{2}\/\d{4})/i.exec(texto);
  if (das) return paraDataIso(das[1]);
  const rotulado = /(?:data de vencimento|vencimento)[^\d]{0,40}(\d{2}\/\d{2}\/\d{4})/i.exec(texto);
  if (rotulado) return paraDataIso(rotulado[1]);
  return null;
}

function acharPagarAte(texto) {
  const m = /pagar (?:este documento )?at[ée]:?\s*(\d{2}\/\d{2}\/\d{4})/i.exec(texto);
  return m ? paraDataIso(m[1]) : null;
}

function acharValor(texto) {
  const padroes = [
    /valor total do documento\s*([\d.]+,\d{2})/i,
    /\bvalor:\s*([\d.]+,\d{2})/i,
    /valor (?:total|a recolher|do documento)[^\d]{0,30}([\d.]+,\d{2})/i,
    /\btotais?\s+[\d.,\s]*?([\d.]+,\d{2})\s*$/im
  ];
  for (const p of padroes) {
    const m = p.exec(texto);
    if (m) return paraNumero(m[1]);
  }
  return null;
}

function acharNumeroDocumento(texto) {
  const m = /n[úu]mero(?: do documento)?:?\s*([\d][\d.\-/]{8,}\d)/i.exec(texto)
    || /\b(\d{2}\.\d{2}\.\d{5}\.\d{7}-\d)\b/.exec(texto);
  return m ? m[1] : null;
}

/** Razão social que aparece logo depois do CNPJ (layout do DAS). */
function acharRazaoSocial(texto, cnpj) {
  if (!cnpj) return null;
  const formatado = cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  const i = texto.indexOf(formatado);
  if (i === -1) return null;
  const depois = texto.slice(i + formatado.length, i + formatado.length + 120).split('\n')[0].trim();
  return depois && /[a-z]/i.test(depois) ? depois.replace(/\s{2,}/g, ' ').slice(0, 150) : null;
}

/** Lê uma guia em PDF e devolve o que conseguiu identificar. Nunca lança erro. */
async function lerGuia(buffer) {
  try {
    const texto = await extrairTexto(buffer);
    if (!texto.trim()) return { erro: 'PDF sem texto (pode ser uma imagem escaneada).' };
    const cnpj = acharCnpj(texto);
    return {
      tipo: detectarTipo(texto),
      cnpj,
      razao_social: acharRazaoSocial(texto, cnpj),
      competencia: acharCompetencia(texto),
      vencimento: acharVencimento(texto),
      pagar_ate: acharPagarAte(texto),
      valor: acharValor(texto),
      numero_documento: acharNumeroDocumento(texto)
    };
  } catch (err) {
    return { erro: 'Não foi possível ler este PDF.' };
  }
}

module.exports = { lerGuia, extrairTexto, soDigitos };
