/**
 * Planejamento tributário na DEMONSTRAÇÃO (MODO_DEMO=true): no lugar do Domínio,
 * monta 12 meses fictícios para as empresas do Simples cadastradas na demo.
 * Três perfis, escolhidos pelo CNPJ, para a tela mostrar resultados diferentes:
 *   - comércio grande, quase tudo com ST e pouca folha → o Lucro Presumido compensa
 *   - serviço pequeno com pró-labore           → o Simples continua melhor
 *   - comércio médio                          → o Simples continua melhor
 */
const { query } = require('../../config/db');
// Ajudantes da extração real (lidos na hora do uso: os dois arquivos se citam)
const base = () => require('./extracao');
const limparCnpj = (c) => base().limparCnpj(c);
const mesAnterior = () => base().mesAnterior();

async function empresasDemo() {
  const { rows } = await query(`SELECT razao_social, cnpj, uf FROM empresas WHERE regime_tributario = 'simples_nacional' AND situacao = 'ativa' ORDER BY razao_social`);
  return rows.map((e, i) => ({ codi: 100 + i, nome: e.razao_social.toUpperCase(), cnpj: limparCnpj(e.cnpj), uf: e.uf || 'PR', cnae: null, ramo: null }));
}

function perfil(cnpj) {
  return Number(cnpj.slice(-2)) % 3; // 0 comércio grande, 1 serviço, 2 comércio médio
}

function meses12(fim) {
  const [a, m] = fim.split('-').map(Number);
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(a, m - 12 + i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
}

async function empresaPorCnpj(cnpj) {
  const c = limparCnpj(cnpj);
  if (!base().CNPJ_VALIDO.test(c)) throw new Error('CNPJ inválido.');
  return (await empresasDemo()).find((e) => e.cnpj === c) || null;
}

async function extrairEmpresa(cnpj, fim = mesAnterior()) {
  if (!/^\d{4}-\d{2}$/.test(fim)) throw new Error('Mês final inválido (use AAAA-MM).');
  const empresa = await empresaPorCnpj(cnpj);
  if (!empresa) {
    const erro = new Error('CNPJ não encontrado entre as empresas do Simples da demonstração.');
    erro.status = 404;
    throw erro;
  }
  const meses = meses12(fim);
  const p = perfil(empresa.cnpj);
  const oscila = (i) => 1 + Math.sin(i * 0.9) * 0.08;
  let receitas; let simples; let compras; let folha;
  if (p === 0) {
    receitas = meses.flatMap((mes, i) => [
      { mes, cfop: 5405, origem: 'saida', valor: Math.round(270000 * oscila(i)) },
      { mes, cfop: 5102, origem: 'saida', valor: Math.round(10000 * oscila(i)) }
    ]);
    simples = meses.map((mes) => ({ mes, anexo: 1, aliquota: 9.2 }));
    compras = meses.map((mes, i) => ({ mes, cfop: 1403, valor: Math.round(250000 * oscila(i)) }));
    folha = meses.flatMap((mes) => [
      { mes, pessoa: 1, tipo: 11, vinculo: 1, proventos: 2600 },
      { mes, pessoa: 9, tipo: 11, vinculo: 11, proventos: 3000 }
    ]);
  } else if (p === 1) {
    receitas = meses.map((mes, i) => ({ mes, cfop: 0, origem: 'servico', valor: Math.round(22000 * oscila(i)) }));
    simples = meses.map((mes) => ({ mes, anexo: 3, aliquota: 8.1 }));
    compras = [];
    folha = meses.flatMap((mes) => [
      { mes, pessoa: 1, tipo: 11, vinculo: 1, proventos: 2400 },
      { mes, pessoa: 9, tipo: 11, vinculo: 11, proventos: 4000 }
    ]);
  } else {
    receitas = meses.map((mes, i) => ({ mes, cfop: 5102, origem: 'saida', valor: Math.round(58000 * oscila(i)) }));
    simples = meses.map((mes) => ({ mes, anexo: 1, aliquota: 6.4 }));
    compras = meses.map((mes, i) => ({ mes, cfop: 1102, valor: Math.round(36000 * oscila(i)) }));
    folha = meses.flatMap((mes) => [
      { mes, pessoa: 1, tipo: 11, vinculo: 1, proventos: 2200 },
      { mes, pessoa: 2, tipo: 11, vinculo: 1, proventos: 2200 },
      { mes, pessoa: 9, tipo: 11, vinculo: 11, proventos: 3500 }
    ]);
  }
  return {
    gerado_em: new Date().toISOString(),
    periodo: { inicio: meses[0], fim },
    empresa,
    regime: { vigencia: `${meses[0]}-01`, rfed: 2, simples_optante: 'S', anexo_iii: null, anexo_v: null },
    receitas, receita_anterior: [], simples, folha, compras, dre: []
  };
}

async function empresasDoSimples() {
  return (await empresasDemo()).map(({ codi, nome, cnpj }) => ({ codi, nome, cnpj }));
}

async function buscarEmpresas(texto) {
  const t = String(texto || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  if (t.length < 2) return [];
  const so = t.replace(/\D/g, '');
  return (await empresasDemo())
    .filter((e) => e.nome.normalize('NFD').replace(/[̀-ͯ]/g, '').includes(t) || (so.length >= 2 && (e.cnpj.startsWith(so) || String(e.codi) === so)))
    .slice(0, 20).map(({ codi, nome, cnpj, uf }) => ({ codi, nome, cnpj, uf }));
}

module.exports = { extrairEmpresa, empresaPorCnpj, empresasDoSimples, buscarEmpresas };
