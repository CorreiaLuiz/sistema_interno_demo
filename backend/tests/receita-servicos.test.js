// DAS da Receita, relatório de situação fiscal (SITFIS) e Caixa Postal.
// A chamada ao SERPRO é trocada por uma de mentira: sem internet e sem custo.
const test = require('node:test');
const assert = require('node:assert/strict');
const integra = require('../src/services/integraContadorService');
const { gerarDas } = require('../src/services/dasReceitaService');
const { analisarRelatorio } = require('../src/services/sitfisService');
const caixaPostal = require('../src/services/caixaPostalService');
const { pdfDas } = require('./ajudantes');

/** Substitui integra.chamar durante o teste; devolve a lista de pedidos feitos. */
function simularChamar(t, responder) {
  const pedidos = [];
  const original = integra.chamar;
  integra.chamar = async (grupo, pedido) => { pedidos.push({ grupo, ...pedido }); return responder(grupo, pedido); };
  t.after(() => { integra.chamar = original; });
  return pedidos;
}

const PDF = pdfDas({ cnpj: '78.966.782/0001-05', razao: 'EMPRESA TESTE', mes: 'setembro/2026', venc: '20/10/2026', valor: '10,00', numero: '1' });

// ---------------- DAS ----------------
test('DAS: Simples usa PGDASD/GERARDAS12 e MEI usa PGMEI/GERARDASPDF21', async (t) => {
  const pedidos = simularChamar(t, async () => ({ dados: [{ pdf: PDF.toString('base64') }] }));
  const pdf1 = await gerarDas({ cnpj: '78966782000105', regime: 'simples_nacional', periodo: '2026-09' });
  const pdf2 = await gerarDas({ cnpj: '78966782000105', regime: 'mei', periodo: '202609' });
  assert.ok(pdf1.subarray(0, 5).equals(Buffer.from('%PDF-')) && pdf2.length === PDF.length);
  assert.deepEqual([pedidos[0].grupo, pedidos[0].idSistema, pedidos[0].idServico], ['Emitir', 'PGDASD', 'GERARDAS12']);
  assert.deepEqual([pedidos[1].idSistema, pedidos[1].idServico], ['PGMEI', 'GERARDASPDF21']);
  assert.deepEqual(pedidos[0].dados, { periodoApuracao: '202609' });
});

test('DAS: mês inválido é recusado sem chamar a Receita', async (t) => {
  const pedidos = simularChamar(t, async () => ({}));
  for (const periodo of ['2026-13', '2026', '', 'abc']) {
    await assert.rejects(gerarDas({ cnpj: '1', regime: 'simples_nacional', periodo }), /Mês inválido/);
  }
  assert.equal(pedidos.length, 0);
});

test('DAS: sem PDF na resposta, mostra o motivo da Receita; arquivo que não é PDF é recusado', async (t) => {
  simularChamar(t, async () => ({ dados: [], mensagens: [{ texto: 'Não existe declaração para o período.' }] }));
  await assert.rejects(gerarDas({ cnpj: '1', regime: 'simples_nacional', periodo: '2026-09' }), /Não existe declaração/);
  integra.chamar = async () => ({ dados: [{ pdf: Buffer.from('não sou pdf').toString('base64') }] });
  await assert.rejects(gerarDas({ cnpj: '1', regime: 'simples_nacional', periodo: '2026-09' }), /não é PDF/);
});

// ---------------- Relatório de situação fiscal ----------------
const LINHA = '_'.repeat(20);
const relatorio = (miolo) => `INFORMAÇÕES DE APOIO PARA EMISSÃO DE CERTIDÃO CNPJ: 78.966.782 - EMPRESA TESTE ${miolo}
  ${LINHA} Diagnóstico Fiscal na Procuradoria-Geral da Fazenda Nacional ${LINHA}
  Não foram detectadas pendências/exigibilidades suspensas para esse contribuinte nos controles da Procuradoria-Geral da Fazenda Nacional. Final do Relatório`;

