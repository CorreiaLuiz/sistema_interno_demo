// @ts-check
/**
 * Integra Contador (SERPRO) — acesso às funções da Receita em nome dos clientes
 * (guias DAS, declarações, Caixa Postal do e-CAC, situação fiscal...).
 * Documentação: https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/
 *
 * Como funciona a entrada:
 *   1. POST https://autenticacao.sapi.serpro.gov.br/authenticate com as chaves do
 *      contrato (Basic) E o e-CNPJ do escritório (certificado digital, mTLS).
 *      Devolve access_token + jwt_token (valem ~30 min). Essa etapa não é cobrada.
 *   2. POST https://gateway.apiserpro.serpro.gov.br/integra-contador/v1/<Grupo>
 *      (Apoiar, Consultar, Declarar, Emitir, Monitorar) com os dois tokens.
 *      Cada chamada que dá resultado é COBRADA pelo SERPRO.
 *
 * Para consultar um cliente, ele precisa ter dado procuração no e-CAC ao escritório.
 *
 * Configuração no backend/.env:
 *   SERPRO_INTEGRA_CONSUMER_KEY / SERPRO_INTEGRA_CONSUMER_SECRET  (Área do Cliente do SERPRO)
 *   SERPRO_INTEGRA_CERT_PATH   caminho do .pfx do escritório (relativo à pasta backend ou completo)
 *   SERPRO_INTEGRA_CERT_SENHA  senha do .pfx
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const tls = require('tls');
const { MODO_DEMO } = require('../config/demo');

const AUTH_URL = () => process.env.SERPRO_INTEGRA_AUTH_URL || 'https://autenticacao.sapi.serpro.gov.br/authenticate';
const API_URL = () => process.env.SERPRO_INTEGRA_URL || 'https://gateway.apiserpro.serpro.gov.br/integra-contador/v1';
const GRUPOS = ['Apoiar', 'Consultar', 'Declarar', 'Emitir', 'Monitorar'];

class ErroIntegra extends Error {
  constructor(mensagem, { httpStatus = 502, mensagens = null } = {}) {
    super(mensagem);
    this.httpStatus = httpStatus;
    this.mensagensSerpro = mensagens;
    /** HTTP devolvido pelo SERPRO (quando a falha veio dele) */
    this.statusSerpro = null;
    /** Campo "dados" da resposta de erro do SERPRO, se houver */
    this.dados = null;
  }
}

function configurado() {
  if (MODO_DEMO) return true;
  return Boolean(process.env.SERPRO_INTEGRA_CONSUMER_KEY && process.env.SERPRO_INTEGRA_CONSUMER_SECRET
    && process.env.SERPRO_INTEGRA_CERT_PATH && process.env.SERPRO_INTEGRA_CERT_SENHA);
}

function caminhoCertificado() {
  const p = process.env.SERPRO_INTEGRA_CERT_PATH.trim();
  return path.isAbsolute(p) || p.startsWith('\\\\') || p.startsWith('//') ? p : path.join(__dirname, '..', '..', p);
}

// Certificado do escritório: lido uma vez. Os .pfx antigos (gerados com RC2/3DES) o
// Node não abre sozinho — nesse caso a node-forge converte em memória (nada vai para o disco).
let certCache = null;

