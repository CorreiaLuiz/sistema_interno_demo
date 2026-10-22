const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { query } = require('../config/db');
const { consultarDominio, inteiro } = require('./dominioService');
const { lerOfx } = require('./leitorOfx');

/**
 * Conferência bancária de uma empresa em um ano:
 *  - lê os extratos da pasta MOVIMENTO CONTABIL\<ano> (OFX de verdade;
 *    PDF/Excel só são listados);
 *  - lê do Domínio o razão das contas de banco, aplicação, empréstimo e
 *    cartão, e os extratos que já foram importados na tela de extrato;
 *  - compara, mês a mês e conta a conta, as entradas e saídas do OFX com
 *    os débitos e créditos da conta no Domínio, e monta a lista do que
 *    falta: importar, pedir ao cliente, corrigir ou organizar.
 * Nada é gravado no Domínio nem movido na pasta.
 */

const TOLERANCIA = 0.011;
const NOMES_MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const ARQUIVOS_IGNORADOS = /^(thumbs\.db|desktop\.ini|\.ds_store)$|^~\$/i;
const PASTA_MES = /^(\d{4})\s*[-_. ]?\s*(\d{1,2})\b/;

// Código do banco no OFX → palavras que aparecem no nome da conta no Domínio
const BANCOS = {
  '001': ['BRASIL', 'BB'], '104': ['CAIXA', 'CEF'], '237': ['BRADESCO'], '341': ['ITAU'], '033': ['SANTANDER'],
  '748': ['SICREDI'], '756': ['SICOOB'], '133': ['CRESOL'], '077': ['INTER'], '260': ['NUBANK', 'NU'],
  '290': ['PAGBANK', 'PAGSEGURO', 'PAG'], '323': ['MERCADO'], '336': ['C6'], '208': ['BTG'], '380': ['PICPAY'],
  '403': ['CORA'], '422': ['SAFRA'], '085': ['AILOS', 'EVOLUA', 'VIACREDI'], '396': ['MAGALU', 'MAGALUPAY'],
  '136': ['UNICRED'], '084': ['SISPRIME'], '197': ['STONE'], '542': ['INFINITEPAY', 'CLOUDWALK'], '041': ['BANRISUL'],
  '212': ['ORIGINAL'], '461': ['ASAAS'], '364': ['EFI', 'GERENCIANET'], '070': ['BRB'], '655': ['VOTORANTIM', 'BV'],
  '389': ['MERCANTIL'], '623': ['PAN'], '318': ['BMG'], '097': ['CREDISIS'], '091': ['UNICRED']
};

const RX_EMPRESTIMO = /EMPRESTIMO|FINANCIAMENTO|BNDES|PRONAMP|FINAME|CAPITAL DE GIRO|CONSORCIO|LEASING|JUROS A TRANSCORRER|CONTA GARANTIDA|CHEQUE ESPECIAL/;
const RX_NAO_BANCARIO = /SOCIO|TERCEIROS|PESSOAS LIGADAS|COLIGAD|CONTROLAD|MUTUO/;
const RX_CARTAO = /CARTAO/;
const RX_DESCONTO = /DESCONTO|DESCONTADAS|BORDERO/;
const RX_APLICACAO = /APLICAC|POUPANCA|INVEST|RENDE FACIL|CDB|RDC|FUNDO|LCA|LCI/;
const RX_BANCO_NOME = new RegExp(`\\b(BANCO|${[...new Set(Object.values(BANCOS).flat())].filter((p) => p.length > 2).join('|')})\\b`);

const RX_ARQ = {
  aplicacao: /APLIC|RENDE|INVEST|POUPAN|CDB|RDC|FUNDO|RESGATE/,
  emprestimo: /EMPREST|BNDES|CONTRATO|PRONAMP|FINAME|GIRO|FINANC|CONSORC|PARCELA|CP\d{6,}/,
  cartao: /FATURA|CARTAO/,
  desconto: /DESCONTO|BORDER|DUPLICATA/
};

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const igual = (a, b) => Math.abs(r2(a) - r2(b)) <= TOLERANCIA;
const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const nomeMes = (m) => NOMES_MES[m - 1];

function classificarConta(clas, nome) {
  const n = semAcento(nome);
  const c = String(clas || '');
  if (c.startsWith('111')) {
    if (/CONCILIAR/.test(n)) return 'conciliar';
    if (c.startsWith('11101')) return /CAIXA ECON/.test(n) ? 'banco' : null;
    if (c.startsWith('11102')) return 'banco';
    if (c.startsWith('11103') || RX_APLICACAO.test(n)) return 'aplicacao';
    return RX_BANCO_NOME.test(n) ? 'banco' : null;
  }
  if (c.startsWith('21') || c.startsWith('22')) {
    if (RX_CARTAO.test(n)) return 'cartao';
    if (RX_DESCONTO.test(n)) return 'desconto';
    if (RX_EMPRESTIMO.test(n) && !RX_NAO_BANCARIO.test(n)) return 'emprestimo';
  }
  return null;
}

/** Mês de uma data dentro do ano: 0 = antes do ano, null = depois do ano. */
function mesNoAno(dataIso, ano) {
  const [y, m] = String(dataIso || '').slice(0, 10).split('-').map(Number);
  if (!y) return null;
  if (y < ano) return 0;
  return y > ano ? null : m;
}

/**
 * Encerramento da conta: marcado pela equipe na tela, inativada no plano do
 * Domínio ou um arquivo de extrato com "ENCERRAMENTO" no nome. `mes` é o
 * último mês com movimento (depois dele, nada de pedir extrato).
 */
function encerramentoDaConta(c, ano, manual) {
  if (manual) {
    const mes = mesNoAno(manual, ano);
    return mes === null ? null : { mes, origem: 'manual', data: manual };
  }
  if (c.inativa) {
    const mes = c.dataInativa ? mesNoAno(c.dataInativa, ano) : 0;
    if (mes !== null) return { mes, origem: 'dominio', data: c.dataInativa || null };
  }
  for (let m = 1; m <= 12; m++) {
    const arquivos = [...((c.ofx[m] && c.ofx[m].arquivos) || []), ...((c.outros && c.outros[m]) || [])];
    const arquivo = arquivos.find((a) => /ENCERRA/.test(semAcento(a)));
    if (arquivo) return { mes: m, origem: 'arquivo', arquivo };
  }
  return null;
}

