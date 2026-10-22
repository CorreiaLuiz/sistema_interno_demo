const fs = require('fs');
const ExcelJS = require('exceljs');
const { query } = require('../config/db');
const { consultarDominio } = require('./dominioService');

/**
 * Cadastro da conferência bancária: lê a planilha "Controle Extratos CC"
 * (aba Digitação), completa o código do Domínio pelo CNPJ quando a
 * planilha não traz, e descobre a pasta de cada empresa em
 * "01 - Empresas Ativas". O que a equipe corrigiu à mão (código ou
 * pasta) nunca é sobrescrito por uma nova leitura da planilha.
 */

const PALAVRAS_IGNORADAS = new Set(['LTDA', 'EIRELI', 'ME', 'EPP', 'SLU', 'SS', 'MEI']);

function normalizarNome(texto) {
  return String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/&/g, ' E ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t && !PALAVRAS_IGNORADAS.has(t))
    .join(' ');
}

const compacto = (texto) => normalizarNome(texto).replace(/ /g, '');

function soDigitos(valor) {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'number') return String(Math.round(valor));
  return String(valor).replace(/\D/g, '');
}

/** Valor "puro" de uma célula do ExcelJS (texto rico, fórmula, link...). */
function valorCelula(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((p) => p.text).join('');
    if ('result' in v) return valorCelula(v.result);
    if ('text' in v) return v.text;
    return null;
  }
  return v;
}

function texto(v, max = 200) {
  const val = valorCelula(v);
  if (val === null || val === undefined) return null;
  if (val instanceof Date) return val.toISOString().slice(0, 10).split('-').reverse().join('/');
  const t = String(val).replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
}

async function lerPlanilha(caminho) {
  const buffer = await fs.promises.readFile(caminho);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet('Digitação') || wb.worksheets[0];

  const cab = ws.getRow(1).values.map((v) => String(valorCelula(v) || '').trim().toUpperCase());
  if (cab[5] !== 'CNPJ' || !String(cab[13]).startsWith('BANCO')) {
    throw new Error('O layout da planilha mudou (esperava "CNPJ" na coluna E e "Banco(s)" na coluna M da aba Digitação).');
  }

  const empresas = new Map();
  ws.eachRow((row, numero) => {
    if (numero < 3) return;
    const v = row.values;
    const nome = texto(v[4]);
    if (!nome) return;
    let cnpj = soDigitos(valorCelula(v[5]));
    if (cnpj && cnpj.length < 14 && cnpj.length > 8) cnpj = cnpj.padStart(14, '0');
    if (cnpj.length !== 14) cnpj = '';
    const codigo = parseInt(soDigitos(valorCelula(v[7])), 10);
    const chave = cnpj || `N:${compacto(nome)}`.slice(0, 60);
    if (empresas.has(chave)) return;
    empresas.set(chave, {
      chave,
      nome,
      cnpj: cnpj || null,
      codigoPlanilha: Number.isInteger(codigo) && codigo > 0 ? codigo : null,
      responsavel: texto(v[3], 10),
      regime: texto(v[9], 10),
      situacao: texto(v[10], 10),
      contato: texto(v[11]),
      malote: texto(v[12], 40),
      bancos: texto(v[13], 300),
      formato: texto(v[14], 40),
      extratos: texto(v[15], 40),
      solicitado: [texto(v[16]), texto(v[17])].filter(Boolean).join(' — ').slice(0, 200) || null,
      naPasta: texto(v[18]),
      obs: [texto(v[19], 500), texto(v[20], 500)].filter(Boolean).join(' / ') || null
    });
  });
  return [...empresas.values()];
}

/** Lista as pastas de "01 - Empresas Ativas" (cache de 10 minutos). */
let cachePastas = { em: 0, lista: [] };
async function listarPastasEmpresas() {
  if (Date.now() - cachePastas.em < 10 * 60 * 1000 && cachePastas.lista.length) return cachePastas.lista;
  const base = process.env.CB_PASTA_EMPRESAS;
  if (!base) throw new Error('Pasta das empresas não configurada (CB_PASTA_EMPRESAS no .env).');
  const itens = await fs.promises.readdir(base, { withFileTypes: true });
  const lista = itens.filter((i) => i.isDirectory()).map((i) => i.name).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  cachePastas = { em: Date.now(), lista };
  return lista;
}

/**
 * Acha a pasta da empresa pelo nome (da planilha e do Domínio):
 * 1) nome igual depois de tirar acentos, pontuação e LTDA/EIRELI/ME;
 * 2) uma pasta cujo nome começa com o da empresa (ou o contrário);
 * 3) palavras em comum, aceitando abreviação ("BELTR." = BELTRONENSE,
 *    "SERV." = SERVIÇOS) e ignorando "- MATRIZ"/"- FILIAL" (na empate, a
 *    matriz fica com a empresa e a filial com quem tem FILIAL no nome);
 * 4) todas as palavras de um nome estão no outro ("LUIS CESAR SANTANA").
 * Na dúvida (dois candidatos), não escolhe nenhuma.
 */