function carregarCertificado() {
  if (certCache) return certCache;
  const arquivo = caminhoCertificado();
  let pfx;
  try {
    pfx = fs.readFileSync(arquivo);
  } catch (err) {
    throw new ErroIntegra(`Não encontrei o certificado do escritório (${arquivo}). Confira SERPRO_INTEGRA_CERT_PATH no .env.`, { httpStatus: 500 });
  }
  const senha = process.env.SERPRO_INTEGRA_CERT_SENHA;
  const forge = require('node-forge');
  let p12;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(pfx.toString('binary')), senha);
  } catch (err) {
    throw new ErroIntegra('Não consegui abrir o certificado do escritório: a senha (SERPRO_INTEGRA_CERT_SENHA) parece errada.', { httpStatus: 500 });
  }
  const chave = (p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || [])
    .concat(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || [])[0];
  const certs = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || []).map((b) => b.cert);
  if (!chave || !certs.length) throw new ErroIntegra('O arquivo do certificado do escritório não tem a chave privada.', { httpStatus: 500 });

  // O certificado do titular é o que tem "NOME:CNPJ" no nome comum
  const titular = certs.find((c) => /:\d{14}$/.test((c.subject.getField('CN') || {}).value || '')) || certs[0];
  const nomeComum = (titular.subject.getField('CN') || {}).value || '';
  const cnpj = (/:(\d{14})$/.exec(nomeComum) || [])[1] || null;
  const validade = titular.validity.notAfter;
  if (validade < new Date()) {
    throw new ErroIntegra(`O certificado do escritório venceu em ${validade.toLocaleDateString('pt-BR')}. Coloque o novo no .env.`, { httpStatus: 500 });
  }
  const contexto = {
    key: forge.pki.privateKeyToPem(chave.key),
    cert: [titular, ...certs.filter((c) => c !== titular)].map((c) => forge.pki.certificateToPem(c)).join('')
  };
  tls.createSecureContext(contexto); // falha aqui se algo estiver errado, antes de falar com o SERPRO
  certCache = { ...contexto, cnpj, titular: nomeComum.replace(/:\d+$/, ''), validade };
  return certCache;
}