/** Palavras que identificam o banco no nome da conta (para achar na planilha). */
function palavrasDaConta(nome) {
  const GENERICAS = new Set(['BANCO', 'CONTA', 'CORRENTE', 'MOVIMENTO', 'COOPERATIVA', 'COOP', 'CREDITO', 'LIVRE', 'ADMISSAO', 'DOS', 'DAS', 'LTDA', 'CAIXA']);
  const n = semAcento(nome);
  const palavras = n.replace(/[^A-Z0-9 ]+/g, ' ').split(' ').filter((t) => t.length >= 3 && !/\d/.test(t) && !GENERICAS.has(t));
  for (const lista of Object.values(BANCOS)) {
    if (lista.some((p) => p.length > 2 && new RegExp(`\\b${p}\\b`).test(n))) palavras.push(...lista);
  }
  if (/CAIXA ECON/.test(n)) palavras.push('CAIXA', 'CEF');
  return [...new Set(palavras)];
}

/** Números de conta escritos no nome da conta do Domínio (4 dígitos ou mais). */
function numerosNoNome(nome) {
  return (String(nome || '').match(/\d[\d.\-/ ]{2,}\d/g) || [])
    .map((n) => n.replace(/\D/g, '').replace(/^0+/, ''))
    .filter((n) => n.length >= 4);
}

/** A conta do OFX é a do nome? (com ou sem dígito verificador, com ou sem agência) */
function numeroCombina(doOfx, doNome) {
  return doOfx.includes(doNome) || doNome.includes(doOfx) || (doNome.length > 4 && doOfx.includes(doNome.slice(0, -1)));
}

/** Palavra do nome do arquivo que indica o banco ("SICREDI 01 2026.ofx" → SICREDI). */
function palavrasDoArquivo(nome) {
  return semAcento(path.parse(nome).name).replace(/[^A-Z0-9]+/g, ' ').split(' ')
    .filter((t) => t.length >= 2 && !/^\d+$/.test(t) && !['OFX', 'PDF', 'EXTRATO', 'CONTA', 'CORRENTE', 'CC', 'SISTEMA'].includes(t));
}

// ------------------------------------------------------------------
// Pasta da empresa
// ------------------------------------------------------------------

async function listarArquivos(base) {
  const arquivos = [];
  const pastasForaPadrao = [];
  async function andar(dir, rel, mes, nivel) {
    let itens;
    try { itens = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const it of itens) {
      const caminho = path.join(dir, it.name);
      const relativo = rel ? `${rel}\\${it.name}` : it.name;
      if (it.isDirectory()) {
        if (nivel > 4) continue;
        let mesPasta = mes;
        if (nivel === 0) {
          const m = it.name.trim().match(PASTA_MES);
          if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) mesPasta = { ano: Number(m[1]), mes: Number(m[2]) };
          else pastasForaPadrao.push(relativo);
          if (m && !/^\d{4} \d{2}$/.test(it.name)) pastasForaPadrao.push(relativo);
        }
        await andar(caminho, relativo, mesPasta, nivel + 1);
      } else if (!ARQUIVOS_IGNORADOS.test(it.name)) {
        let tamanho = 0;
        try { tamanho = (await fs.promises.stat(caminho)).size; } catch (e) { /* arquivo sumiu */ }
        arquivos.push({ caminho, relativo, nome: it.name, ext: path.extname(it.name).toLowerCase().slice(1), tamanho, pastaMes: mes });
      }
    }
  }
  await andar(base, '', null, 0);
  return { arquivos, pastasForaPadrao };
}

const hashArquivo = async (caminho) => crypto.createHash('sha1').update(await fs.promises.readFile(caminho)).digest('hex');

// ------------------------------------------------------------------
// Domínio
// ------------------------------------------------------------------

async function lerDominio(codigo, ano) {
  const E = inteiro(codigo);
  const A = inteiro(ano);
  const periodo = `data_lan between '${A}-01-01' and '${A}-12-31'`;

  // Filial sem lançamentos próprios no ano: é lançada dentro da matriz,
  // marcada com o código dela no campo filial .
  const origem = await consultarDominio({
    proprios: `select count(*) from bethadba.ctlancto where codi_emp=${E} and ${periodo}`,
    matriz: `select top 1 codi_emp from bethadba.ctlancto where fili_lan=${E} and codi_emp<>${E} and ${periodo}`
  });
  const naMatriz = Number(origem.proprios[0][0]) === 0 && origem.matriz.length ? Number(origem.matriz[0][0]) : null;
  const L = naMatriz || E;
  const filial = naMatriz ? ` and fili_lan=${E}` : '';
  const filialItem = naMatriz ? ` and i.FILIAL=${E}` : '';

  const plano = `coalesce((select max(CODI_EMP_PLANO) from bethadba.ctlancto where codi_emp=${L}), ${L})`;
  const contas = `select codi_cta from bethadba.ctcontas where codi_emp=${plano} and tipo_cta='A' and (clas_cta like '111%' or clas_cta like '21%' or clas_cta like '22%')`;
  const r = await consultarDominio({
    empresa: `select nome_emp, cgce_emp from bethadba.geempre where codi_emp=${E}`,
    contas: `select codi_cta, clas_cta, nome_cta, SITUACAO_CTA, DATAINATIVA_CTA from bethadba.ctcontas where codi_emp=${plano} and tipo_cta='A' and (clas_cta like '111%' or clas_cta like '21%' or clas_cta like '22%')`,
    movimento: `select conta, mes, sum(deb), sum(cre), count(*) from (
        select cdeb_lan conta, month(data_lan) mes, vlor_lan deb, 0 cre from bethadba.ctlancto where codi_emp=${L} and ${periodo}${filial}
        union all
        select ccre_lan, month(data_lan), 0, vlor_lan from bethadba.ctlancto where codi_emp=${L} and ${periodo}${filial}
      ) x where conta in (${contas}) group by conta, mes`,
    saldoInicial: `select conta, sum(v) from (
        select cdeb_lan conta, vlor_lan v from bethadba.ctlancto where codi_emp=${L} and data_lan < '${A}-01-01'${filial}
        union all
        select ccre_lan, -vlor_lan from bethadba.ctlancto where codi_emp=${L} and data_lan < '${A}-01-01'${filial}
      ) x where conta in (${contas}) group by conta`,
    importados: `select month(l.COMPETENCIA), l.CODI_CTA, count(i.I_ITEM),
        sum(case when i.TIPO='D' then i.VALOR else 0 end), sum(case when i.TIPO='C' then i.VALOR else 0 end),
        sum(case when x.I_ITEM is null then 1 else 0 end)
      from bethadba.CTEXTRATO_BANCARIO_LANCAMENTO l
      join bethadba.CTEXTRATO_BANCARIO_LANCAMENTO_ITEM i on i.codi_emp=l.codi_emp and i.I_LANCAMENTO=l.I_LANCAMENTO
      left join (select distinct codi_emp, I_LANCAMENTO, I_ITEM from bethadba.CTEXTRATO_BANCARIO_LANCAMENTO_ITEM_LANCTO where codi_emp=${L}) x
        on x.codi_emp=i.codi_emp and x.I_LANCAMENTO=i.I_LANCAMENTO and x.I_ITEM=i.I_ITEM
      where l.codi_emp=${L} and l.COMPETENCIA between '${A}-01-01' and '${A}-12-31'${filialItem}
      group by month(l.COMPETENCIA), l.CODI_CTA`,
    semLancamento: `select top 400 month(l.COMPETENCIA), l.CODI_CTA, i.DATA_ITEM, i.HISTORICO, i.VALOR, i.TIPO
      from bethadba.CTEXTRATO_BANCARIO_LANCAMENTO l
      join bethadba.CTEXTRATO_BANCARIO_LANCAMENTO_ITEM i on i.codi_emp=l.codi_emp and i.I_LANCAMENTO=l.I_LANCAMENTO
      where l.codi_emp=${L} and l.COMPETENCIA between '${A}-01-01' and '${A}-12-31'${filialItem}
        and not exists (select 1 from bethadba.CTEXTRATO_BANCARIO_LANCAMENTO_ITEM_LANCTO x
          where x.codi_emp=i.codi_emp and x.I_LANCAMENTO=i.I_LANCAMENTO and x.I_ITEM=i.I_ITEM)
      order by 1, 2, 3`
  });
  if (!r.empresa.length) throw new Error(`A empresa ${E} não existe no Domínio.`);
  r.lancadaNaMatriz = naMatriz;
  return r;
}

