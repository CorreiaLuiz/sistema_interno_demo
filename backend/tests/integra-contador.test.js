// Integra Contador (SERPRO): certificado do escritório, entrada (token) e chamadas.
// O SERPRO é SIMULADO — nada sai pela internet e nada é cobrado.
const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('https');
const { EventEmitter } = require('events');
const { gerarPfx, carregarLimpo } = require('./ajudantes');

const SERVICO = '../src/services/integraContadorService';
const pfxValido = gerarPfx({ senha: 'senha-certa' });

function configurar(extra = {}) {
  Object.assign(process.env, {
    SERPRO_INTEGRA_CONSUMER_KEY: 'chave-teste', SERPRO_INTEGRA_CONSUMER_SECRET: 'segredo-teste',
    SERPRO_INTEGRA_CERT_PATH: pfxValido, SERPRO_INTEGRA_CERT_SENHA: 'senha-certa',
    SERPRO_INTEGRA_AUTH_URL: 'https://serpro.teste/authenticate', SERPRO_INTEGRA_URL: 'https://serpro.teste/integra-contador/v1'
  }, extra);
  return carregarLimpo(SERVICO);
}

/** Troca o https.request por um SERPRO de mentira. `respostas` = lista de { status, corpo, headers }. */
function simularSerpro(t, respostas) {
  const pedidos = [];
  const original = https.request;
  https.request = (url, opcoes, aoResponder) => {
    const req = new EventEmitter();
    req.destroy = () => {};
    req.end = (corpo) => {
      pedidos.push({ url: String(url), opcoes, corpo: corpo || '' });
      const r = respostas.shift() || { status: 500, corpo: '{}' };
      const resp = new EventEmitter();
      resp.statusCode = r.status;
      resp.headers = r.headers || {};
      aoResponder(resp);
      process.nextTick(() => { resp.emit('data', Buffer.from(typeof r.corpo === 'string' ? r.corpo : JSON.stringify(r.corpo))); resp.emit('end'); });
    };
    return req;
  };
  t.after(() => { https.request = original; });
  return pedidos;
}

const TOKEN_OK = { status: 200, corpo: { access_token: 'acesso-1', jwt_token: 'jwt-1', expires_in: 2008 } };

test('certificado: lê o CNPJ do titular de um .pfx no formato antigo', () => {
  const integra = configurar();
  assert.equal(integra.configurado(), true);
  const info = integra.infoCertificado();
  assert.equal(info.cnpj, '78966782000105');
  assert.equal(info.titular, 'EMPRESA TESTE LTDA');
});

test('certificado: senha errada, arquivo sumido e certificado vencido dão mensagem clara', () => {
  assert.throws(() => configurar({ SERPRO_INTEGRA_CERT_SENHA: 'senha-errada' }).infoCertificado(), /senha/i);
  assert.throws(() => configurar({ SERPRO_INTEGRA_CERT_PATH: 'nao/existe.pfx' }).infoCertificado(), /Não encontrei o certificado/);
  const vencido = gerarPfx({ senha: 'x', venceEmDias: -5 });
  assert.throws(() => configurar({ SERPRO_INTEGRA_CERT_PATH: vencido, SERPRO_INTEGRA_CERT_SENHA: 'x' }).infoCertificado(), /venceu/);
});

test('sem as chaves no .env, não está configurado', () => {
  const integra = configurar({ SERPRO_INTEGRA_CONSUMER_KEY: '' });
  assert.equal(integra.configurado(), false);
});

