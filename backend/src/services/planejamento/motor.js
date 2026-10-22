/**
 * Planejamento tributário — motor de cálculo (regras fixas, auditáveis).
 *
 *   calcular({ dados, respostas, parametros }) → resultado
 *     dados      : saída de extracao.extrairEmpresa (Domínio, 12 meses)
 *     respostas  : questionário do cliente (opcional)
 *     parametros : parametros.json (alíquotas; ajustes por CNPJ em ajustes_empresa)
 *
 * Compara Simples (atual), Lucro Presumido e Lucro Real em 2026 e, para
 * 2027, Simples "puro" x híbrido (IBS/CBS fora do DAS). O Simples atual é
 * validado contra a alíquota que o próprio Domínio apurou.
 */

// ---------- Tabelas do Simples Nacional (LC 123/2006, Anexos I a V) ----------
// faixas: [limite RBT12, aliquota nominal, parcela a deduzir, reparticao {irpj,csll,cofins,pis,cpp,icms,iss,ipi}]
const r = (irpj, csll, cofins, pis, cpp, icms = 0, iss = 0, ipi = 0) => ({ irpj, csll, cofins, pis, cpp, icms, iss, ipi });
const SIMPLES = {
  1: [
    [180000, 0.04, 0, r(5.5, 3.5, 12.74, 2.76, 41.5, 34)],
    [360000, 0.073, 5940, r(5.5, 3.5, 12.74, 2.76, 41.5, 34)],
    [720000, 0.095, 13860, r(5.5, 3.5, 12.74, 2.76, 42, 33.5)],
    [1800000, 0.107, 22500, r(5.5, 3.5, 12.74, 2.76, 42, 33.5)],
    [3600000, 0.143, 87300, r(5.5, 3.5, 12.74, 2.76, 42, 33.5)],
    [4800000, 0.19, 378000, r(13.5, 10, 28.27, 6.13, 42.1, 0)],
  ],
  2: [
    [180000, 0.045, 0, r(5.5, 3.5, 11.51, 2.49, 37.5, 32, 0, 7.5)],
    [360000, 0.078, 5940, r(5.5, 3.5, 11.51, 2.49, 37.5, 32, 0, 7.5)],
    [720000, 0.10, 13860, r(5.5, 3.5, 11.51, 2.49, 37.5, 32, 0, 7.5)],
    [1800000, 0.112, 22500, r(5.5, 3.5, 11.51, 2.49, 37.5, 32, 0, 7.5)],
    [3600000, 0.147, 85500, r(5.5, 3.5, 11.51, 2.49, 37.5, 32, 0, 7.5)],
    [4800000, 0.30, 720000, r(8.5, 7.5, 20.96, 4.54, 23.5, 0, 0, 35)],
  ],
  3: [
    [180000, 0.06, 0, r(4, 3.5, 12.82, 2.78, 43.4, 0, 33.5)],
    [360000, 0.112, 9360, r(4, 3.5, 14.05, 3.05, 43.4, 0, 32)],
    [720000, 0.135, 17640, r(4, 3.5, 13.64, 2.96, 43.4, 0, 32.5)],
    [1800000, 0.16, 35640, r(4, 3.5, 13.64, 2.96, 43.4, 0, 32.5)],
    [3600000, 0.21, 125640, r(4, 3.5, 12.82, 2.78, 43.4, 0, 33.5)],
    [4800000, 0.33, 648000, r(35, 15, 16.03, 3.47, 30.5, 0, 0)],
  ],
  4: [
    [180000, 0.045, 0, r(18.8, 15.2, 17.67, 3.83, 0, 0, 44.5)],
    [360000, 0.09, 8100, r(19.8, 15.2, 20.55, 4.45, 0, 0, 40)],
    [720000, 0.102, 12420, r(20.8, 15.2, 19.73, 4.27, 0, 0, 40)],
    [1800000, 0.14, 39780, r(17.8, 19.2, 18.9, 4.1, 0, 0, 40)],
    [3600000, 0.22, 183780, r(18.8, 19.2, 18.08, 3.92, 0, 0, 40)],
    [4800000, 0.33, 828000, r(53.5, 21.5, 20.55, 4.45, 0, 0, 0)],
  ],
  5: [
    [180000, 0.155, 0, r(25, 15, 14.1, 3.05, 28.85, 0, 14)],
    [360000, 0.18, 4500, r(23, 15, 14.1, 3.05, 27.85, 0, 17)],
    [720000, 0.195, 9900, r(24, 15, 14.92, 3.23, 23.85, 0, 19)],
    [1800000, 0.205, 17100, r(21, 15, 15.74, 3.41, 23.85, 0, 21)],
    [3600000, 0.23, 62100, r(23, 12.5, 14.1, 3.05, 23.85, 0, 23.5)],
    [4800000, 0.305, 540000, r(35, 15.5, 16.44, 3.56, 29.5, 0, 0)],
  ],
};