// ------------------------------------------------------------------
// Conferência
// ------------------------------------------------------------------

const PESO_STATUS = { sem_movimento: 0, encerrada: 0, ok: 1, lancado_sem_ofx: 2, falta_extrato: 3, falta_importar: 4, nao_identificada: 5, diferenca: 6 };

function mesLimiteDoAno(ano, hoje = new Date()) {
  const anoAtual = hoje.getFullYear();
  if (ano < anoAtual) return 12;
  if (ano > anoAtual) return 0;
  return hoje.getMonth(); // mês anterior ao atual (getMonth é 0-based)
}

async function conferirEmpresa(empresa, ano, vinculosManuais = [], encerramentosManuais = []) {
  const mesLimite = mesLimiteDoAno(ano);
  const meses = Array.from({ length: mesLimite }, (_, i) => i + 1);
  const resultado = {
    ano, mesLimite, geradoEm: new Date().toISOString(),
    empresa: { codigo: empresa.codigo_dominio, nome: empresa.nome },
    pasta: { caminho: null, existe: false, anoExiste: false },
    contas: [], naoIdentificadas: [], outrosArquivos: [], aplicacoes: [], aConciliar: [], semLancamento: [],
    organizacao: { soltos: [], pastasForaPadrao: [], duplicados: [], ofxPastaErrada: [], nomeMesDiferente: [], errosLeitura: [] },
    pendencias: [], resumoMeses: [], contasDominio: []
  };
  if (!empresa.codigo_dominio) throw new Error('Empresa sem código do Domínio.');

  // ---------------- Domínio ----------------
  const dom = await lerDominio(empresa.codigo_dominio, ano);
  resultado.empresa.nomeDominio = dom.empresa[0][0];
  resultado.empresa.lancadaNaMatriz = dom.lancadaNaMatriz;

  const contas = new Map();
  for (const [codi, clas, nome, situacao, dataInativa] of dom.contas) {
    const grupo = classificarConta(clas, nome);
    if (!grupo) continue;
    contas.set(Number(codi), {
      codi: Number(codi), clas: String(clas), nome, grupo, inativa: situacao === 'I', dataInativa,
      saldoInicial: 0, mov: {}, imp: {}, ofx: {}, chavesOfx: []
    });
  }
  for (const [conta, v] of dom.saldoInicial) if (contas.has(Number(conta))) contas.get(Number(conta)).saldoInicial = r2(v);
  for (const [conta, mes, deb, cre, qtd] of dom.movimento) {
    if (contas.has(Number(conta))) contas.get(Number(conta)).mov[mes] = { deb: r2(deb), cre: r2(cre), qtd: Number(qtd) };
  }
  for (const [mes, conta, qtd, ent, sai, semLanc] of dom.importados) {
    const c = contas.get(Number(conta));
    if (c) c.imp[mes] = { qtd: Number(qtd), ent: r2(ent), sai: r2(sai), semLanc: Number(semLanc) };
  }
  resultado.semLancamento = dom.semLancamento.map(([mes, conta, data, historico, valor, tipo]) => ({
    mes, codi: Number(conta), data, historico, valor: r2(valor), entrada: tipo === 'D'
  }));
  const bancos = [...contas.values()].filter((c) => c.grupo === 'banco');
  // Um extrato pode ser de conta de investimento (ex.: XP): também pode ir para uma aplicação
  const ligaveis = [...contas.values()].filter((c) => c.grupo === 'banco' || c.grupo === 'aplicacao');
  resultado.contasDominio = ligaveis.map((c) => ({ codi: c.codi, nome: c.nome, grupo: c.grupo }));

  // ---------------- Pasta ----------------
  const pastaEmpresa = empresa.pasta ? path.join(process.env.CB_PASTA_EMPRESAS || '', empresa.pasta) : null;
  const baseAno = pastaEmpresa ? path.join(pastaEmpresa, 'CONTABILIDADE', 'MOVIMENTO CONTABIL', String(ano)) : null;
  resultado.pasta.caminho = baseAno;
  resultado.pasta.existe = !!(pastaEmpresa && fs.existsSync(pastaEmpresa));
  resultado.pasta.anoExiste = !!(baseAno && fs.existsSync(baseAno));

  let arquivos = [];
  if (resultado.pasta.anoExiste) {
    const lista = await listarArquivos(baseAno);
    arquivos = lista.arquivos;
    resultado.organizacao.pastasForaPadrao = lista.pastasForaPadrao;
  }

  // Arquivos repetidos: conteúdo idêntico, ou mesmo tamanho com o mesmo
  // nome (tirando espaços) — o banco muda a data de geração dentro do
  // arquivo a cada download, então o conteúdo nem sempre é idêntico.
  // Os OFX repetidos continuam sendo lidos (a soma não duplica, ver abaixo).
  const grupos = new Map();
  const juntar = (k, a) => { if (!grupos.has(k)) grupos.set(k, new Set()); grupos.get(k).add(a); };
  const porTamanho = new Map();
  for (const a of arquivos) {
    if (!a.tamanho) continue;
    const k = `${a.tamanho}.${a.ext}`;
    if (!porTamanho.has(k)) porTamanho.set(k, []);
    porTamanho.get(k).push(a);
  }
  for (const grupo of porTamanho.values()) {
    if (grupo.length < 2) continue;
    for (const a of grupo) {
      try { juntar(`h:${await hashArquivo(a.caminho)}`, a); } catch (e) { /* sem acesso */ }
      juntar(`n:${a.tamanho}:${semAcento(a.nome).replace(/[^A-Z0-9.]/g, '')}`, a);
    }
  }
  const jaListados = new Set();
  for (const conjunto of grupos.values()) {
    const iguais = [...conjunto].filter((a) => !jaListados.has(a));
    if (iguais.length < 2) continue;
    iguais.sort((x, y) => (x.pastaMes ? 0 : 1) - (y.pastaMes ? 0 : 1) || x.relativo.localeCompare(y.relativo));
    iguais.forEach((a) => jaListados.add(a));
    iguais.slice(1).forEach((a) => { a.duplicado = true; });
    resultado.organizacao.duplicados.push(iguais.map((a) => a.relativo));
  }

  for (const a of arquivos) {
    if (!a.pastaMes) resultado.organizacao.soltos.push(a.relativo);
    const mNome = semAcento(a.nome).match(/\b(\d{2})[ ._-]+(\d{4})\b/);
    if (a.pastaMes && mNome && Number(mNome[2]) === ano && Number(mNome[1]) !== a.pastaMes.mes && Number(mNome[1]) <= 12) {
      resultado.organizacao.nomeMesDiferente.push(a.relativo);
    }
  }

  // ---------------- OFX ----------------
  // contasOfx: chave (banco:conta) → { meses: { m: Map(data|valor → quantidade) }, arquivos por mês }
  const contasOfx = new Map();
  const assinaturas = new Map();
  for (const a of arquivos.filter((x) => x.ext === 'ofx')) {
    let ofx;
    try { ofx = lerOfx(await fs.promises.readFile(a.caminho)); } catch (e) {
      resultado.organizacao.errosLeitura.push({ arquivo: a.relativo, erro: e.message });
      continue;
    }
    // Últimos 8 dígitos: o mesmo banco manda a conta ora com a agência na frente, ora sem
    const numeroConta = ofx.conta.replace(/\D/g, '').replace(/^0+/, '').slice(-8).replace(/^0+/, '');
    const palavras = palavrasDoArquivo(a.nome);
    const chave = `${ofx.bancoCodigo}:${numeroConta || (palavras[0] || a.nome)}`;

    // Mesmo extrato baixado duas vezes (mesma conta, mesmas movimentações)
    const assinatura = `${chave}|${ofx.transacoes.map((t) => `${t.data}|${t.valor}|${t.fitid}`).sort().join(';')}`;
    if (ofx.transacoes.length && assinaturas.has(assinatura)) {
      if (!a.duplicado) {
        a.duplicado = true;
        const outro = assinaturas.get(assinatura);
        const grupo = resultado.organizacao.duplicados.find((g) => g.includes(outro.relativo));
        if (grupo) grupo.push(a.relativo); else resultado.organizacao.duplicados.push([outro.relativo, a.relativo]);
      }
    } else {
      assinaturas.set(assinatura, a);
    }
    if (!contasOfx.has(chave)) {
      contasOfx.set(chave, {
        chave, banco: ofx.bancoCodigo, conta: ofx.conta, numero: ofx.conta.replace(/\D/g, '').replace(/^0+/, ''),
        instituicao: ofx.instituicao, palavras: new Set(), meses: {}, fora: {}, arquivos: {}, periodos: []
      });
    }
    const co = contasOfx.get(chave);
    palavras.forEach((p) => co.palavras.add(p));

    if (ofx.periodo) co.periodos.push(ofx.periodo);
    const porMes = {};
    const contagem = {};
    for (const t of ofx.transacoes) {
      const [y, m] = t.data.split('-').map(Number);
      contagem[`${y}-${m}`] = (contagem[`${y}-${m}`] || 0) + 1;
      if (y !== ano || t.valor === 0) continue;
      // Linha com data fora do período do arquivo (o Cresol põe no extrato de
      // janeiro linhas de fevereiro que mudam depois): fica guardada à parte
      const onde = t.foraDoPeriodo ? 'fora' : 'dentro';
      if (!porMes[m]) porMes[m] = { dentro: new Map(), fora: new Map() };
      const k = `${t.data}|${t.valor}`;
      porMes[m][onde].set(k, (porMes[m][onde].get(k) || 0) + 1);
    }
    // Junta com outros arquivos da mesma conta: um lançamento repetido em
    // dois arquivos (dias que se sobrepõem) conta uma vez só.
    for (const [m, { dentro, fora }] of Object.entries(porMes)) {
      if (!co.meses[m]) co.meses[m] = new Map();
      if (!co.fora[m]) co.fora[m] = [];
      for (const [k, q] of dentro) co.meses[m].set(k, Math.max(co.meses[m].get(k) || 0, q));
      for (const [k, q] of fora) co.fora[m].push({ k, q, arquivo: a.relativo });
      if (!co.arquivos[m]) co.arquivos[m] = [];
      if (dentro.size) co.arquivos[m].push(a.relativo);
    }
    // Mês principal do arquivo x pasta onde ele está
    const principal = Object.entries(contagem).sort((x, y) => y[1] - x[1])[0];
    if (principal && a.pastaMes) {
      const [py, pm] = principal[0].split('-').map(Number);
      if (py !== a.pastaMes.ano || pm !== a.pastaMes.mes) {
        resultado.organizacao.ofxPastaErrada.push({ arquivo: a.relativo, mesDoExtrato: `${String(pm).padStart(2, '0')}/${py}` });
      }
    }
  }
  for (const co of contasOfx.values()) {
    // Linhas fora do período só valem se nenhum arquivo da conta cobre aquele dia
    for (const [m, linhas] of Object.entries(co.fora)) {
      for (const { k, q, arquivo } of linhas) {
        const dia = k.split('|')[0];
        if (co.periodos.some((p) => p.inicio <= dia && dia <= p.fim)) continue;
        co.meses[m].set(k, Math.max(co.meses[m].get(k) || 0, q));
        if (!co.arquivos[m].includes(arquivo)) co.arquivos[m].push(arquivo);
      }
    }
    co.totais = {};
    for (const [m, mapa] of Object.entries(co.meses)) {
      if (!mapa.size) continue;
      let ent = 0; let sai = 0; let qtd = 0;
      for (const [k, q] of mapa) {
        const valor = Number(k.split('|')[1]);
        if (valor > 0) ent += valor * q; else sai += -valor * q;
        qtd += q;
      }
      co.totais[m] = { ent: r2(ent), sai: r2(sai), qtd, arquivos: co.arquivos[m] };
    }
  }

  // ---------------- Vínculo OFX → conta do Domínio ----------------
  const manuais = new Map(vinculosManuais.map((v) => [v.chave_ofx, v.codi_cta]));
  const vinculo = new Map(); // chave → codi (ou null = ignorar)
  const tomadas = new Set();
  for (const co of contasOfx.values()) {
    if (manuais.has(co.chave)) {
      const codi = manuais.get(co.chave);
      vinculo.set(co.chave, codi === null ? null : Number(codi));
      if (codi !== null) tomadas.add(Number(codi));
      co.origemVinculo = 'manual';
    }
  }
  // 1) Pelos valores: o mês do OFX bate com o razão (ou com o extrato importado) de uma conta
  for (const co of contasOfx.values()) {
    if (vinculo.has(co.chave)) continue;
    const votos = new Map();
    for (const [m, t] of Object.entries(co.totais)) {
      for (const c of ligaveis) {
        const mov = c.mov[m];
        const imp = c.imp[m];
        const bateRazao = mov && mov.qtd && igual(mov.deb, t.ent) && igual(mov.cre, t.sai);
        const bateImport = imp && imp.qtd && igual(imp.ent, t.ent) && igual(imp.sai, t.sai);
        if (bateRazao || bateImport) votos.set(c.codi, (votos.get(c.codi) || 0) + 1);
      }
    }
    const ordem = [...votos.entries()].sort((x, y) => y[1] - x[1]);
    if (ordem.length && (ordem.length === 1 || ordem[0][1] > ordem[1][1])) {
      vinculo.set(co.chave, ordem[0][0]);
      tomadas.add(ordem[0][0]);
      co.origemVinculo = 'valores';
    }
  }
  // 2) Pelo número da conta escrito no nome da conta ("BRADESCO - CONTA 0570388-3")
  for (const co of contasOfx.values()) {
    if (vinculo.has(co.chave) || !co.numero) continue;
    const batem = bancos.filter((c) => numerosNoNome(c.nome).some((n) => numeroCombina(co.numero, n)));
    if (batem.length === 1) {
      vinculo.set(co.chave, batem[0].codi);
      tomadas.add(batem[0].codi);
      co.origemVinculo = 'numero';
    }
  }
  // 3) Pelo nome do banco (código do OFX e nome do arquivo) x nome da conta;
  //    uma conta com outro número no nome não serve
  for (const co of contasOfx.values()) {
    if (vinculo.has(co.chave)) continue;
    const palavras = new Set([...(BANCOS[co.banco] || []), ...co.palavras]);
    const candidatas = bancos.filter((c) => !tomadas.has(c.codi)
      && [...palavras].some((p) => new RegExp(`\\b${p}\\b`).test(semAcento(c.nome)))
      && (!co.numero || !numerosNoNome(c.nome).length || numerosNoNome(c.nome).some((n) => numeroCombina(co.numero, n))));
    if (candidatas.length === 1) {
      vinculo.set(co.chave, candidatas[0].codi);
      tomadas.add(candidatas[0].codi);
      co.origemVinculo = 'nome';
    } else {
      co.sugestoes = candidatas.map((c) => c.codi);
    }
  }
  // 4) Uma conta só de cada lado
  const semVinculo = [...contasOfx.values()].filter((co) => !vinculo.has(co.chave));
  const livres = bancos.filter((c) => !tomadas.has(c.codi) && !c.inativa);
  if (semVinculo.length === 1 && livres.length === 1 && contasOfx.size === 1) {
    vinculo.set(semVinculo[0].chave, livres[0].codi);
    semVinculo[0].origemVinculo = 'unica';
  }

  for (const co of contasOfx.values()) {
    const codi = vinculo.get(co.chave);
    if (codi && contas.has(codi)) {
      const c = contas.get(codi);
      c.chavesOfx.push({ chave: co.chave, banco: co.banco, conta: co.conta, origem: co.origemVinculo });
      for (const [m, t] of Object.entries(co.totais)) {
        if (!c.ofx[m]) c.ofx[m] = { ent: 0, sai: 0, qtd: 0, arquivos: [] };
        c.ofx[m].ent = r2(c.ofx[m].ent + t.ent);
        c.ofx[m].sai = r2(c.ofx[m].sai + t.sai);
        c.ofx[m].qtd += t.qtd;
        c.ofx[m].arquivos.push(...t.arquivos);
      }
    } else if (!vinculo.has(co.chave) && Object.keys(co.totais).some((m) => Number(m) <= mesLimite)) {
      resultado.naoIdentificadas.push({
        chave: co.chave, banco: co.banco, conta: co.conta, instituicao: co.instituicao,
        sugestoes: co.sugestoes || [],
        meses: meses.map((m) => ({ m, ofx: co.totais[m] || null }))
      });
    }
  }

  // ---------------- Outros arquivos (PDF, Excel, TXT...) ----------------
  // Os de extrato são ligados à conta pelo nome do arquivo ("MERCADO PAGO
  // 05 2026.xlsx" → conta MERCADO PAGO; "BB 05 2026.pdf" → código 001).
  const arquivosDaConta = (nome) => {
    const palavras = palavrasDoArquivo(nome);
    const codigos = Object.keys(BANCOS).filter((cod) => BANCOS[cod].some((p) => palavras.includes(p)));
    const candidatas = bancos.filter((c) => {
      const n = semAcento(c.nome);
      return c.chavesOfx.some((k) => codigos.includes(k.banco))
        || codigos.some((cod) => BANCOS[cod].some((p) => p.length > 2 && new RegExp(`\\b${p}\\b`).test(n)))
        || palavras.some((p) => p.length >= 4 && new RegExp(`\\b${p}\\b`).test(n));
    });
    return candidatas.length === 1 ? candidatas[0] : null;
  };
  for (const a of arquivos) {
    if (a.ext === 'ofx' || a.duplicado) continue;
    const n = semAcento(a.nome);
    const tipo = Object.keys(RX_ARQ).find((k) => RX_ARQ[k].test(n)) || 'extrato';
    const mes = a.pastaMes && a.pastaMes.ano === ano ? a.pastaMes.mes : null;
    let codi = null;
    if (tipo === 'extrato' && mes) {
      const c = arquivosDaConta(a.nome);
      if (c) {
        codi = c.codi;
        if (!c.outros) c.outros = {};
        if (!c.outros[mes]) c.outros[mes] = [];
        c.outros[mes].push(a.relativo);
      }
    }
    resultado.outrosArquivos.push({ arquivo: a.relativo, mes, tipo, ext: a.ext, codi });
  }

  // ---------------- Contas bancárias mês a mês ----------------
  // O registro da tela de importação sozinho (sem lançamento na conta) não
  // conta como movimento: às vezes o extrato foi importado na conta errada.
  const temAlgo = (c, m) => !!(c.ofx[m] || (c.mov[m] && c.mov[m].qtd) || (c.outros && c.outros[m]));
  const linhasGrade = [...bancos, ...ligaveis.filter((x) => x.grupo === 'aplicacao' && x.chavesOfx.length)];
  // Último mês com movimento em qualquer conta de banco (a empresa "anda" até aqui)
  const ultimoDaEmpresa = Math.max(0, ...linhasGrade.flatMap((c) => meses.filter((m) => temAlgo(c, m))));
  const encerradasManuais = new Map(encerramentosManuais.map((e) => [Number(e.codi_cta), String(e.encerrada_em instanceof Date ? e.encerrada_em.toISOString() : e.encerrada_em).slice(0, 10)]));
  const textoPlanilha = semAcento([empresa.obs, empresa.bancos, empresa.solicitado, empresa.na_pasta].filter(Boolean).join(' | '));

  for (const c of linhasGrade) {
    const ativos = meses.filter((m) => temAlgo(c, m));
    const encerramento = encerramentoDaConta(c, ano, encerradasManuais.get(c.codi));
    if (!ativos.length && igual(c.saldoInicial, 0) && !c.chavesOfx.length && !encerramento) continue;
    if (encerramento && encerramento.mes === 0 && !ativos.length && igual(c.saldoInicial, 0)) continue; // encerrada antes do ano e zerada

    const primeiro = igual(c.saldoInicial, 0) ? (ativos[0] || 13) : 1;
    const ultimo = ativos.length ? ativos[ativos.length - 1] : 0;
    let saldo = c.saldoInicial;
    const linhaMeses = [];
    for (const m of meses) {
      const mov = c.mov[m] || { deb: 0, cre: 0, qtd: 0 };
      saldo = r2(saldo + mov.deb - mov.cre);
      const ofx = c.ofx[m] || null;
      const imp = c.imp[m] || null;
      const outros = (c.outros && c.outros[m]) || [];
      let status;
      if (encerramento && m > encerramento.mes && !temAlgo(c, m)) {
        status = 'encerrada';
      } else if (ofx) {
        if (igual(ofx.ent, mov.deb) && igual(ofx.sai, mov.cre) && (mov.qtd || !ofx.qtd)) status = 'ok';
        // Extrato não importado; no máximo uns lançamentos avulsos na conta
        else if (!imp && mov.qtd * 4 < ofx.qtd) status = 'falta_importar';
        else status = 'diferenca';
      } else if (mov.qtd) {
        status = 'lancado_sem_ofx';
      } else if (outros.length) {
        status = 'falta_importar';
      } else if (m < primeiro) {
        status = 'sem_movimento';
      } else if (m > ultimo && igual(saldo, 0) && m - ultimo > 3) {
        status = 'sem_movimento';
      } else {
        status = 'falta_extrato';
      }
      linhaMeses.push({ m, status, ofx, dom: mov, imp, outros, saldo });
    }
    // Suspeita de encerramento (a equipe confirma na tela): a planilha fala em
    // encerramento desse banco, ou a conta parou com saldo enquanto as outras
    // contas da empresa continuam andando.
    let suspeita = null;
    if (!encerramento && c.grupo === 'banco') {
      const palavras = palavrasDaConta(c.nome);
      // Se a planilha e o nome da conta trazem número de conta, os números têm de combinar
      const numerosConta = numerosNoNome(c.nome);
      const trecho = textoPlanilha.split(/[|;\n]| \/ | - /).find((t) => {
        if (!/ENCERR/.test(t) || !palavras.some((p) => new RegExp(`\\b${p}\\b`).test(t))) return false;
        const numerosTrecho = numerosNoNome(t);
        return !numerosTrecho.length || !numerosConta.length || numerosTrecho.some((a) => numerosConta.some((b) => numeroCombina(a, b)));
      });
      if (trecho) suspeita = { motivo: 'planilha', texto: trecho.trim().slice(0, 120) };
      else if (!igual(saldo, 0) && ultimoDaEmpresa - ultimo >= 3) suspeita = { motivo: 'parada', desde: ultimo };
    }
    resultado.contas.push({
      codi: c.codi, nome: c.nome, clas: c.clas, grupo: c.grupo, chavesOfx: c.chavesOfx, saldoInicial: c.saldoInicial,
      saldoFinal: saldo, inativaNoDominio: c.inativa, encerramento, suspeita, meses: linhaMeses
    });
  }
  // Contas não identificadas entram no resumo do mês como pendência
  resultado.resumoMeses = meses.map((m) => {
    let pior = 'sem_movimento';
    for (const c of resultado.contas) {
      const s = c.meses[m - 1].status;
      if (PESO_STATUS[s] > PESO_STATUS[pior]) pior = s;
    }
    for (const n of resultado.naoIdentificadas) if (n.meses[m - 1].ofx && PESO_STATUS.nao_identificada > PESO_STATUS[pior]) pior = 'nao_identificada';
    return { m, status: pior };
  });

  // ---------------- Aplicações, empréstimos, cartões ----------------
  // Mês de referência: o último mês com lançamento em alguma conta de banco
  const mesRef = Math.max(0, ...bancos.flatMap((c) => meses.filter((m) => c.mov[m] && c.mov[m].qtd)));
  for (const c of contas.values()) {
    if (!['aplicacao', 'emprestimo', 'cartao', 'desconto'].includes(c.grupo)) continue;
    const temMov = meses.some((m) => c.mov[m] && c.mov[m].qtd);
    if (!temMov && igual(c.saldoInicial, 0)) continue;
    const natural = c.clas.startsWith('1') ? 1 : -1;
    let saldo = c.saldoInicial;
    const linha = [];
    const semLanc = [];
    for (const m of meses) {
      const mov = c.mov[m] || { deb: 0, cre: 0, qtd: 0 };
      const saldoAntes = saldo;
      saldo = r2(saldo + mov.deb - mov.cre);
      linha.push({ m, deb: mov.deb, cre: mov.cre, qtd: mov.qtd, saldo: r2(saldo * natural) });
      if (m <= mesRef && !mov.qtd && !igual(saldoAntes, 0)) semLanc.push(m);
    }
    const ultimoMes = Math.max(0, ...meses.filter((m) => c.mov[m] && c.mov[m].qtd));
    resultado.aplicacoes.push({
      codi: c.codi, nome: c.nome, clas: c.clas, grupo: c.grupo,
      saldoInicial: r2(c.saldoInicial * natural), saldoFinal: r2(saldo * natural),
      ultimoMes, mesesSemLancamento: semLanc, meses: linha
    });
  }
  resultado.aplicacoes.sort((a, b) => a.grupo.localeCompare(b.grupo) || a.clas.localeCompare(b.clas) || a.nome.localeCompare(b.nome));

  for (const c of contas.values()) {
    if (c.grupo !== 'conciliar') continue;
    let saldo = c.saldoInicial;
    const linha = meses.map((m) => {
      const mov = c.mov[m] || { deb: 0, cre: 0, qtd: 0 };
      saldo = r2(saldo + mov.deb - mov.cre);
      return { m, deb: mov.deb, cre: mov.cre, qtd: mov.qtd, saldo };
    });
    if (linha.some((l) => l.qtd) || !igual(c.saldoInicial, 0)) {
      resultado.aConciliar.push({ codi: c.codi, nome: c.nome, saldoInicial: c.saldoInicial, saldoFinal: saldo, meses: linha });
    }
  }

  montarPendencias(resultado);
  return resultado;
}

