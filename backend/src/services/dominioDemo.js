/**
 * "Domínio de demonstração": responde às mesmas consultas que o
 * dominioService.js faria no banco do Domínio, mas com os dados fictícios
 * de src/demo/dados.js. Só é usado com MODO_DEMO=true.
 *
 * Cada consulta é reconhecida pelo NOME que o sistema dá a ela
 * ({ empresa: 'select ...', contas: '...', movimento: '...' }) e o código
 * da empresa / ano são lidos do próprio SQL.
 */
const { EMPRESAS, transacoesDoMes, cenarioDoMes } = require('../demo/dados');

const r2 = (n) => Math.round(n * 100) / 100;
const soDigitos = (t) => String(t || '').replace(/\D/g, '');

function lerParametros(sql) {
  const emp = /codi_emp\s*=\s*(\d+)/i.exec(sql);
  const ano = /'(\d{4})-01-01'/.exec(sql);
  return { codigo: emp ? Number(emp[1]) : null, ano: ano ? Number(ano[1]) : new Date().getFullYear() };
}

function totais(lista) {
  const ent = lista.filter((t) => t.valor > 0).reduce((s, t) => s + t.valor, 0);
  const sai = lista.filter((t) => t.valor < 0).reduce((s, t) => s - t.valor, 0);
  return { ent: r2(ent), sai: r2(sai), qtd: lista.length };
}

function responder(nome, sql) {
  const { codigo, ano } = lerParametros(sql);
  const empresa = EMPRESAS.find((e) => e.codigoDominio === codigo);
  switch (nome) {
    case 'empresas':
      return EMPRESAS.filter((e) => e.codigoDominio).map((e) => [e.codigoDominio, e.razao.toUpperCase(), soDigitos(e.cnpj)]);
    case 'emp':
    case 'empresa':
      return empresa ? [[empresa.razao.toUpperCase(), soDigitos(empresa.cnpj)]] : [];
    case 'proprios':
      return [[empresa ? 1 : 0]];
    case 'matriz':
      return [];
    case 'contas':
      return empresa ? empresa.contas.map((c) => [c.codi, c.clas, c.nome, 'A', null]) : [];
    case 'saldoInicial':
      return empresa ? empresa.contas.map((c) => [c.codi, 15000 + c.codi * 1000]) : [];
    case 'movimento': {
      if (!empresa) return [];
      const linhas = [];
      for (const c of empresa.contas) {
        for (let mes = 1; mes <= 12; mes++) {
          const cen = cenarioDoMes(c, mes);
          if (cen === 'sem_nada' || cen === 'falta_importar') continue; // nada lançado ainda
          const t = totais(transacoesDoMes(empresa, c, ano, mes));
          // "diferenca": o contador lançou uma saída a mais (R$ 150,00) que não está no extrato
          linhas.push([c.codi, mes, t.ent, cen === 'diferenca' ? r2(t.sai + 150) : t.sai, t.qtd + (cen === 'diferenca' ? 1 : 0)]);
        }
      }
      return linhas;
    }
    case 'importados': {
      if (!empresa) return [];
      const linhas = [];
      for (const c of empresa.contas) {
        for (let mes = 1; mes <= 12; mes++) {
          const cen = cenarioDoMes(c, mes);
          if (cen !== 'ok' && cen !== 'diferenca') continue; // só esses meses têm extrato importado no Domínio
          const t = totais(transacoesDoMes(empresa, c, ano, mes));
          linhas.push([mes, c.codi, t.qtd, t.ent, t.sai, 0]);
        }
      }
      return linhas;
    }
    case 'semLancamento':
      return [];
    default:
      return [];
  }
}

async function consultarDominioDemo(consultas) {
  await new Promise((r) => setTimeout(r, 150)); // parece uma consulta de verdade
  const resposta = {};
  for (const [nome, sql] of Object.entries(consultas)) resposta[nome] = responder(nome, sql);
  return resposta;
}

module.exports = { consultarDominioDemo };