const LIGACOES = new Set(['DE', 'DA', 'DO', 'DOS', 'DAS', 'E', 'EM', 'PARA', 'A', 'O']);
const palavrasChave = (nome) => normalizarNome(nome).split(' ').filter((t) => t && !LIGACOES.has(t));

function palavraCombina(a, b) {
  if (a === b) return true;
  const [curta, longa] = a.length <= b.length ? [a, b] : [b, a];
  return curta.length >= 2 && !/^\d+$/.test(curta) && longa.startsWith(curta);
}

function criarLocalizadorDePastas(pastas) {
  const itens = pastas.map((nome) => {
    const tokens = palavrasChave(nome);
    return { nome, c: compacto(nome), tokens: tokens.filter((t) => t !== 'MATRIZ' && t !== 'FILIAL'), matriz: tokens.includes('MATRIZ'), filial: tokens.includes('FILIAL') };
  });
  const unico = (lista) => (lista.length === 1 ? lista[0].nome : null);

  return function localizar(...nomes) {
    const alvos = nomes.filter(Boolean).map((n) => {
      const tokens = palavrasChave(n);
      return { c: compacto(n), tokens: tokens.filter((t) => t !== 'MATRIZ' && t !== 'FILIAL'), filial: tokens.includes('FILIAL') };
    }).filter((a) => a.c.length >= 3);
    for (const a of alvos) {
      const r = unico(itens.filter((i) => i.c === a.c));
      if (r) return r;
    }
    for (const a of alvos) {
      if (a.c.length < 8) continue;
      const r = unico(itens.filter((i) => i.c.length >= 8 && (i.c.startsWith(a.c) || a.c.startsWith(i.c))));
      if (r) return r;
    }

    const combinadas = (x, y) => x.filter((t) => y.some((u) => palavraCombina(t, u))).length;
    const notas = itens.map((i) => {
      let nota = 0;
      for (const a of alvos) {
        const n = combinadas(a.tokens, i.tokens) / Math.max(a.tokens.length, i.tokens.length);
        // Empate matriz x filial: a filial só serve para quem tem FILIAL no nome
        const ajuste = (i.filial && !a.filial) || (!i.filial && a.filial) ? -0.01 : (i.matriz ? 0.005 : 0);
        nota = Math.max(nota, n + (n >= 0.8 ? ajuste : 0));
      }
      return { nome: i.nome, nota };
    }).sort((x, y) => y.nota - x.nota);
    if (notas.length && notas[0].nota >= 0.79 && (notas.length === 1 || notas[0].nota > notas[1].nota)) return notas[0].nome;

    // Nome mais curto contido no outro (pelo menos duas palavras)
    for (const a of alvos) {
      const r = unico(itens.filter((i) => {
        const [menor, maior] = i.tokens.length <= a.tokens.length ? [i.tokens, a.tokens] : [a.tokens, i.tokens];
        return menor.length >= 2 && menor.join('').length >= 8 && combinadas(menor, maior) === menor.length;
      }));
      if (r) return r;
    }
    return null;
  };
}