function listaMeses(ms) {
  return ms.map(nomeMes).join(', ');
}

function montarPendencias(r) {
  const p = [];
  if (!r.pasta.existe) {
    p.push({ tipo: 'pasta', gravidade: 'alta', texto: 'Pasta da empresa não encontrada em "01 - Empresas Ativas". Indique a pasta certa.' });
  } else if (!r.pasta.anoExiste) {
    // Sem conta de banco com movimento no Domínio, a falta da pasta é só um aviso
    const temBanco = r.contas.length > 0;
    p.push({
      tipo: 'pasta', gravidade: temBanco ? 'alta' : 'baixa',
      texto: `Não existe a pasta ${r.ano} em CONTABILIDADE\\MOVIMENTO CONTABIL${temBanco ? '.' : ' (e não há conta bancária com movimento no Domínio).'}`
    });
  }

  const pedidos = new Map(); // meses que faltam → contas (um pedido ao cliente por grupo)
  for (const c of r.contas) {
    const faltaExtrato = [];
    for (const mm of c.meses) {
      if (mm.status === 'falta_importar' && mm.ofx) {
        p.push({
          tipo: 'importar', gravidade: 'media', mes: mm.m, codi: c.codi, conta: c.nome,
          texto: `Importar o OFX de ${nomeMes(mm.m)} no Domínio${mm.dom.qtd ? ` (a conta já tem ${mm.dom.qtd} lançamento(s) avulso(s) no mês — conferir para não duplicar)` : ''}`,
          valores: { entradas: mm.ofx.ent, saidas: mm.ofx.sai, movimentos: mm.ofx.qtd }, arquivos: mm.ofx.arquivos
        });
      } else if (mm.status === 'falta_importar') {
        p.push({
          tipo: 'importar', gravidade: 'media', mes: mm.m, codi: c.codi, conta: c.nome,
          texto: `Lançar o extrato de ${nomeMes(mm.m)} (não há OFX na pasta, só ${mm.outros.map((a) => a.split('.').pop().toUpperCase()).filter((v, i, l) => l.indexOf(v) === i).join('/')})`,
          arquivos: mm.outros
        });
      } else if (mm.status === 'diferenca') {
        const dq = mm.dom.qtd - mm.ofx.qtd;
        const extra = (dq > 0 ? ` O Domínio tem ${dq} lançamento(s) a mais que o extrato.` : dq < 0 ? ` Faltam ${-dq} lançamento(s) no Domínio.` : '')
          + (mm.imp && mm.imp.semLanc ? ` ${mm.imp.semLanc} linha(s) do extrato importado não viraram lançamento.` : '');
        p.push({
          tipo: 'diferenca', gravidade: 'alta', mes: mm.m, codi: c.codi, conta: c.nome,
          texto: `Extrato de ${nomeMes(mm.m)} não bate com o Domínio.${extra}`,
          valores: {
            entradasExtrato: mm.ofx.ent, entradasDominio: mm.dom.deb, difEntradas: r2(mm.ofx.ent - mm.dom.deb),
            saidasExtrato: mm.ofx.sai, saidasDominio: mm.dom.cre, difSaidas: r2(mm.ofx.sai - mm.dom.cre)
          },
          arquivos: mm.ofx.arquivos
        });
      } else if (mm.status === 'falta_extrato') {
        faltaExtrato.push(mm.m);
      }
    }
    const mesAno = (m) => (m === 0 ? `antes de ${r.ano}` : `${nomeMes(m)}/${r.ano}`);
    if (c.encerramento) {
      const e = c.encerramento;
      const fonte = { manual: 'marcada pela equipe', dominio: 'inativada no Domínio', arquivo: `arquivo "${(e.arquivo || '').split('\\').pop()}"` }[e.origem];
      if (!igual(c.saldoFinal, 0)) {
        p.push({
          tipo: 'encerrada', gravidade: 'media', codi: c.codi, conta: c.nome, valores: { saldo: c.saldoFinal },
          texto: `Conta encerrada (${mesAno(e.mes)}, ${fonte}) e ainda com saldo no Domínio: zerar o saldo.`
        });
      }
      const depois = c.meses.filter((mm) => mm.m > e.mes && mm.status !== 'encerrada').map((mm) => mm.m);
      if (depois.length) {
        p.push({ tipo: 'encerrada', gravidade: 'alta', codi: c.codi, conta: c.nome, meses: depois, texto: `Conta encerrada (${mesAno(e.mes)}), mas tem movimento ou extrato em ${listaMeses(depois)}: conferir a data de encerramento.` });
      }
      if (!c.inativaNoDominio && igual(c.saldoFinal, 0) && !depois.length) {
        p.push({ tipo: 'encerrada', gravidade: 'baixa', codi: c.codi, conta: c.nome, texto: `Conta encerrada (${mesAno(e.mes)}, ${fonte}) e zerada; ainda ativa no plano do Domínio.` });
      }
    } else if (c.suspeita) {
      const s = c.suspeita;
      p.push({
        tipo: 'verificar_encerrada', gravidade: 'media', codi: c.codi, conta: c.nome, meses: faltaExtrato, valores: { saldo: c.saldoFinal },
        texto: s.motivo === 'planilha'
          ? `A planilha indica encerramento ("${s.texto}"). Confirmar e marcar a conta como encerrada.`
          : `Conta parada ${s.desde ? `desde ${nomeMes(s.desde)}` : `em ${r.ano}`} e com saldo no Domínio, enquanto as outras contas andam: foi encerrada? Se não, pedir o extrato${faltaExtrato.length ? ` de ${listaMeses(faltaExtrato)}` : ''}.`
      });
      faltaExtrato.length = 0; // o pedido de extrato fica junto da suspeita
    }
    if (faltaExtrato.length) {
      const k = faltaExtrato.join(',');
      if (!pedidos.has(k)) pedidos.set(k, { meses: faltaExtrato, contas: [] });
      pedidos.get(k).contas.push(c.nome);
    }
  }
  for (const { meses, contas } of pedidos.values()) {
    p.push({
      tipo: 'extrato', gravidade: 'media', meses, contas, conta: contas.join(', '),
      texto: `Pedir ao cliente ${contas.length > 1 ? 'os extratos' : 'o extrato'} de ${listaMeses(meses)}`
    });
  }

  for (const n of r.naoIdentificadas) {
    const ms = n.meses.filter((x) => x.ofx).map((x) => x.m);
    p.push({
      tipo: 'vincular', gravidade: 'alta', meses: ms, chave: n.chave,
      conta: `${n.instituicao || `Banco ${n.banco}`} — conta ${n.conta || '?'}`,
      texto: 'Extrato sem conta correspondente no Domínio: indique a conta (ou cadastre-a no plano de contas).'
    });
  }

  const ROTULO = { aplicacao: 'Aplicação', emprestimo: 'Empréstimo', cartao: 'Cartão', desconto: 'Desconto de títulos' };
  for (const a of r.aplicacoes) {
    if (!a.mesesSemLancamento.length) continue;
    const oque = { aplicacao: 'rendimento/aplicações e resgates', emprestimo: 'parcelas e juros', cartao: 'fatura', desconto: 'movimento' }[a.grupo];
    p.push({
      tipo: a.grupo, gravidade: 'media', meses: a.mesesSemLancamento, codi: a.codi, conta: a.nome,
      texto: `${ROTULO[a.grupo]} com saldo e sem lançamento em ${listaMeses(a.mesesSemLancamento)} (conferir ${oque})`
    });
  }

  for (const c of r.aConciliar) {
    if (!igual(c.saldoFinal, 0)) {
      p.push({ tipo: 'conciliar', gravidade: 'baixa', codi: c.codi, conta: c.nome, texto: 'Conta de lançamentos a conciliar com saldo: valores do banco ainda sem classificação.', valores: { saldo: c.saldoFinal } });
    }
  }
  r.pendencias = p;
}

