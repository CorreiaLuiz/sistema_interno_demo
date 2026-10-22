const { consultarDominio, inteiro } = require('../dominioService');

/**
 * Planejamento tributário — leitura dos dados de UMA empresa no Domínio
 * (somente leitura, pelo dominioService), nos 12 meses que terminam em `fim`.
 *
 * Particularidades do banco do Domínio já resolvidas aqui:
 *  - SQL Anywhere não aceita GROUP BY pela posição da coluna: sempre subconsulta com alias;
 *  - a folha (fobasesserv) guarda cálculo e recálculo com os mesmos valores: 1 registro por
 *    pessoa/mês/processo; processo 70 = distribuição de lucros (fica fora do Fator R, no motor);
 *  - faturamento de antes da empresa entrar no Domínio (ex.: época de MEI) fica em
 *    efsimples_nacional_receita_bruta_anterior.
 */

const CNPJ_VALIDO = /^[0-9A-Z]{14}$/;

function limparCnpj(cnpj) {
  return String(cnpj || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

/** 'AAAA-MM' do mês anterior ao atual (último mês fechado). */
function mesAnterior() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function periodo12Meses(fim) {
  const [a, m] = fim.split('-').map(Number);
  const inicio = new Date(a, m - 12, 1);
  const ultimoDia = new Date(a, m, 0);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { inicio: iso(inicio), fim: iso(ultimoDia) };
}

// Campos que o motor compara como número. Alguns tipos do SQL Anywhere (ex.: o
// anexo do Simples, tinyint) chegam como texto pelo dominioService.
const NUMERICOS = new Set(['codi', 'rfed', 'cfop', 'valor', 'anexo', 'aliquota', 'pessoa', 'tipo', 'vinculo', 'proventos', 'saldo', 'movimentos', 'meses']);

/** Transforma as linhas (listas) do dominioService em objetos com os nomes dados. */
function objetos(linhas, campos) {
  let lista = linhas || [];
  // Uma consulta de 1 linha pode voltar "achatada" pelo ConvertTo-Json do PowerShell
  if (lista.length && !Array.isArray(lista[0])) lista = [lista];
  return lista.map((l) => Object.fromEntries(campos.map((c, i) => {
    let v = typeof l[i] === 'string' ? l[i].trim() : l[i];
    if (NUMERICOS.has(c) && v !== null && v !== '' && !Number.isNaN(Number(v))) v = Number(v);
    return [c, v];
  })));
}

/** Empresa do Domínio pelo CNPJ (ou null). */
async function empresaPorCnpj(cnpj) {
  const c = limparCnpj(cnpj);
  if (!CNPJ_VALIDO.test(c)) throw new Error('CNPJ inválido.');
  const r = await consultarDominio({
    empresa: `select codi_emp, nome_emp, cgce_emp, esta_emp, cnae_emp, ramo_emp from bethadba.geempre where cgce_emp='${c}'`
  });
  return objetos(r.empresa, ['codi', 'nome', 'cnpj', 'uf', 'cnae', 'ramo'])[0] || null;
}

/**
 * Lê tudo o que o motor precisa. `fim` = 'AAAA-MM' (padrão: mês anterior).
 * Devolve o mesmo formato do antigo extrair-dominio.ps1.
 */
async function extrairEmpresa(cnpj, fim = mesAnterior()) {
  if (!/^\d{4}-\d{2}$/.test(fim)) throw new Error('Mês final inválido (use AAAA-MM).');
  const empresa = await empresaPorCnpj(cnpj);
  if (!empresa) {
    const erro = new Error('CNPJ não encontrado no Domínio.');
    erro.status = 404;
    throw erro;
  }
  const c = inteiro(empresa.codi);
  const p = periodo12Meses(fim);
  const per = `between '${p.inicio}' and '${p.fim}'`;

  const r = await consultarDominio({
    regime: `select first vigencia_par, rfed_par, simplesn_optante_par, simplesn_anexo_iii_par, simplesn_anexo_v_par
               from bethadba.efparametro_vigencia where codi_emp=${c} order by vigencia_par desc`,
    receitas: `select mes, cfop, origem, sum(v) from (
                 select dateformat(dsai_sai,'yyyy-mm') mes, codi_nat cfop, 'saida' origem, vcon_sai v
                   from bethadba.efsaidas where codi_emp=${c} and dsai_sai ${per} and isnull(cancelada_sai,'N')<>'S'
                 union all
                 select dateformat(dser_ser,'yyyy-mm'), 0, 'servico', vcon_ser
                   from bethadba.efservicos where codi_emp=${c} and dser_ser ${per} and isnull(cancelada_ser,'N')<>'S'
               ) x group by mes, cfop, origem`,
    receita_anterior: `select dateformat(periodo,'yyyy-mm'), valor from bethadba.efsimples_nacional_receita_bruta_anterior
                        where codi_emp=${c} and periodo ${per}`,
    simples: `select mes, anexo, max(a) from (
                select dateformat(data_sim,'yyyy-mm') mes, anexo, aliquota_efetiva_calculada a
                  from bethadba.efsdoimp_simples_nacional where codi_emp=${c} and data_sim ${per} and anexo>0
              ) x group by mes, anexo`,
    folha: `select mes, pessoa, tipo, max(vinculo), max(proventos) from (
              select dateformat(competencia,'yyyy-mm') mes, i_empregados pessoa, tipo_process tipo, vinculo, proventos
                from bethadba.fobasesserv where codi_emp=${c} and competencia ${per} and isnull(simulacao,0)=0
            ) x group by mes, pessoa, tipo`,
    compras: `select mes, cfop, sum(v) from (
                select dateformat(dent_ent,'yyyy-mm') mes, codi_nat cfop, vcon_ent v
                  from bethadba.efentradas where codi_emp=${c} and dent_ent ${per}
              ) x group by mes, cfop`,
    // DRE pelos lançamentos (plano do Domínio: 3 custos/despesas, 4 receitas, 5 custos)
    dre: `select grupo, sum(v), count(*), count(distinct mes) from (
            select left(k.clas_cta,3) grupo, m.v, m.mes from (
              select cdeb_lan cta, -vlor_lan v, dateformat(data_lan,'yyyy-mm') mes
                from bethadba.ctlancto where codi_emp=${c} and data_lan ${per}
              union all
              select ccre_lan, vlor_lan, dateformat(data_lan,'yyyy-mm')
                from bethadba.ctlancto where codi_emp=${c} and data_lan ${per}
            ) m join bethadba.ctcontas k on k.codi_emp=${c} and k.codi_cta=m.cta
            where left(k.clas_cta,1) in ('3','4','5')
          ) x group by grupo`
  });

  return {
    gerado_em: new Date().toISOString(),
    periodo: { inicio: p.inicio.slice(0, 7), fim },
    empresa,
    regime: objetos(r.regime, ['vigencia', 'rfed', 'simples_optante', 'anexo_iii', 'anexo_v'])[0] || null,
    receitas: objetos(r.receitas, ['mes', 'cfop', 'origem', 'valor']),
    receita_anterior: objetos(r.receita_anterior, ['mes', 'valor']),
    simples: objetos(r.simples, ['mes', 'anexo', 'aliquota']),
    folha: objetos(r.folha, ['mes', 'pessoa', 'tipo', 'vinculo', 'proventos']),
    compras: objetos(r.compras, ['mes', 'cfop', 'valor']),
    dre: objetos(r.dre, ['grupo', 'saldo', 'movimentos', 'meses'])
  };
}

/**
 * Empresas do Domínio para o "radar" da carteira: ativas (stat_emp 'A'), hoje no
 * Simples Nacional (última vigência dos parâmetros) e com nota de venda ou de
 * serviço nos últimos 12 meses — as demais não têm o que comparar.
 */
async function empresasDoSimples() {
  const desde = periodo12Meses(mesAnterior()).inicio;
  const r = await consultarDominio({
    lista: `select e.codi_emp, e.nome_emp, e.cgce_emp from bethadba.geempre e
             where e.cgce_emp is not null and length(e.cgce_emp)=14 and e.stat_emp = 'A'
               and (select first p.simplesn_optante_par from bethadba.efparametro_vigencia p
                     where p.codi_emp=e.codi_emp order by p.vigencia_par desc) = 'S'
               and (exists (select 1 from bethadba.efsaidas s where s.codi_emp=e.codi_emp and s.dsai_sai >= '${desde}')
                    or exists (select 1 from bethadba.efservicos v where v.codi_emp=e.codi_emp and v.dser_ser >= '${desde}'))
             order by e.nome_emp`
  });
  return objetos(r.lista, ['codi', 'nome', 'cnpj']);
}

/**
 * Busca empresas no Domínio por parte do nome, código ou CNPJ (até 20).
 * O texto é reduzido a letras/números/espaço antes de ir para o SQL.
 */
async function buscarEmpresas(texto) {
  const t = String(texto || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^0-9A-Z ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (t.length < 2) return [];
  const soNumeros = t.replace(/ /g, '');
  const condicoes = [`upper(e.nome_emp) like '%${t}%'`];
  if (/^\d+$/.test(soNumeros)) {
    condicoes.push(`e.cgce_emp like '${soNumeros}%'`);
    if (soNumeros.length <= 6) condicoes.push(`e.codi_emp = ${inteiro(soNumeros)}`);
  } else if (/^[0-9A-Z]{8,14}$/.test(soNumeros)) {
    condicoes.push(`e.cgce_emp like '${soNumeros}%'`);
  }
  const r = await consultarDominio({
    lista: `select top 20 e.codi_emp, e.nome_emp, e.cgce_emp, e.esta_emp from bethadba.geempre e
             where e.cgce_emp is not null and length(e.cgce_emp)=14 and (${condicoes.join(' or ')})
             order by e.nome_emp`
  });
  return objetos(r.lista, ['codi', 'nome', 'cnpj', 'uf']);
}

module.exports = { extrairEmpresa, empresaPorCnpj, empresasDoSimples, buscarEmpresas, limparCnpj, mesAnterior, CNPJ_VALIDO };

// Demonstração: dados fictícios no lugar do Domínio
if (require('../../config/demo').MODO_DEMO) Object.assign(module.exports, require('./demo'));