test('situação fiscal: sem pendências, lê a certidão emitida e os débitos suspensos', () => {
  const a = analisarRelatorio(relatorio(`Certidão Emitida ${LINHA} CNPJ: 78.966.782/0001-05
    Certidão Positiva com Efeitos de Negativa: 081D.57A1.73C4.611B Emissão: 05/10/2026 Data de Validade: 03/04/2027
    ${LINHA} Diagnóstico Fiscal na Receita Federal ${LINHA} Débito com Exigibilidade Suspensa (SIEF) ${LINHA} 1082-01 - CP-SEGUR.`));
  assert.equal(a.situacao, 'regular');
  assert.deepEqual(a.certidao, { tipo: 'Certidão Positiva com Efeitos de Negativa', codigo: '081D.57A1.73C4.611B', emissao: '2026-10-05', validade: '2027-04-03' });
  assert.deepEqual(a.pendencias, []);
  assert.deepEqual(a.suspensos, ['Débito com Exigibilidade Suspensa (SIEF)']);
  assert.equal(a.pgfnSemPendencias, true);
});

test('situação fiscal: seções "Pendência - ..." deixam a empresa com pendências', () => {
  const a = analisarRelatorio(relatorio(`${LINHA} Diagnóstico Fiscal na Receita Federal ${LINHA}
    Pendência - Débito (SIEF) ${LINHA} 1001 IRPJ  Pendência - Omissão de DCTF ${LINHA} 2025`));
  assert.equal(a.situacao, 'pendencia');
  assert.deepEqual(a.pendencias, ['Débito (SIEF)', 'Omissão de DCTF']);
  assert.equal(a.certidao, null);
});

test('situação fiscal: texto vazio ou estranho fica "indefinida" (conferir o PDF)', () => {
  assert.equal(analisarRelatorio('').situacao, 'indefinida');
  assert.equal(analisarRelatorio('qualquer coisa').situacao, 'indefinida');
});

// ---------------- Caixa Postal ----------------
test('Caixa Postal: indicador de mensagens novas', async (t) => {
  simularChamar(t, async () => ({ dados: { codigo: '00', conteudo: [{ indicadorMensagensNovas: '2' }] } }));
  assert.equal(await caixaPostal.indicador('78966782000105'), 2);
});

test('Caixa Postal: lista só os assuntos, montando a variável e as datas', async (t) => {
  const pedidos = simularChamar(t, async () => ({
    dados: { codigo: '00', conteudo: [{ indicadorUltimaPagina: 'N', listaMensagens: [
      { isn: 123, assuntoModelo: '[e-Processo] Protocolo nº ++VARIAVEL++ - Resultado', valorParametroAssunto: '555', dataEnvio: '20261015', dataCiencia: '20261030', relevancia: '2', descricaoOrigem: 'RECEITA FEDERAL', indicadorAnexos: '1' }
    ] }] }
  }));
  const { mensagens, haMais } = await caixaPostal.naoLidas('78966782000105');
  assert.equal(pedidos[0].idServico, 'MSGCONTRIBUINTE61');
  assert.equal(pedidos[0].dados.statusLeitura, '2', 'pede só as NÃO lidas');
  assert.equal(haMais, true);
  assert.deepEqual(mensagens[0], { isn: '123', assunto: '[e-Processo] Protocolo nº 555 - Resultado', enviada_em: '2026-10-15', ciencia_em: '2026-10-30', relevante: true, origem: 'RECEITA FEDERAL', anexos: true });
});

test('Caixa Postal: abrir monta o texto com as variáveis do corpo', async (t) => {
  simularChamar(t, async () => ({ dados: { codigo: '00', conteudo: [{ isn: 9, assuntoModelo: 'Aviso', corpoModelo: '<p>Exercício ++1++ em ++2++</p>', variaveis: ['2026', 'link'] }] } }));
  const m = await caixaPostal.detalhar('78966782000105', '9');
  assert.equal(m.corpo_html, '<p>Exercício 2026 em link</p>');
  assert.equal(m.assunto, 'Aviso');
});
