/**
 * PDFs simples (só texto) para a demonstração: cartão CNPJ, certidões,
 * contrato e guias DAS fictícios. Sem bibliotecas — PDF 1.4 escrito à mão.
 */

// Texto em WinAnsi (o que a fonte Helvetica padrão do PDF entende)
function paraPdf(texto) {
  return Buffer.from(String(texto), 'latin1').toString('latin1')
    .replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
    .replace(/[\u0080-ÿ]/g, (c) => `\\${c.charCodeAt(0).toString(8)}`);
}

/**
 * linhas: lista de textos ou { texto, tamanho, negrito }.
 * Devolve um Buffer com o PDF.
 */
function pdfTexto(linhas) {
  let y = 790;
  const comandos = [];
  for (const l of linhas) {
    const item = typeof l === 'string' ? { texto: l } : l;
    const tamanho = item.tamanho || 11;
    if (item.texto) comandos.push(`BT /${item.negrito ? 'F2' : 'F1'} ${tamanho} Tf 50 ${y} Td (${paraPdf(item.texto)}) Tj ET`);
    y -= Math.round(tamanho * 1.6);
  }
  // Marca d'água de demonstração
  comandos.push('BT /F2 9 Tf 50 40 Td (DOCUMENTO FICTICIO - SISTEMA PRIVILEGE - DEMONSTRACAO) Tj ET');
  const conteudo = comandos.join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(conteudo, 'latin1')} >>\nstream\n${conteudo}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(pdf, 'latin1')); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

/** Guia DAS fictícia no mesmo layout de texto do PGDAS-D (o leitor de guias reconhece). */
function pdfDas({ cnpj, razao, mesExtenso, vencimento, valor, numero }) {
  return pdfTexto([
    { texto: 'Documento de Arrecadação', negrito: true, tamanho: 14 },
    { texto: 'do Simples Nacional', negrito: true, tamanho: 14 },
    `${cnpj}   ${razao}`,
    'Período de Apuração   Data de Vencimento   Número do Documento',
    `${numero}   Pagar este documento até`,
    `${vencimento} Observações`,
    'Valor Total do Documento',
    valor,
    'CNPJ   Razão Social',
    `${mesExtenso}   ${vencimento}`
  ]);
}

module.exports = { pdfTexto, pdfDas };