function requisicao(url, { method = 'POST', headers = {}, corpo = '', cert = null, timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers: { ...headers, 'Content-Length': Buffer.byteLength(corpo) }, ...(cert ? { key: cert.key, cert: cert.cert } : {}), timeout }, (resp) => {
      const partes = [];
      resp.on('data', (d) => partes.push(d));
      resp.on('end', () => resolve({ status: resp.statusCode, headers: resp.headers, texto: Buffer.concat(partes).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(corpo);
  });
}

// Tokens (access_token + jwt_token) — reaproveitados até 1 minuto antes de vencer
let tokens = { access: null, jwt: null, expiraEm: 0 };

async function autenticar({ renovar = false } = {}) {
  if (!configurado()) throw new ErroIntegra('Integra Contador não configurado no .env.', { httpStatus: 503 });
  if (!renovar && tokens.access && Date.now() < tokens.expiraEm) return tokens;
  const cert = carregarCertificado();
  const basico = Buffer.from(`${process.env.SERPRO_INTEGRA_CONSUMER_KEY.trim()}:${process.env.SERPRO_INTEGRA_CONSUMER_SECRET.trim()}`).toString('base64');
  let resp;
  try {
    resp = await requisicao(AUTH_URL(), {
      headers: { Authorization: `Basic ${basico}`, 'Role-Type': 'TERCEIROS', 'Content-Type': 'application/x-www-form-urlencoded' },
      corpo: 'grant_type=client_credentials',
      cert,
      timeout: 30000
    });
  } catch (err) {
    throw new ErroIntegra('Não foi possível conectar ao SERPRO. Confira a internet do servidor.');
  }
  let dados = {};
  try { dados = JSON.parse(resp.texto); } catch (e) { /* resposta não-JSON */ }
  if (resp.status !== 200 || !dados.access_token || !dados.jwt_token) {
    throw new ErroIntegra(resp.status === 401
      ? 'O SERPRO recusou a entrada: confira as chaves do Integra Contador e se o certificado é o mesmo CNPJ do contrato.'
      : `O SERPRO não liberou a entrada (HTTP ${resp.status}).`);
  }
  tokens = { access: dados.access_token, jwt: dados.jwt_token, expiraEm: Date.now() + Math.max(60, (Number(dados.expires_in) || 1800) - 60) * 1000 };
  return tokens;
}

const soNumeros = (v) => String(v || '').replace(/\D/g, '');
const tipoDocumento = (numero) => (numero.length === 11 ? 1 : 2); // 1 = CPF, 2 = CNPJ

/**
 * Chama um serviço do Integra Contador em nome de um contribuinte (cliente).
 *   grupo: 'Apoiar' | 'Consultar' | 'Declarar' | 'Emitir' | 'Monitorar'
 *   contribuinte: CNPJ ou CPF do cliente
 *   idSistema / idServico / versaoSistema: do catálogo do SERPRO (ex: PGDASD / GERARDAS12 / '1.0')
 *   dados: objeto com os parâmetros do serviço (vai como texto JSON)
 * Devolve a resposta completa do SERPRO ({ status, dados, mensagens, ... }) com `dados` já convertido de texto JSON quando possível.
 */
async function chamar(grupo, { contribuinte, idSistema, idServico, versaoSistema = '1.0', dados = {} }) {
  if (!GRUPOS.includes(grupo)) throw new ErroIntegra(`Grupo inválido: ${grupo}`, { httpStatus: 500 });
  // Demonstração: responde com dados fictícios, sem SERPRO
  if (MODO_DEMO) return require('./integraDemo').responder(grupo, { contribuinte, idServico, dados });
  const cert = carregarCertificado();
  const escritorio = { numero: cert.cnpj, tipo: 2 };
  const doc = soNumeros(contribuinte);
  const corpo = JSON.stringify({
    contratante: escritorio,
    autorPedidoDados: escritorio,
    contribuinte: { numero: doc, tipo: tipoDocumento(doc) },
    pedidoDados: { idSistema, idServico, versaoSistema, dados: typeof dados === 'string' ? dados : JSON.stringify(dados) }
  });

  let t = await autenticar();
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    let resp;
    try {
      resp = await requisicao(`${API_URL()}/${grupo}`, {
        headers: { Authorization: `Bearer ${t.access}`, jwt_token: t.jwt, 'Content-Type': 'application/json', Accept: 'application/json' },
        corpo
      });
    } catch (err) {
      throw new ErroIntegra('O SERPRO não respondeu a tempo. Tente de novo em alguns minutos.');
    }
    if (resp.status === 401 && tentativa === 0) { t = await autenticar({ renovar: true }); continue; }
    // 204/304 vêm sem corpo: a informação está nos headers (ex: ETag do SITFIS)
    if ((resp.status === 204 || resp.status === 304) && !resp.texto.trim()) return { status: resp.status, dados: null, mensagens: [], headers: resp.headers };
    let r = null;
    try { r = JSON.parse(resp.texto); } catch (e) { /* não-JSON */ }
    if (resp.status === 403) {
      throw new ErroIntegra(/900908|Subscription/i.test(resp.texto)
        ? 'O contrato do Integra Contador não libera esta função.'
        : 'O SERPRO bloqueou o acesso.', { httpStatus: 502 });
    }
    if (!r) throw new ErroIntegra(`Resposta inesperada do SERPRO (HTTP ${resp.status}).`);
    if (typeof r.dados === 'string' && r.dados) { try { r.dados = JSON.parse(r.dados); } catch (e) { /* fica texto */ } }
    if (resp.status >= 400) {
      const msgs = (r.mensagens || []).map((m) => `${m.codigo ? m.codigo + ' ' : ''}${m.texto || ''}`.trim()).filter(Boolean);
      const erro = new ErroIntegra(msgs.length ? msgs.join(' | ') : `O SERPRO devolveu erro (HTTP ${resp.status}).`, { httpStatus: resp.status === 400 ? 400 : 502, mensagens: r.mensagens });
      erro.statusSerpro = resp.status;
      erro.dados = r.dados;
      throw erro;
    }
    r.status = r.status || resp.status;
    r.headers = resp.headers;
    return r;
  }
  throw new ErroIntegra('O SERPRO recusou o acesso mesmo com um token novo.');
}

/** Informações do certificado (sem nada secreto) — para mostrar em tela/diagnóstico. */
function infoCertificado() {
  if (MODO_DEMO) return { titular: 'ESCRITÓRIO DE DEMONSTRAÇÃO', cnpj: '00000000000000', validade: null };
  const c = carregarCertificado();
  return { titular: c.titular, cnpj: c.cnpj, validade: c.validade };
}

module.exports = { configurado, autenticar, chamar, infoCertificado, ErroIntegra, GRUPOS };
