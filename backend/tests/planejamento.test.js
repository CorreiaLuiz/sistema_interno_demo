// Testes das regras puras do planejamento tributário (sem banco e sem Domínio).
// Rodar: npm test
const test = require('node:test');
const assert = require('node:assert');
const { simplesEfetiva, calcular } = require('../src/services/planejamento/motor');
const { recomendar } = require('../src/services/planejamento/parecer');
const { validarRespostas } = require('../src/services/planejamento');
const parametros = require('../src/services/planejamento/parametros.json');

const perto = (a, b, tol = 1e-4) => assert.ok(Math.abs(a - b) <= tol, `${a} deveria ser ~${b}`);

test('Simples: Anexo I na 1ª faixa é 4%, e sem o ICMS (venda com ST) cai para 2,64%', () => {
  perto(simplesEfetiva(1, 150000).efetiva, 0.04);
  perto(simplesEfetiva(1, 150000, { semICMS: true }).efetiva, 0.0264);
});

test('Simples: Anexo III com RBT12 de R$ 248.380 dá ~7,43% (validado contra o Domínio)', () => {
  const s = simplesEfetiva(3, 248380);
  assert.strictEqual(s.faixa, 2);
  perto(s.efetiva, (248380 * 0.112 - 9360) / 248380);
});

/** Empresa de serviço fictícia: 12 meses de R$ 20 mil, pró-labore e distribuição de lucros. */
function dadosServico() {
  const meses = Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, '0')}`);
  return {
    periodo: { inicio: '2025-01', fim: '2025-12' },
    empresa: { codi: 1, nome: 'TESTE SERVICOS LTDA', cnpj: '71584922000131', uf: 'PR' },
    regime: { rfed: 2, simples_optante: 'S' },
    receitas: meses.map((mes) => ({ mes, cfop: 0, origem: 'servico', valor: 20000 })),
    receita_anterior: [],
    simples: meses.map((mes) => ({ mes, anexo: 3, aliquota: 8.0 })),
    folha: meses.flatMap((mes) => [
      { mes, pessoa: 1, tipo: 11, vinculo: 11, proventos: 3000 },
      { mes, pessoa: 1, tipo: 70, vinculo: 11, proventos: 15000 } // distribuição de lucros
    ]),
    compras: [],
    dre: []
  };
}

test('Motor: distribuição de lucros (processo 70) fica fora da folha e do Fator R', () => {
  const r = calcular({ dados: dadosServico(), parametros });
  assert.strictEqual(r.base_anual.rbt12, 240000);
  assert.strictEqual(r.base_anual.pro_labore, 36000);
  perto(r.base_anual.fator_r, 36000 / 240000);
  assert.strictEqual(r.simples.anexo_servico, 3);
});

test('Motor: Simples x Presumido para serviço de R$ 240 mil/ano com ISS de 5%', () => {
  const r = calcular({ dados: dadosServico(), parametros });
  const [simples, presumido] = r.regimes_2026;
  perto(simples.total, 240000 * simplesEfetiva(3, 240000).efetiva, 0.01);
  // Presumido: IRPJ 15% e CSLL 9% sobre 32%, PIS/COFINS 3,65%, ISS 5%, INSS 20% do pró-labore
  const esperado = 240000 * 0.32 * 0.15 + 240000 * 0.32 * 0.09 + 240000 * 0.0365 + 240000 * 0.05 + 36000 * 0.2;
  perto(presumido.total, esperado, 0.01);
  assert.strictEqual(r.melhor_2026.regime, 'Simples Nacional (atual)');
});

test('Motor: sem contabilidade e sem questionário, o Lucro Real fica sem cálculo e com alerta', () => {
  const r = calcular({ dados: dadosServico(), parametros });
  assert.strictEqual(r.regimes_2026[2].total, null);
  assert.ok(r.alertas.some((a) => /Lucro Real não calculado/.test(a)));
});

test('Motor: com a margem do questionário o Lucro Real é calculado', () => {
  const r = calcular({ dados: dadosServico(), parametros, respostas: { margem_estimada_pct: 20, publico: 'Metade/metade' } });
  assert.ok(r.regimes_2026[2].total > 0);
  perto(r.base_anual.lucro_antes_ir_real, 48000, 0.01);
});

/** Comércio que comprou mais do que vendeu no ano (formou estoque), com DRE sem CMV. */
function dadosComercioComEstoque() {
  const meses = Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, '0')}`);
  return {
    periodo: { inicio: '2025-01', fim: '2025-12' },
    empresa: { codi: 2, nome: 'TESTE COMERCIO LTDA', cnpj: '76202032000131', uf: 'PR' },
    regime: { rfed: 2, simples_optante: 'S' },
    receitas: meses.map((mes) => ({ mes, cfop: 5102, origem: 'saida', valor: 100000 })),
    receita_anterior: [],
    simples: meses.map((mes) => ({ mes, anexo: 1, aliquota: 10.7 })),
    folha: meses.map((mes) => ({ mes, pessoa: 1, tipo: 11, vinculo: 1, proventos: 10000 })),
    compras: meses.map((mes) => ({ mes, cfop: 1102, valor: 130000 })),
    dre: [
      { grupo: '411', saldo: 1200000, movimentos: 12, meses: 12 },
      { grupo: '322', saldo: -100000, movimentos: 12, meses: 12 },
      { grupo: '513', saldo: -1000, movimentos: 1, meses: 1 } // CMV não lançado
    ]
  };
}