// ------------------------------------------------------------------
// Banco de dados do sistema
// ------------------------------------------------------------------

async function conferirEGravar(cbEmpresaId, ano, usuarioId) {
  const { rows } = await query('SELECT * FROM cb_empresas WHERE id = $1', [cbEmpresaId]);
  if (!rows.length) throw Object.assign(new Error('Empresa não encontrada.'), { status: 404 });
  const empresa = rows[0];
  const vinculos = (await query('SELECT chave_ofx, codi_cta FROM cb_vinculos_conta WHERE cb_empresa_id = $1', [cbEmpresaId])).rows;
  const encerradas = (await query("SELECT codi_cta, to_char(encerrada_em, 'YYYY-MM-DD') AS encerrada_em FROM cb_contas_encerradas WHERE cb_empresa_id = $1", [cbEmpresaId])).rows;
  try {
    const resultado = await conferirEmpresa(empresa, ano, vinculos, encerradas);
    await query(
      `INSERT INTO cb_conferencias (cb_empresa_id, ano, resultado, meses, pendencias, erro, conferido_em, conferido_por)
       VALUES ($1, $2, $3, $4, $5, NULL, NOW(), $6)
       ON CONFLICT (cb_empresa_id, ano) DO UPDATE SET resultado = EXCLUDED.resultado, meses = EXCLUDED.meses,
         pendencias = EXCLUDED.pendencias, erro = NULL, conferido_em = NOW(), conferido_por = EXCLUDED.conferido_por`,
      [cbEmpresaId, ano, JSON.stringify(resultado), JSON.stringify(resultado.resumoMeses), resultado.pendencias.filter((p) => p.gravidade !== 'baixa').length, usuarioId || null]
    );
    return resultado;
  } catch (err) {
    await query(
      `INSERT INTO cb_conferencias (cb_empresa_id, ano, resultado, erro, conferido_em, conferido_por)
       VALUES ($1, $2, NULL, $3, NOW(), $4)
       ON CONFLICT (cb_empresa_id, ano) DO UPDATE SET erro = EXCLUDED.erro, conferido_em = NOW(), conferido_por = EXCLUDED.conferido_por`,
      [cbEmpresaId, ano, err.message.slice(0, 500), usuarioId || null]
    );
    throw err;
  }
}