// Aliquota efetiva do Simples para um anexo e RBT12; semST/semISS tiram a parcela do ICMS/ISS
function simplesEfetiva(anexo, rbt12, { semICMS = false } = {}) {
  const tab = SIMPLES[anexo];
  const i = Math.max(0, tab.findIndex((f) => rbt12 <= f[0]));
  const [, nominal, deduzir, rep] = tab[i === -1 ? tab.length - 1 : i];
  const efetiva = rbt12 > 0 ? Math.max(0, (rbt12 * nominal - deduzir) / rbt12) : nominal;
  const parte = (k) => (efetiva * rep[k]) / 100;
  let total = efetiva;
  if (semICMS) total -= parte('icms');
  return { faixa: i + 1, nominal, efetiva: total, pisCofins: parte('pis') + parte('cofins'), cppIncluso: rep.cpp > 0, rep };
}

// ---------- Classificacao por CFOP ----------
const fim3 = (cfop) => cfop % 1000;
function classificaSaida(cfop, origem) {
  if (origem === 'servico') return 'servico';
  const f = fim3(cfop);
  if ([933, 932].includes(f)) return 'servico';
  if (f >= 401 && f <= 405) return 'mercadoria_st';
  if ((f >= 101 && f <= 124) || f === 501 || Math.floor(cfop / 1000) === 7) return 'mercadoria';
  return 'nao_receita'; // remessas, devolucoes de compra, outras saidas
}
function classificaCompra(cfop) {
  const f = fim3(cfop);
  const inter = Math.floor(cfop / 1000) === 2;
  if ([201, 202, 410, 411].includes(f)) return 'devolucao_venda';
  if ([101, 102, 111, 113, 116, 117, 118, 120, 121, 122, 124, 125, 126].includes(f)) return inter ? 'revenda_inter' : 'revenda_interna';
  if (f >= 401 && f <= 407 && f !== 406 && f !== 407) return 'revenda_st';
  if ([406, 407, 556].includes(f)) return 'uso_consumo';
  if ([551, 406].includes(f)) return 'ativo';
  if ([252, 253, 254, 255, 256, 257].includes(f)) return 'energia';
  if ([933, 353, 352, 351, 354, 355, 356].includes(f)) return 'servico';
  return 'outras';
}

