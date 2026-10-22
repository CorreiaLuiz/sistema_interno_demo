// Funções pequenas usadas no sistema todo: status de vencimento, telefone do
// WhatsApp, valores de extrato e leitura do PDF de guia.
const test = require('node:test');
const assert = require('node:assert/strict');
const Certidao = require('../src/models/Certidao');
const Licenca = require('../src/models/Licenca');
const { formatarNumeroWhatsapp } = require('../src/services/notificacaoService');
const { numero } = require('../src/services/leitorOfx');
const { lerGuia } = require('../src/services/leitorGuias');
const { pdfDas } = require('./ajudantes');

const daquiA = (dias) => { const d = new Date(); d.setDate(d.getDate() + dias); return d.toISOString().slice(0, 10); };

for (const [nome, Modelo] of [['Certidão', Certidao], ['Licença', Licenca]]) {
  test(`${nome}: status pela data de validade`, () => {
    assert.equal(Modelo.calcularStatus(null), 'emissao_pendente');
    assert.equal(Modelo.calcularStatus(daquiA(-1)), 'vencida');
    assert.equal(Modelo.calcularStatus(daquiA(10)), 'a_vencer');
    assert.equal(Modelo.calcularStatus(daquiA(29)), 'a_vencer');
    assert.equal(Modelo.calcularStatus(daquiA(90)), 'valida');
  });
}

test('telefone do WhatsApp: põe o 55 só quando falta', () => {
  assert.equal(formatarNumeroWhatsapp('(46) 99999-1234'), '5546999991234');
  assert.equal(formatarNumeroWhatsapp('46 3524-0000'), '554635240000');
  assert.equal(formatarNumeroWhatsapp('5546999991234'), '5546999991234');
  assert.equal(formatarNumeroWhatsapp(''), null);
  assert.equal(formatarNumeroWhatsapp(null), null);
});

test('valor de extrato OFX: vírgula ou ponto, sinal e "R$"', () => {
  assert.equal(numero('1.234,56'), 1234.56);
  assert.equal(numero('1,234.56'), 1234.56);
  assert.equal(numero('-50,00'), -50);
  assert.equal(numero('R$ 10,00'), 10);
  assert.equal(numero(''), null);
});

test('leitor de guias: lê CNPJ, mês, vencimento e valor de um DAS', async () => {
  const pdf = pdfDas({ cnpj: '78.966.782/0001-05', razao: 'EMPRESA TESTE LTDA', mes: 'setembro/2026', venc: '20/10/2026', valor: '1.234,56', numero: '07.20.26289.0000000-1' });
  const lido = await lerGuia(pdf);
  assert.equal(lido.tipo, 'DAS');
  assert.equal(lido.cnpj, '78966782000105');
  assert.equal(lido.competencia, '2026-09');
  assert.equal(lido.vencimento, '2026-10-20');
  assert.equal(lido.valor, 1234.56);
});
