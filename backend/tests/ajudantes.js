/**
 * Ajudantes dos testes automáticos: geram arquivos de mentira (PDF de DAS,
 * certificado .pfx) para testar sem banco de dados, sem internet e sem
 * nenhum dado real de cliente.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const forge = require('node-forge');

// Pastas temporárias dos certificados de mentira — apagadas quando os testes terminam
const pastasTemporarias = [];
process.on('exit', () => pastasTemporarias.forEach((p) => fs.rmSync(p, { recursive: true, force: true })));

/** PDF mínimo com texto (WinAnsi: \347 = ç, \343 = ã), imitando o layout do DAS. */
function pdfDas({ cnpj, razao, mes, venc, valor, numero }) {
  const linhas = [
    'Documento de Arrecada\\347\\343o', 'do Simples Nacional', `${cnpj}   ${razao}`,
    'Per\\355odo de Apura\\347\\343o   Data de Vencimento   N\\372mero do Documento',
    `${numero}   Pagar este documento at\\351`, `${venc} Observa\\347\\365es`, 'Valor Total do Documento', valor,
    'CNPJ   Raz\\343o Social', `${mes}   ${venc}`
  ];
  const conteudo = 'BT /F1 10 Tf 40 800 Td 14 TL ' + linhas.map((l) => `(${l}) Tj T*`).join(' ') + ' ET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(conteudo, 'latin1')} >>\nstream\n${conteudo}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(pdf, 'latin1')); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

/**
 * Certificado e-CNPJ de mentira (autoassinado) em .pfx no formato ANTIGO (3DES),
 * igual aos dos clientes — o que o Node não abre sozinho. Devolve o caminho do arquivo.
 */
function gerarPfx({ nomeComum = 'EMPRESA TESTE LTDA:78966782000105', senha = 'senha-teste', venceEmDias = 365 } = {}) {
  const chaves = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = chaves.publicKey;
  cert.serialNumber = '01';
  const inicio = new Date(Date.now() - 2 * 86400000);
  cert.validity.notBefore = venceEmDias < 0 ? new Date(Date.now() + (venceEmDias - 30) * 86400000) : inicio;
  cert.validity.notAfter = new Date(Date.now() + venceEmDias * 86400000);
  const nome = [{ name: 'commonName', value: nomeComum }, { name: 'countryName', value: 'BR' }];
  cert.setSubject(nome);
  cert.setIssuer(nome);
  cert.sign(chaves.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(chaves.privateKey, [cert], senha, { algorithm: '3des' });
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'teste-pfx-'));
  pastasTemporarias.push(pasta);
  const arquivo = path.join(pasta, 'certificado.pfx');
  fs.writeFileSync(arquivo, Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary'));
  return arquivo;
}

/** Carrega um módulo "do zero" (sem o cache do require), para testes que mudam o .env. */
function carregarLimpo(caminho) {
  const resolvido = require.resolve(caminho);
  delete require.cache[resolvido];
  return require(resolvido);
}

module.exports = { pdfDas, gerarPfx, carregarLimpo };