// ---------- Utilitarios ----------
const soma = (arr, fn = (x) => x) => arr.reduce((s, x) => s + (fn(x) || 0), 0);
const meses12 = (inicio) => {
  const [a, m] = inicio.split('-').map(Number);
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(a, m - 1 + i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
};
const irpj = (base, p) => Math.max(0, base) * p.irpj + Math.max(0, base - p.irpj_limite_adicional_ano) * p.irpj_adicional;

function calcular({ dados, respostas = null, parametros }) {
  const cnpj = dados.empresa.cnpj;
  const resp = respostas;
  const P = parametros;
  const aj = (P.ajustes_empresa || {})[cnpj] || {};
  const alertas = [];
  const premissas = [];

  // ----- Receitas mes a mes -----
  const meses = meses12(dados.periodo.inicio);
  const rec = Object.fromEntries(meses.map((m) => [m, { mercadoria: 0, mercadoria_st: 0, servico: 0, fonte: null }]));
  for (const x of dados.receitas) {
    const c = classificaSaida(x.cfop, x.origem);
    if (c !== 'nao_receita' && rec[x.mes]) { rec[x.mes][c] += x.valor; rec[x.mes].fonte = 'dominio'; }
  }
  const devol = {};
  for (const x of dados.compras) if (classificaCompra(x.cfop) === 'devolucao_venda') devol[x.mes] = (devol[x.mes] || 0) + x.valor;
  const mesesDominio = meses.filter((m) => rec[m].fonte === 'dominio');
  const totDom = { mercadoria: 0, mercadoria_st: 0, servico: 0 };
  for (const m of mesesDominio) for (const k in totDom) totDom[k] += rec[m][k];
  const totDomGeral = totDom.mercadoria + totDom.mercadoria_st + totDom.servico;
  // meses antes do Dominio: usa receita_anterior distribuida pelo mesmo mix
  for (const x of dados.receita_anterior || []) {
    const m = rec[x.mes];
    if (m && m.fonte !== 'dominio' && totDomGeral > 0) {
      for (const k in totDom) m[k] = (x.valor * totDom[k]) / totDomGeral;
      m.fonte = 'anterior';
    }
  }
  const mesesComReceita = meses.filter((m) => rec[m].fonte);
  if (mesesComReceita.length < 12) {
    alertas.push(`Só há faturamento de ${mesesComReceita.length} dos 12 meses (${mesesComReceita[0]} a ${mesesComReceita.at(-1)}). O ano foi projetado pela média mensal.`);
    if (!(dados.receita_anterior || []).length) {
      alertas.push('Sem receita bruta anterior no Domínio. Se a empresa era MEI ou veio de outro escritório, cadastrar a receita anterior: ela entra no RBT12 e muda a faixa do DAS.');
    }
  }
  const fatorAno = mesesComReceita.length ? 12 / mesesComReceita.length : 0;
  const R = { mercadoria: 0, mercadoria_st: 0, servico: 0 };
  for (const m of mesesComReceita) for (const k in R) R[k] += rec[m][k] * fatorAno;
  const devolAno = soma(Object.values(devol)) * (mesesDominio.length ? 12 / mesesDominio.length : 0);
  if (devolAno > 0) R.mercadoria = Math.max(0, R.mercadoria - devolAno);
  R.total = R.mercadoria + R.mercadoria_st + R.servico;
  const rbt12 = R.total;

  // ----- Compras (anualizadas pelos meses do Dominio) -----
  const fatorDom = mesesDominio.length ? 12 / mesesDominio.length : 0;
  const C = {};
  for (const x of dados.compras) {
    const c = classificaCompra(x.cfop);
    C[c] = (C[c] || 0) + x.valor * fatorDom;
  }
  const comp = (k) => C[k] || 0;
  const comprasRevenda = comp('revenda_interna') + comp('revenda_inter') + comp('revenda_st');
  const comprasTotal = soma(Object.entries(C).filter(([k]) => k !== 'devolucao_venda'), ([, v]) => v);

  // ----- Folha (sem distribuicao de lucros) -----
  const tiposFolha = new Set([11, 51, 52]);
  const desconhecidos = new Set();
  let proLabore = 0, clt = 0, lucrosDistribuidos = 0;
  const mesesFolha = new Set();
  for (const f of dados.folha) {
    if (f.tipo === 70) { lucrosDistribuidos += f.proventos; continue; }
    if (!tiposFolha.has(f.tipo)) { desconhecidos.add(f.tipo); continue; }
    mesesFolha.add(f.mes);
    if (f.vinculo === 11) proLabore += f.proventos; else clt += f.proventos;
  }
  if (desconhecidos.size) alertas.push(`Folha: processos ${[...desconhecidos].join(', ')} ignorados (conferir se são férias, rescisão etc.).`);
  proLabore *= fatorDom; clt *= fatorDom; lucrosDistribuidos *= fatorDom;
  const folhaTotal = proLabore + clt;

  // ----- Simples atual (Dominio) -----
  const anexosDominio = [...new Set(dados.simples.map((s) => s.anexo))];
  const anexoMerc = anexosDominio.includes(2) ? 2 : 1;
  const anexoServ = anexosDominio.find((a) => a >= 3) || 3;
  if (!anexosDominio.length) premissas.push('Empresa sem apuração do Simples no Domínio: anexos presumidos (I para comércio, III para serviço).');
  const sM = simplesEfetiva(anexoMerc, rbt12);
  const sMst = simplesEfetiva(anexoMerc, rbt12, { semICMS: true });
  const sS = simplesEfetiva(anexoServ, rbt12);
  const das = R.mercadoria * sM.efetiva + R.mercadoria_st * sMst.efetiva + R.servico * sS.efetiva;
  const cppForaDAS = anexoServ === 4 && R.servico > 0 ? folhaTotal * P.folha.inss_patronal + clt * P.folha.rat : 0;
  const ultimo = [...dados.simples].sort((a, b) => a.mes.localeCompare(b.mes)).filter((s) => s.anexo === (R.servico > R.mercadoria + R.mercadoria_st ? anexoServ : anexoMerc)).at(-1);
  const validacao = ultimo ? { mes: ultimo.mes, dominio: ultimo.aliquota / 100, motor: (R.servico > R.mercadoria + R.mercadoria_st ? sS : sM).efetiva } : null;
  if (validacao && Math.abs(validacao.dominio - validacao.motor) > 0.005) {
    alertas.push(`Alíquota do Simples calculada (${pct(validacao.motor)}) difere da apurada no Domínio em ${validacao.mes} (${pct(validacao.dominio)}). Conferir RBT12/anexo.`);
  }
  const fatorR = rbt12 > 0 ? folhaTotal / rbt12 : 0;

  // ----- ICMS e ISS fora do Simples -----
  const uf = dados.empresa.uf;
  const icmsInt = (P.icms.aliquota_interna || {})[uf];
  let icms = 0;
  if (R.mercadoria > 0) {
    if (aj.icms_carga_efetiva != null) {
      icms = R.mercadoria * aj.icms_carga_efetiva;
      premissas.push(`ICMS com carga efetiva ajustada de ${pct(aj.icms_carga_efetiva)}.`);
    } else if (icmsInt) {
      const credito = comp('revenda_interna') * icmsInt + comp('revenda_inter') * P.icms.credito_compras_interestaduais;
      icms = Math.max(0, R.mercadoria * icmsInt - credito);
      premissas.push(`ICMS normal estimado: ${pct(icmsInt)} sobre vendas menos crédito das compras (CONFIRMAR regime especial do ${uf}).`);
    } else alertas.push(`Sem alíquota de ICMS cadastrada para ${uf} em parametros.json.`);
  }
  const issAliq = aj.iss ?? P.iss.aliquota_padrao;
  const iss = R.servico * issAliq;
  if (R.servico > 0 && aj.iss == null) premissas.push(`ISS estimado em ${pct(issAliq)} (CONFIRMAR alíquota do município).`);
  const cpp = folhaTotal * P.folha.inss_patronal + clt * (P.folha.rat + P.folha.terceiros);

  // ----- Lucro Presumido -----
  const LP = P.lucro_presumido;
  const acima5 = Math.max(0, R.total - 5000000) / (R.total || 1);
  const presIR = (R.mercadoria + R.mercadoria_st) * LP.presuncao_irpj.comercio + R.servico * LP.presuncao_irpj.servico;
  const presCS = (R.mercadoria + R.mercadoria_st) * LP.presuncao_csll.comercio + R.servico * LP.presuncao_csll.servico;
  const baseIR = presIR * (1 + acima5 * LP.acrescimo_presuncao_acima_5_milhoes);
  const baseCS = presCS * (1 + acima5 * LP.acrescimo_presuncao_acima_5_milhoes);
  const presumido = {
    irpj: irpj(baseIR, { ...LP }),
    csll: baseCS * LP.csll,
    pis_cofins: R.total * (LP.pis + LP.cofins),
    icms, iss, inss_patronal: cpp,
  };

  // ----- Lucro Real -----
  const LR = P.lucro_real;
  const dre = Object.fromEntries((dados.dre || []).map((d) => [d.grupo, d]));
  const receitaDre = soma(Object.values(dre).filter((d) => d.grupo.startsWith('41') && d.grupo !== '412'), (d) => d.saldo);
  const mesesDre = Math.max(0, ...Object.values(dre).map((d) => d.meses));
  const receitaDomPeriodo = totDomGeral;
  const creditoPC = (comprasRevenda + comp('energia')) * (LR.pis + LR.cofins);
  const pisCofinsReal = Math.max(0, R.total * (LR.pis + LR.cofins) - creditoPC);
  // Ordem de preferencia: ajuste manual > DRE completa > estimativa fiscal (comercio) > margem do formulario
  let lucroAntes = null, fonteLucro = 'indisponível';
  const tributosNovoRegime = pisCofinsReal + icms + iss + cpp; // na DRE do Simples nao existem: descontar
  const custos5 = -soma(Object.values(dre).filter((d) => d.grupo.startsWith('5')), (d) => d.saldo);
  const despesas3 = -soma(Object.values(dre).filter((d) => d.grupo.startsWith('3')), (d) => d.saldo);
  const mesesDesp = Math.max(0, ...Object.values(dre).filter((d) => d.grupo.startsWith('3')).map((d) => d.meses));
  const temMercadoria = R.mercadoria + R.mercadoria_st > 0;
  const dreCobreReceita = receitaDre > 0 && receitaDomPeriodo > 0 && receitaDre >= 0.8 * receitaDomPeriodo;
  const cmvLancado = !temMercadoria || custos5 * (12 / (mesesDre || 12)) >= 0.3 * comprasRevenda;
  if (aj.margem_lucro != null) {
    lucroAntes = R.total * aj.margem_lucro;
    fonteLucro = `margem de ${pct(aj.margem_lucro)} (ajuste manual)`;
  } else if (dreCobreReceita && cmvLancado) {
    lucroAntes = (receitaDre - custos5 - despesas3) * (12 / mesesDre) - tributosNovoRegime;
    fonteLucro = `contabilidade do Domínio (${mesesDre} meses, anualizada)`;
  } else if (temMercadoria && comprasRevenda > 0 && mesesDesp > 0) {
    lucroAntes = R.total - comprasRevenda - despesas3 * (12 / mesesDesp) - tributosNovoRegime;
    fonteLucro = 'estimativa fiscal: receita − compras de mercadoria − despesas da contabilidade';
    if (dreCobreReceita) alertas.push('Contabilidade sem CMV lançado (custo das mercadorias muito menor que as compras): lucro do Lucro Real estimado pelas compras. Informar a margem real em ajustes_empresa para maior precisão.');
  } else {
    const margem = resp && resp.margem_estimada_pct ? resp.margem_estimada_pct / 100 : null;
    if (margem != null) {
      lucroAntes = R.total * margem;
      fonteLucro = `margem de ${pct(margem)} informada no formulário`;
    } else {
      alertas.push('Lucro Real não calculado: contabilidade incompleta no Domínio e sem margem informada no formulário.');
    }
  }
  if (lucroAntes != null && R.total > 0 && lucroAntes / R.total > 0.5) {
    alertas.push(`Margem de lucro de ${pct(lucroAntes / R.total)} parece alta: conferir antes de considerar o Lucro Real.`);
  }
  const real = lucroAntes == null ? null : {
    irpj: irpj(lucroAntes, LR),
    csll: Math.max(0, lucroAntes) * LR.csll,
    pis_cofins: pisCofinsReal,
    icms, iss, inss_patronal: cpp,
  };

  // ----- 2027: Simples puro x hibrido -----
  const RF = P.reforma_2027;
  const reducao = aj.reducao_iva || 0;
  const iva = (RF.cbs + RF.ibs) * (1 - reducao);
  const pctPJ = resp ? (P.formulario.vendas_para_pj[resp.publico] ?? 0.5) : 0.5;
  const pctFornNormal = resp ? (P.formulario.compras_de_fornecedor_regime_normal[resp.fornecedores] ?? 0.5) : 0.5;
  const clientesAproveitam = !resp || !/Simples|Não vendo/.test(resp.regime_clientes || '');
  const pisCofinsDAS = R.mercadoria * sM.pisCofins + R.mercadoria_st * sMst.pisCofins + R.servico * sS.pisCofins;
  const ivaDevido = Math.max(0, R.total * iva - comprasTotal * pctFornNormal * iva);
  const hibrido = { das: das - pisCofinsDAS, cbs_ibs: ivaDevido };
  const creditoClientePuro = R.total * pctPJ * (pisCofinsDAS / (R.total || 1));
  const creditoClienteHibrido = R.total * pctPJ * iva;
  if (!resp) premissas.push('Sem respostas do formulário: considerado 50% das vendas para empresas e 50% das compras de fornecedores do regime normal.');
  if (reducao) premissas.push(`Redução setorial de ${pct(reducao)} no IBS/CBS.`);

  // ----- Alertas gerais -----
  if (rbt12 > 4800000) alertas.push('Receita acima de R$ 4,8 milhões: excluída do Simples.');
  else if (rbt12 > 3600000) alertas.push('Receita acima de R$ 3,6 milhões: ICMS/ISS fora do DAS (sublimite).');
  const previsto = resp && resp.faturamento_previsto;
  if (previsto >= 4800000 * 0.9) alertas.push(`Faturamento previsto pelo cliente (${brl(previsto)}) perto ou acima de R$ 4,8 milhões: risco de exclusão do Simples.`);
  else if (previsto >= 3600000 * 0.9) alertas.push(`Faturamento previsto pelo cliente (${brl(previsto)}) perto ou acima do sublimite de R$ 3,6 milhões: acima dele o ICMS/ISS sai do DAS e o Simples fica mais caro.`);
  if (resp && /mais de 10%|administrador/.test(resp.socio_outra_empresa || '')) {
    alertas.push('Sócio com participação relevante em outra empresa: somar as receitas para o limite do Simples (LC 123, art. 3º, §4º).');
  }
  // Lei 15.270/2025: IRRF de 10% sobre lucros acima de R$ 50 mil/mes pagos ao mesmo socio
  const lucroMes = {};
  for (const f of dados.folha) if (f.tipo === 70) lucroMes[`${f.pessoa}|${f.mes}`] = (lucroMes[`${f.pessoa}|${f.mes}`] || 0) + f.proventos;
  const maiorLucroMes = Math.max(0, ...Object.values(lucroMes));
  if (maiorLucroMes > 50000) alertas.push(`Distribuição de lucros acima de R$ 50 mil/mês para um sócio (maior: ${brl(maiorLucroMes)}): sujeita a IRRF de 10% (Lei 15.270/2025).`);
  else if (maiorLucroMes > 40000) alertas.push(`Distribuição de lucros perto do limite de R$ 50 mil/mês por sócio (maior: ${brl(maiorLucroMes)}).`);
  if (lucrosDistribuidos > 0) premissas.push(`Distribuição de lucros (~${brl(lucrosDistribuidos)}/ano) não entra na folha nem no Fator R.`);

  const totalizar = (o) => (o ? { ...o, total: soma(Object.values(o)) } : null);
  const regimes = [
    { regime: 'Simples Nacional (atual)', ...totalizar({ das, inss_patronal: cppForaDAS }) },
    { regime: 'Lucro Presumido', ...totalizar(presumido) },
    real ? { regime: 'Lucro Real', ...totalizar(real) } : { regime: 'Lucro Real', total: null },
  ];
  // O Lucro Real só entra na recomendação com lucro confiável e positivo. A estimativa
  // "receita − compras" erra muito quando a empresa forma estoque ou compra insumos
  // (o radar mostrou prejuízos falsos de até -94%), e prejuízo precisa de balancete.
  const lucroEstimadoPelasCompras = /^estimativa fiscal/.test(fonteLucro);
  const realNaRecomendacao = real && !lucroEstimadoPelasCompras && lucroAntes > 0;
  if (real && lucroEstimadoPelasCompras) {
    alertas.push('Lucro Real fora da recomendação: o lucro foi estimado pelas compras (estoque e insumos distorcem). Confirmar com o balancete ou informar a margem real.');
  } else if (real && !(lucroAntes > 0)) {
    alertas.push('Lucro Real fora da recomendação: o período mostra prejuízo. Confirmar com o balancete antes de considerar o Lucro Real.');
  }
  if (real) regimes[2].na_recomendacao = Boolean(realNaRecomendacao);
  if (R.total === 0) alertas.push('Sem receita de vendas ou serviços nos 12 meses (só remessas/outras operações): nada a comparar.');
  const validos = regimes.filter((x) => x.total != null && x.na_recomendacao !== false).sort((a, b) => a.total - b.total);
  const melhor = validos[0];

  const resultado = {
    cnpj, empresa: dados.empresa.nome, uf, periodo: dados.periodo, gerado_em: new Date().toISOString(),
    base_anual: {
      receita: R, rbt12, compras: C, pro_labore: proLabore, salarios_clt: clt, folha_total: folhaTotal, fator_r: fatorR,
      lucro_antes_ir_real: lucroAntes, fonte_lucro: fonteLucro,
    },
    simples: {
      anexo_mercadoria: R.mercadoria + R.mercadoria_st > 0 ? anexoMerc : null,
      anexo_servico: R.servico > 0 ? anexoServ : null,
      faixa: (R.servico > R.mercadoria ? sS : sM).faixa,
      aliquota_efetiva: das / (R.total || 1),
      validacao_dominio: validacao,
    },
    regimes_2026: regimes.map((x) => ({ ...x, carga_sobre_receita: x.total != null ? x.total / (R.total || 1) : null })),
    melhor_2026: melhor ? { regime: melhor.regime, economia_vs_atual: regimes[0].total - melhor.total } : null,
    reforma_2027: {
      simples_puro: { total: das + cppForaDAS },
      simples_hibrido: { ...hibrido, total: hibrido.das + hibrido.cbs_ibs + cppForaDAS },
      custo_extra_hibrido: hibrido.das + hibrido.cbs_ibs - das,
      credito_para_clientes: { puro: creditoClientePuro, hibrido: creditoClienteHibrido, pct_vendas_pj: pctPJ, clientes_aproveitam: clientesAproveitam },
    },
    respostas_formulario: resp ? true : false,
    premissas, alertas,
  };
  return resultado;
}

const brl = (v) => (v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }));
const pct = (v) => (v == null ? '—' : (v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + '%');

module.exports = { calcular, simplesEfetiva };
