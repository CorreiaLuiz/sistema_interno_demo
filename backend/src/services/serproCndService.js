/**
 * API "Consulta CND" do SERPRO — certidão de débitos FEDERAIS (Receita + PGFN).
 * Documentação: https://www.gov.br/conecta/catalogo/apis/consultar-certidao-negativa-de-debito
 *
 * Cada consulta é cobrada pelo SERPRO (respostas HTTP 200 e 201). Por isso a
 * consulta só acontece quando alguém clica em "Buscar" — nunca automática.
 * Os status 5 e 6 (instabilidade do lado deles) não são cobrados e são
 * repetidos uma vez; o status 7 ("em processamento") é cobrado só na primeira
 * chamada — as repetições com a "Chave" são grátis.
 *
 * Configuração no backend/.env:
 *   SERPRO_CND_CONSUMER_KEY / SERPRO_CND_CONSUMER_SECRET  (Área do Cliente do SERPRO)
 *   SERPRO_TOKEN_URL e SERPRO_CND_URL — opcionais, já vêm com os endereços de produção.
 */

const TOKEN_URL = () => process.env.SERPRO_TOKEN_URL || 'https://gateway.apiserpro.serpro.gov.br/token';
const CND_URL = () => process.env.SERPRO_CND_URL || 'https://gateway.apiserpro.serpro.gov.br/consulta-cnd/v1/certidao';

const MENSAGENS_STATUS = {
  1: 'Certidão encontrada (já estava emitida e válida).',
  2: 'Certidão emitida agora.',
  3: 'Certidão não emitida — existem pendências na Receita Federal ou na PGFN.',
  4: 'Certidão não emitida — situação cadastral impeditiva.',
  5: 'O SERPRO teve uma inconsistência na análise. Tente de novo em instantes (não foi cobrado).',
  6: 'Uma base da Receita está fora do ar agora. Tente de novo mais tarde (não foi cobrado).',
  8: 'CNPJ não cadastrado na Receita Federal.',
  9: 'Faltou informação na consulta.',
  10: 'Tipo de contribuinte inválido.',
  11: 'CNPJ inválido.',
  12: 'Código de identificação inválido.',
  13: 'A consulta demorou demais e expirou. Tente de novo.',
  14: 'A consulta demorou demais e expirou. Tente de novo.',
  99: 'Erro no servidor do SERPRO. Tente de novo mais tarde.'
};

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const { MODO_DEMO } = require('../config/demo');

function configurado() {
  if (MODO_DEMO) return true;
  return Boolean(process.env.SERPRO_CND_CONSUMER_KEY && process.env.SERPRO_CND_CONSUMER_SECRET);
}

class ErroSerpro extends Error {
  constructor(mensagem, { status = null, httpStatus = 502 } = {}) {
    super(mensagem);
    this.statusSerpro = status;
    this.httpStatus = httpStatus;
  }
}

// Token de acesso (vale ~1 hora) — reaproveitado entre consultas
let tokenCache = { valor: null, expiraEm: 0 };