test('chamada: entra com certificado + Role-Type e manda os dois tokens e o escritório como contratante', async (t) => {
  const integra = configurar();
  const pedidos = simularSerpro(t, [TOKEN_OK, { status: 200, corpo: { status: 200, mensagens: [], dados: '{"codigo":"00","conteudo":[{"indicadorMensagensNovas":"1"}]}' } }]);
  const r = await integra.chamar('Monitorar', { contribuinte: '98.765.432/0001-10', idSistema: 'CAIXAPOSTAL', idServico: 'INNOVAMSG63', dados: '' });

  const [entrada, chamada] = pedidos;
  assert.match(entrada.url, /authenticate$/);
  assert.equal(entrada.opcoes.headers['Role-Type'], 'TERCEIROS');
  assert.ok(entrada.opcoes.key && entrada.opcoes.cert, 'a entrada usa o certificado do escritório');
  assert.equal(entrada.opcoes.headers.Authorization, `Basic ${Buffer.from('chave-teste:segredo-teste').toString('base64')}`);

  assert.match(chamada.url, /\/Monitorar$/);
  assert.equal(chamada.opcoes.headers.Authorization, 'Bearer acesso-1');
  assert.equal(chamada.opcoes.headers.jwt_token, 'jwt-1');
  const corpo = JSON.parse(chamada.corpo);
  assert.deepEqual(corpo.contratante, { numero: '78966782000105', tipo: 2 });
  assert.deepEqual(corpo.contribuinte, { numero: '98765432000110', tipo: 2 });
  assert.equal(corpo.pedidoDados.dados, '');
  assert.equal(r.dados.conteudo[0].indicadorMensagensNovas, '1', 'o "dados" em texto vira objeto');
});

test('chamada: CPF vai como tipo 1 e o token é reaproveitado', async (t) => {
  const integra = configurar();
  const pedidos = simularSerpro(t, [TOKEN_OK, { status: 200, corpo: { dados: '' } }, { status: 200, corpo: { dados: '' } }]);
  await integra.chamar('Consultar', { contribuinte: '123.456.789-09', idSistema: 'X', idServico: 'Y', dados: { a: 1 } });
  await integra.chamar('Consultar', { contribuinte: '123.456.789-09', idSistema: 'X', idServico: 'Y', dados: { a: 1 } });
  assert.equal(pedidos.length, 3, 'só uma entrada para duas chamadas');
  assert.deepEqual(JSON.parse(pedidos[1].corpo).contribuinte, { numero: '12345678909', tipo: 1 });
  assert.equal(JSON.parse(pedidos[1].corpo).pedidoDados.dados, '{"a":1}');
});

test('chamada: token vencido (401) pega outro e tenta de novo', async (t) => {
  const integra = configurar();
  const pedidos = simularSerpro(t, [TOKEN_OK, { status: 401, corpo: '' }, { status: 200, corpo: { access_token: 'acesso-2', jwt_token: 'jwt-2' } }, { status: 200, corpo: { dados: '' } }]);
  await integra.chamar('Consultar', { contribuinte: '98765432000110', idSistema: 'X', idServico: 'Y' });
  assert.equal(pedidos.length, 4);
  assert.equal(pedidos[3].opcoes.headers.Authorization, 'Bearer acesso-2');
});

test('erros do SERPRO viram mensagens em português', async (t) => {
  let integra = configurar();
  simularSerpro(t, [TOKEN_OK, { status: 403, corpo: { code: '900908', description: 'API Subscription validation failed.' } }]);
  await assert.rejects(integra.chamar('Emitir', { contribuinte: '98765432000110', idSistema: 'X', idServico: 'Y' }), /contrato do Integra Contador não libera/);

  integra = configurar();
  simularSerpro(t, [TOKEN_OK, { status: 400, corpo: { mensagens: [{ codigo: 'EntradaIncorreta-X', texto: 'Campo errado' }] } }]);
  await assert.rejects(integra.chamar('Emitir', { contribuinte: '98765432000110', idSistema: 'X', idServico: 'Y' }), (err) => err.httpStatus === 400 && /Campo errado/.test(err.message));

  integra = configurar();
  simularSerpro(t, [{ status: 401, corpo: '' }]);
  await assert.rejects(integra.autenticar(), /recusou a entrada/);
});

test('respostas 204/304 sem corpo devolvem os cabeçalhos (usados pelo relatório fiscal)', async (t) => {
  const integra = configurar();
  simularSerpro(t, [TOKEN_OK, { status: 304, corpo: '', headers: { etag: '"protocoloRelatorio:ABC"' } }]);
  const r = await integra.chamar('Apoiar', { contribuinte: '98765432000110', idSistema: 'SITFIS', idServico: 'SOLICITARPROTOCOLO91' });
  assert.equal(r.status, 304);
  assert.equal(r.headers.etag, '"protocoloRelatorio:ABC"');
});