/** Lê a planilha e atualiza o cadastro. Devolve um resumo do que mudou. */
async function importarPlanilha() {
  const caminho = process.env.CB_PLANILHA;
  if (!caminho) throw new Error('Caminho da planilha não configurado (CB_PLANILHA no .env).');
  const linhas = await lerPlanilha(caminho);

  const dominio = await consultarDominio({
    empresas: 'select codi_emp, nome_emp, cgce_emp from bethadba.geempre'
  });
  const porCodigo = new Map();
  const porCnpj = new Map();
  for (const [codigo, nome, cnpj] of dominio.empresas) {
    porCodigo.set(Number(codigo), { codigo: Number(codigo), nome, cnpj: soDigitos(cnpj) });
    const c = soDigitos(cnpj);
    if (c.length === 14 && (!porCnpj.has(c) || Number(codigo) > porCnpj.get(c).codigo)) {
      porCnpj.set(c, { codigo: Number(codigo), nome });
    }
  }

  const localizar = criarLocalizadorDePastas(await listarPastasEmpresas());
  const atuais = new Map((await query('SELECT chave, codigo_dominio, codigo_origem, pasta, pasta_manual FROM cb_empresas')).rows.map((r) => [r.chave, r]));

  const resumo = { lidas: linhas.length, novas: 0, atualizadas: 0, semCodigo: 0, semPasta: 0, codigoPeloCnpj: 0 };
  // 1ª passada: código do Domínio e pasta de cada empresa
  const decisoes = linhas.map((e) => {
    const atual = atuais.get(e.chave);
    let codigo = e.codigoPlanilha;
    let origem = codigo ? 'planilha' : null;
    if (atual && atual.codigo_origem === 'manual') {
      codigo = atual.codigo_dominio;
      origem = 'manual';
    } else if (!codigo && e.cnpj && porCnpj.has(e.cnpj)) {
      codigo = porCnpj.get(e.cnpj).codigo;
      origem = 'cnpj';
      resumo.codigoPeloCnpj++;
    }
    const nomeDominio = codigo && porCodigo.has(codigo) ? porCodigo.get(codigo).nome : null;
    const manual = !!(atual && atual.pasta_manual);
    const pasta = manual ? atual.pasta : localizar(nomeDominio, e.nome);
    return { e, codigo, origem, nomeDominio, pasta, manual };
  });

  // Matriz e filial não podem ler a mesma pasta (a filial conferiria os extratos
  // da matriz): pasta com "FILIAL" no nome fica com a filial; sem, com a matriz.
  const ehMatriz = (d) => !d.e.cnpj || d.e.cnpj.slice(8, 12) === '0001';
  const porPasta = new Map();
  for (const d of decisoes) if (d.pasta && !d.manual) (porPasta.get(d.pasta) || porPasta.set(d.pasta, []).get(d.pasta)).push(d);
  for (const [pasta, grupo] of porPasta) {
    if (grupo.length < 2) continue;
    const daFilial = /FILIAL/.test(normalizarNome(pasta));
    for (const d of grupo) if (daFilial ? ehMatriz(d) : !ehMatriz(d)) d.pasta = null;
  }

  for (const { e, codigo, origem, nomeDominio, pasta } of decisoes) {
    const atual = atuais.get(e.chave);
    if (!codigo) resumo.semCodigo++;
    if (!pasta) resumo.semPasta++;
    await query(
      `INSERT INTO cb_empresas (chave, nome, cnpj, codigo_dominio, codigo_origem, nome_dominio, responsavel, regime, situacao,
         contato, malote, bancos, formato, extratos, solicitado, na_pasta, obs, pasta, na_planilha, atualizado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,TRUE,NOW())
       ON CONFLICT (chave) DO UPDATE SET
         nome = EXCLUDED.nome, cnpj = EXCLUDED.cnpj, codigo_dominio = EXCLUDED.codigo_dominio,
         codigo_origem = EXCLUDED.codigo_origem, nome_dominio = EXCLUDED.nome_dominio,
         responsavel = EXCLUDED.responsavel, regime = EXCLUDED.regime, situacao = EXCLUDED.situacao,
         contato = EXCLUDED.contato, malote = EXCLUDED.malote, bancos = EXCLUDED.bancos, formato = EXCLUDED.formato,
         extratos = EXCLUDED.extratos, solicitado = EXCLUDED.solicitado, na_pasta = EXCLUDED.na_pasta, obs = EXCLUDED.obs,
         pasta = EXCLUDED.pasta, na_planilha = TRUE, atualizado_em = NOW()`,
      [e.chave, e.nome, e.cnpj, codigo, origem, nomeDominio, e.responsavel, e.regime, e.situacao, e.contato, e.malote,
        e.bancos, e.formato, e.extratos, e.solicitado, e.naPasta, e.obs, pasta]
    );
    if (atual) resumo.atualizadas++; else resumo.novas++;
  }

  // Quem saiu da planilha continua no cadastro (com o histórico), só marcado
  const chaves = linhas.map((e) => e.chave);
  const saiu = await query('UPDATE cb_empresas SET na_planilha = FALSE WHERE na_planilha AND NOT (chave = ANY($1))', [chaves]);
  resumo.foraDaPlanilha = saiu.rowCount;

  // Liga ao cadastro de empresas do sistema pelo CNPJ (para a ficha da empresa)
  await query(
    `UPDATE cb_empresas c SET empresa_id = e.id FROM empresas e
      WHERE c.cnpj IS NOT NULL AND regexp_replace(e.cnpj, '\\D', '', 'g') = c.cnpj
        AND c.empresa_id IS DISTINCT FROM e.id`
  );
  return resumo;
}

/** Nome da empresa no Domínio a partir do código (para correção manual). */
async function nomeNoDominio(codigo) {
  const r = await consultarDominio({ emp: `select nome_emp, cgce_emp from bethadba.geempre where codi_emp=${Number(codigo)}` });
  return r.emp.length ? { nome: r.emp[0][0], cnpj: soDigitos(r.emp[0][1]) } : null;
}

module.exports = { importarPlanilha, listarPastasEmpresas, nomeNoDominio, normalizarNome };