test('Motor: lucro estimado pelas compras (prejuízo falso) não deixa o Lucro Real ser recomendado', () => {
  const r = calcular({ dados: dadosComercioComEstoque(), parametros });
  assert.ok(r.base_anual.lucro_antes_ir_real < 0);
  assert.strictEqual(r.regimes_2026[2].na_recomendacao, false);
  assert.notStrictEqual(r.melhor_2026.regime, 'Lucro Real');
  assert.ok(r.alertas.some((a) => /Lucro Real fora da recomendação/.test(a)));
});

test('Motor: com margem informada (positiva) o Lucro Real volta a valer na recomendação', () => {
  const p = { ...parametros, ajustes_empresa: { '76202032000131': { margem_lucro: 0.05 } } };
  const r = calcular({ dados: dadosComercioComEstoque(), parametros: p });
  assert.strictEqual(r.regimes_2026[2].na_recomendacao, true);
});

test('Recomendação: sem questionário, não recomenda o híbrido só pelas premissas padrão', () => {
  const r = {
    regimes_2026: [{ regime: 'Simples Nacional (atual)', total: 100000 }],
    melhor_2026: { regime: 'Simples Nacional (atual)', economia_vs_atual: 0 },
    reforma_2027: { custo_extra_hibrido: 1000, credito_para_clientes: { puro: 0, hibrido: 50000, clientes_aproveitam: true } },
    respostas_formulario: false
  };
  assert.match(recomendar(r).reforma, /confirmar com o questionário/);
  assert.match(recomendar({ ...r, respostas_formulario: true }).reforma, /avaliar o Simples híbrido/);
});

test('Recomendação: só sugere trocar de regime com economia acima de R$ 10 mil e de 5%', () => {
  const base = (economia, totalAtual) => ({
    regimes_2026: [{ regime: 'Simples Nacional (atual)', total: totalAtual }, { regime: 'Lucro Presumido', total: totalAtual - economia }],
    melhor_2026: { regime: 'Lucro Presumido', economia_vs_atual: economia },
    reforma_2027: { custo_extra_hibrido: 1000, credito_para_clientes: { puro: 0, hibrido: 0, clientes_aproveitam: false } },
    respostas_formulario: true
  });
  assert.match(recomendar(base(21740, 284281)).principal, /migração para o <b>Lucro Presumido/);
  assert.match(recomendar(base(8000, 284281)).principal, /Manter o <b>Simples Nacional/);
});

test('Questionário: aceita respostas válidas e recusa opção inventada', () => {
  const ok = {
    nome: 'Fulano', email: 'fulano@empresa.com.br', publico: 'Metade/metade', regime_clientes: 'Não sei',
    mercado: 'Exporto', crescimento: 'Estável', fornecedores: 'Misturado', folha_planos: 'Não',
    socio_outra_empresa: 'Não', faturamento_previsto: 850000.5, margem_estimada_pct: 15
  };
  assert.strictEqual(validarRespostas(ok).faturamento_previsto, 850000.5);
  assert.throws(() => validarRespostas({ ...ok, publico: 'qualquer coisa' }), /publico/);
  assert.throws(() => validarRespostas({ ...ok, margem_estimada_pct: '' }), /margem/);
});