// Conferência de várias empresas em segundo plano (uma rodada por vez)
const lote = { rodando: false, ano: null, total: 0, feitos: 0, comErro: 0, atual: null, inicio: null, fim: null, usuario: null };

function statusLote() {
  return { ...lote };
}

function conferirVarias(ids, ano, usuario) {
  if (lote.rodando) throw Object.assign(new Error('Já existe uma conferência em andamento. Aguarde terminar.'), { status: 409 });
  Object.assign(lote, { rodando: true, ano, total: ids.length, feitos: 0, comErro: 0, atual: null, inicio: new Date().toISOString(), fim: null, usuario: usuario.nome });
  const fila = [...ids];
  const trabalhar = async () => {
    while (fila.length) {
      const id = fila.shift();
      lote.atual = id;
      try { await conferirEGravar(id, ano, usuario.id); } catch (e) { lote.comErro++; }
      lote.feitos++;
    }
  };
  // Duas ao mesmo tempo: uma lê a pasta enquanto a outra consulta o Domínio
  Promise.all([trabalhar(), trabalhar()]).finally(() => {
    lote.rodando = false;
    lote.atual = null;
    lote.fim = new Date().toISOString();
  });
  return statusLote();
}

module.exports = { conferirEmpresa, conferirEGravar, conferirVarias, statusLote, mesLimiteDoAno, classificarConta };