async function obterToken({ renovar = false } = {}) {
  if (!renovar && tokenCache.valor && Date.now() < tokenCache.expiraEm) return tokenCache.valor;
  const basico = Buffer.from(`${process.env.SERPRO_CND_CONSUMER_KEY}:${process.env.SERPRO_CND_CONSUMER_SECRET}`).toString('base64');
  let resp;
  try {
    resp = await fetch(TOKEN_URL(), {
      method: 'POST',
      headers: { Authorization: `Basic ${basico}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(20000)
    });
  } catch (err) {
    throw new ErroSerpro('Não foi possível conectar ao SERPRO. Confira a internet do servidor.');
  }
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok || !dados.access_token) {
    throw new ErroSerpro(resp.status === 401
      ? 'O SERPRO recusou as chaves (Consumer Key/Secret). Confira SERPRO_CND_CONSUMER_KEY e SERPRO_CND_CONSUMER_SECRET no .env.'
      : `O SERPRO não liberou o acesso (HTTP ${resp.status}).`);
  }
  // Renova 2 minutos antes de vencer
  tokenCache = { valor: dados.access_token, expiraEm: Date.now() + Math.max(60, (Number(dados.expires_in) || 3600) - 120) * 1000 };
  return tokenCache.valor;
}

async function chamarApi(corpo) {
  let token = await obterToken();
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    let resp;
    try {
      resp = await fetch(CND_URL(), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(corpo),
        signal: AbortSignal.timeout(60000)
      });
    } catch (err) {
      throw new ErroSerpro('O SERPRO não respondeu a tempo. Tente de novo em alguns minutos.');
    }
    // Token vencido: pega outro e tenta uma vez
    if (resp.status === 401 && tentativa === 0) {
      const texto = await resp.text().catch(() => '');
      if (/limite|plano/i.test(texto)) throw new ErroSerpro('O plano de consumo do SERPRO atingiu o limite. Veja na Área do Cliente do SERPRO.');
      token = await obterToken({ renovar: true });
      continue;
    }
    if (resp.status === 403) {
      const texto = await resp.text().catch(() => '');
      // 900908 = as chaves são de outro produto do SERPRO (ex: Integra Contador), não da "Consulta CND"
      throw new ErroSerpro(/900908|Subscription/i.test(texto)
        ? 'As chaves do .env não são do produto "Consulta CND" do SERPRO (parecem ser de outro produto, como o Integra Contador). É preciso contratar a Consulta CND e usar as chaves dela.'
        : 'O SERPRO bloqueou o acesso a partir deste computador (IP não autorizado).');
    }
    if (resp.status === 504) throw new ErroSerpro('O SERPRO demorou demais para responder. Tente de novo em alguns minutos.');
    const dados = await resp.json().catch(() => null);
    if (!dados || dados.Status === undefined) throw new ErroSerpro(`Resposta inesperada do SERPRO (HTTP ${resp.status}).`);
    return dados;
  }
  throw new ErroSerpro('O SERPRO recusou o acesso mesmo com um token novo.');
}

/**
 * Consulta (e, se possível, emite) a CND federal de um CNPJ.
 * Devolve { situacao: 'regular'|'pendencia', statusSerpro, mensagem,
 *           codigoControle, dataEmissao, dataValidade, tipoCertidao, pdf (Buffer|null) }.
 * Lança ErroSerpro quando não houve resposta conclusiva.
 */
async function consultarCndFederal(cnpj) {
  if (MODO_DEMO) return cndDemonstracao(cnpj);
  if (!configurado()) {
    throw new ErroSerpro('A consulta de CND Federal ainda não está configurada: faltam as chaves do SERPRO no .env.', { httpStatus: 503 });
  }
  const digitos = String(cnpj || '').replace(/\D/g, '');
  if (digitos.length !== 14) throw new ErroSerpro('CNPJ da empresa inválido.', { httpStatus: 400 });

  const corpo = { TipoContribuinte: 1, ContribuinteConsulta: digitos, CodigoIdentificacao: '9201', GerarCertidaoPdf: true };
  let dados = await chamarApi(corpo);

  // 5/6: instabilidade do SERPRO (não cobrado) — repete uma vez
  if (dados.Status === 5 || dados.Status === 6) {
    await esperar(1500);
    dados = await chamarApi(corpo);
  }
  // 7: em processamento — repete com a chave (repetições não são cobradas)
  for (let n = 0; dados.Status === 7 && n < 12; n++) {
    await esperar(n < 4 ? 1000 : 3000);
    dados = await chamarApi({ ...corpo, Chave: dados.Chave });
  }

  const mensagem = MENSAGENS_STATUS[dados.Status] || dados.Mensagem || `Status ${dados.Status}`;
  if (dados.Status === 1 || dados.Status === 2) {
    const c = dados.Certidao || {};
    return {
      situacao: 'regular',
      statusSerpro: dados.Status,
      mensagem,
      codigoControle: c.CodigoControle || null,
      tipoCertidao: c.TipoCertidao ?? null,
      dataEmissao: c.DataEmissao ? String(c.DataEmissao).slice(0, 10) : null,
      dataValidade: c.DataValidade ? String(c.DataValidade).slice(0, 10) : null,
      pdf: c.DocumentoPdf ? Buffer.from(c.DocumentoPdf, 'base64') : null
    };
  }
  if (dados.Status === 3 || dados.Status === 4) {
    return { situacao: 'pendencia', statusSerpro: dados.Status, mensagem, codigoControle: null, tipoCertidao: null, dataEmissao: null, dataValidade: null, pdf: null };
  }
  if (dados.Status === 7) {
    throw new ErroSerpro('A Receita ainda está processando esta certidão. Tente de novo em alguns minutos.', { status: 7 });
  }
  throw new ErroSerpro(mensagem, { status: dados.Status, httpStatus: [8, 9, 10, 11, 12].includes(dados.Status) ? 400 : 502 });
}

/**
 * Demonstração: não chama o SERPRO. CNPJs terminados em 9 saem "com pendência";
 * os demais saem "regulares", com um PDF fictício.
 */
async function cndDemonstracao(cnpj) {
  const digitos = String(cnpj || '').replace(/\D/g, '');
  if (digitos.length !== 14) throw new ErroSerpro('CNPJ da empresa inválido.', { httpStatus: 400 });
  await esperar(1200);
  if (digitos[13] === '9') {
    return { situacao: 'pendencia', statusSerpro: 3, mensagem: MENSAGENS_STATUS[3], codigoControle: null, tipoCertidao: null, dataEmissao: null, dataValidade: null, pdf: null };
  }
  const { pdfTexto } = require('../demo/pdf');
  const hoje = new Date();
  const validade = new Date(hoje.getTime() + 180 * 86400000);
  const iso = (d) => d.toISOString().slice(0, 10);
  const br = (d) => d.toLocaleDateString('pt-BR');
  const codigo = `${digitos.slice(0, 4)}.${digitos.slice(4, 8)}.DEMO.${String(hoje.getDate()).padStart(2, '0')}${String(hoje.getMonth() + 1).padStart(2, '0')}`;
  const pdf = pdfTexto([
    { texto: 'MINISTÉRIO DA FAZENDA', negrito: true, tamanho: 13 },
    'Secretaria da Receita Federal do Brasil / Procuradoria-Geral da Fazenda Nacional',
    '',
    { texto: 'CERTIDÃO NEGATIVA DE DÉBITOS RELATIVOS AOS TRIBUTOS FEDERAIS', negrito: true, tamanho: 12 },
    { texto: 'E À DÍVIDA ATIVA DA UNIÃO', negrito: true, tamanho: 12 },
    '',
    `CNPJ: ${digitos.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')}`,
    '',
    'Não constam pendências em seu nome relativas a créditos tributários administrados',
    'pela Secretaria da Receita Federal do Brasil (RFB) e a inscrições em Dívida Ativa da União.',
    '',
    `Emitida em ${br(hoje)}. Válida até ${br(validade)}.`,
    `Código de controle da certidão: ${codigo}`
  ]);
  return { situacao: 'regular', statusSerpro: 2, mensagem: MENSAGENS_STATUS[2], codigoControle: codigo, tipoCertidao: 1, dataEmissao: iso(hoje), dataValidade: iso(validade), pdf };
}

module.exports = { consultarCndFederal, configurado, ErroSerpro };
