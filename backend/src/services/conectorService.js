// @ts-check
/**
 * Conector do Claude (MCP): as "ferramentas" que o Claude pode usar para
 * CONSULTAR o sistema em nome de uma pessoa da equipe. Tudo é só leitura e
 * respeita as permissões da pessoa dona da chave (ideia do LifeOS do Kzrtt).
 *
 * Nada aqui chama SERPRO, Domínio, e-mail ou WhatsApp: só lê o banco do sistema.
 */

const { query } = require('../config/db');
const permissoes = require('./permissoesService');
const ajuda = require('./ajudaService');
const { SETORES, setoresVisiveis, ehColaboradorDoSetor } = require('../config/setores');

const dia = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const soDigitos = (s) => String(s || '').replace(/\D/g, '');
const limitar = (n, min, max, padrao) => Math.min(Math.max(Number.isFinite(Number(n)) ? Math.trunc(Number(n)) : padrao, min), max);

class ErroFerramenta extends Error {}

/** Acha a empresa por id, CNPJ ou parte do nome. Mais de uma = devolve a lista para escolher. */
async function acharEmpresa(texto) {
  const t = String(texto || '').trim();
  if (!t) throw new ErroFerramenta('Diga qual empresa (nome, parte do nome ou CNPJ).');
  if (/^[0-9a-f-]{36}$/i.test(t)) {
    const { rows } = await query('SELECT id, razao_social, cnpj FROM empresas WHERE id = $1', [t]);
    return rows;
  }
  const cnpj = soDigitos(t);
  if (cnpj.length >= 8) {
    const { rows } = await query(`SELECT id, razao_social, cnpj FROM empresas WHERE regexp_replace(cnpj, '\\D', '', 'g') LIKE $1 ORDER BY razao_social LIMIT 10`, [`${cnpj}%`]);
    if (rows.length) return rows;
  }
  const { rows } = await query(
    `SELECT id, razao_social, cnpj FROM empresas WHERE razao_social ILIKE $1 OR nome_fantasia ILIKE $1 ORDER BY razao_social LIMIT 10`,
    [`%${t.replace(/[%_]/g, '')}%`]
  );
  return rows;
}

async function umaEmpresa(texto) {
  const achadas = await acharEmpresa(texto);
  if (!achadas.length) throw new ErroFerramenta(`Nenhuma empresa encontrada com "${texto}".`);
  if (achadas.length > 1) {
    return { escolher: true, mensagem: `Encontrei ${achadas.length} empresas. Pergunte qual delas e chame de novo com o CNPJ.`, empresas: achadas.map((e) => ({ razao_social: e.razao_social, cnpj: e.cnpj })) };
  }
  return { empresa: achadas[0] };
}

/** Setores que a pessoa vê e, para colaborador, o filtro "só as próprias". */
function filtroSetores(usuario, setorPedido) {
  let setores = setoresVisiveis(usuario.role);
  if (setorPedido) {
    if (!setores.includes(setorPedido)) throw new ErroFerramenta(`Você não tem acesso às tarefas do setor "${setorPedido}".`);
    setores = [setorPedido];
  }
  return setores.map((s) => ({ setor: s, soDoEmail: ehColaboradorDoSetor(usuario.role, s) ? usuario.email : null }));
}

async function tarefasVisiveis(usuario, { setor = null, soPedidosCliente = false, soAtrasadas = false, empresaId = null, limite = 50 } = {}) {
  const grupos = filtroSetores(usuario, setor);
  if (!grupos.length) return [];
  const cond = []; const params = [];
  const ou = grupos.map((g) => {
    params.push(g.setor);
    let c = `t.setor = $${params.length}`;
    if (g.soDoEmail) { params.push(g.soDoEmail.toLowerCase()); c += ` AND lower(t.responsavel_email) = $${params.length}`; }
    return `(${c})`;
  });
  cond.push(`(${ou.join(' OR ')})`);
  cond.push(`t.status <> 'concluido'`);
  if (soPedidosCliente) cond.push('t.solicitado_por_cliente');
  if (soAtrasadas) cond.push('t.prazo < NOW()');
  if (empresaId) { params.push(empresaId); cond.push(`t.empresa_id = $${params.length}`); }
  params.push(limite);
  const { rows } = await query(
    `SELECT t.setor, t.descricao, t.status, t.prazo, t.responsavel_nome, t.solicitado_por_cliente, t.tipo_solicitacao, t.competencia, t.criado_em, e.razao_social AS empresa
     FROM tarefas_setor t LEFT JOIN empresas e ON e.id = t.empresa_id
     WHERE ${cond.join(' AND ')}
     ORDER BY t.prazo ASC NULLS LAST, t.criado_em ASC LIMIT $${params.length}`,
    params
  );
  return rows.map((t) => ({
    setor: SETORES[t.setor] ? SETORES[t.setor].rotulo : t.setor, empresa: t.empresa, descricao: t.descricao, situacao: t.status,
    prazo: dia(t.prazo), atrasada: Boolean(t.prazo && new Date(t.prazo) < new Date()), responsavel: t.responsavel_nome,
    pedido_do_cliente: t.solicitado_por_cliente || undefined, tipo_pedido: t.tipo_solicitacao || undefined, competencia: t.competencia || undefined, criada_em: dia(t.criado_em)
  }));
}

async function vencimentosAte(dias, tipo, incluirVencidos, empresaId) {
  const partes = [];
  const fontes = {
    certidoes: ['certidoes', 'Certidão'],
    licencas: ['licencas', 'Licença/alvará'],
    certificados: ['certificados_digitais', 'Certificado digital']
  };
  for (const [chave, [tabela, rotulo]] of Object.entries(fontes)) {
    if (tipo !== 'todos' && tipo !== chave) continue;
    const params = [dias];
    let extra = '';
    if (empresaId) { params.push(empresaId); extra = ` AND x.empresa_id = $${params.length}`; }
    const { rows } = await query(
      `SELECT x.tipo, x.status, x.data_validade, e.razao_social AS empresa, e.cnpj
       FROM ${tabela} x JOIN empresas e ON e.id = x.empresa_id
       WHERE x.data_validade IS NOT NULL AND x.data_validade <= CURRENT_DATE + $1::int
         ${incluirVencidos ? '' : 'AND x.data_validade >= CURRENT_DATE'}
         AND e.situacao NOT IN ('baixada', 'saiu_escritorio')${extra}
       ORDER BY x.data_validade LIMIT 200`,
      params
    );
    for (const r of rows) partes.push({ o_que: rotulo, tipo: r.tipo, empresa: r.empresa, cnpj: r.cnpj, validade: dia(r.data_validade), vencida: new Date(r.data_validade) < new Date(new Date().toDateString()) });
  }
  return partes.sort((a, b) => String(a.validade).localeCompare(String(b.validade)));
}

// ---------------------------------------------------------------------------
// Ferramentas
// ---------------------------------------------------------------------------

const FERRAMENTAS = [
  {
    nome: 'resumo_do_escritorio',
    descricao: 'Visão geral do escritório agora: empresas por situação, certidões/licenças/certificados vencidos e vencendo em 30 dias, processos de legalização abertos, tarefas atrasadas e pedidos de clientes em aberto (dos setores que a pessoa vê). Bom ponto de partida para "como estamos?" ou "o que está pendente?".',
    entrada: { type: 'object', properties: {}, additionalProperties: false },
    async rodar(_args, usuario) {
      const { rows: empresas } = await query(`SELECT situacao, COUNT(*)::int AS n FROM empresas GROUP BY situacao ORDER BY n DESC`);
      const venc = await vencimentosAte(30, 'todos', true, null);
      const { rows: processos } = await query(`SELECT status, COUNT(*)::int AS n FROM processos_legalizacao WHERE status <> 'concluido' GROUP BY status`);
      const tarefas = await tarefasVisiveis(usuario, { limite: 500 });
      return {
        empresas_por_situacao: Object.fromEntries(empresas.map((r) => [r.situacao, r.n])),
        vencidos: venc.filter((v) => v.vencida).length,
        vencendo_em_30_dias: venc.filter((v) => !v.vencida).length,
        processos_abertos_por_situacao: Object.fromEntries(processos.map((r) => [r.status, r.n])),
        tarefas_abertas: tarefas.length,
        tarefas_atrasadas: tarefas.filter((t) => t.atrasada).length,
        pedidos_de_clientes_abertos: tarefas.filter((t) => t.pedido_do_cliente).length,
        dica: 'Use "vencimentos", "tarefas_dos_setores" ou "processos_de_legalizacao" para ver a lista.'
      };
    }
  },
  {
    nome: 'buscar_empresas',
    descricao: 'Procura empresas pelo nome (ou parte) ou CNPJ. Devolve razão social, CNPJ, situação, regime e cidade.',
    entrada: { type: 'object', properties: { texto: { type: 'string', description: 'Nome, parte do nome ou CNPJ' }, situacao: { type: 'string', enum: ['ativa', 'suspensa', 'baixada', 'em_legalizacao', 'saiu_escritorio'] } }, required: ['texto'], additionalProperties: false },
    async rodar({ texto, situacao }) {
      const t = String(texto || '').trim();
      const params = [`%${t.replace(/[%_]/g, '')}%`, `${soDigitos(t) || '-'}%`];
      let extra = '';
      if (situacao) { params.push(situacao); extra = ` AND situacao = $${params.length}`; }
      const { rows } = await query(
        `SELECT razao_social, nome_fantasia, cnpj, situacao, regime_tributario, cidade, uf FROM empresas
         WHERE (razao_social ILIKE $1 OR nome_fantasia ILIKE $1 OR regexp_replace(cnpj, '\\D', '', 'g') LIKE $2)${extra}
         ORDER BY razao_social LIMIT 25`, params
      );
      return { encontradas: rows.length, empresas: rows };
    }
  },
  {
    nome: 'ficha_da_empresa',
    descricao: 'Tudo de uma empresa: dados cadastrais, certidões, licenças, certificados digitais, processos de legalização, tarefas abertas dos setores que a pessoa vê, última situação fiscal guardada e a Caixa Postal (se a pessoa tiver acesso).',
    entrada: { type: 'object', properties: { empresa: { type: 'string', description: 'Nome, parte do nome ou CNPJ' } }, required: ['empresa'], additionalProperties: false },
    async rodar({ empresa }, usuario) {
      const achou = await umaEmpresa(empresa);
      if (!achou.empresa) return achou;
      const id = achou.empresa.id;
      const { rows: [e] } = await query(
        `SELECT razao_social, nome_fantasia, cnpj, inscricao_estadual, inscricao_municipal, regime_tributario, situacao, data_abertura, cidade, uf, email, telefone, competencia_inicio
         FROM empresas WHERE id = $1`, [id]
      );
      const lista = async (sql) => (await query(sql, [id])).rows;
      const ficha = {
        empresa: { ...e, data_abertura: dia(e.data_abertura) },
        certidoes: (await lista('SELECT tipo, status, data_validade FROM certidoes WHERE empresa_id = $1 ORDER BY data_validade NULLS LAST')).map((x) => ({ ...x, data_validade: dia(x.data_validade) })),
        licencas: (await lista('SELECT tipo, status, data_validade FROM licencas WHERE empresa_id = $1 ORDER BY data_validade NULLS LAST')).map((x) => ({ ...x, data_validade: dia(x.data_validade) })),
        certificados_digitais: (await lista('SELECT tipo, status, data_validade FROM certificados_digitais WHERE empresa_id = $1 ORDER BY data_validade NULLS LAST')).map((x) => ({ ...x, data_validade: dia(x.data_validade) })),
        processos_de_legalizacao: (await lista(`SELECT tipo, descricao, status, orgao, protocolo, data_prevista_conclusao FROM processos_legalizacao WHERE empresa_id = $1 ORDER BY criado_em DESC LIMIT 10`)).map((x) => ({ ...x, data_prevista_conclusao: dia(x.data_prevista_conclusao) })),
        tarefas_abertas: await tarefasVisiveis(usuario, { empresaId: id, limite: 30 })
      };
      const { rows: [sf] } = await query('SELECT situacao, resumo, criado_em FROM situacao_fiscal WHERE empresa_id = $1 ORDER BY criado_em DESC LIMIT 1', [id]);
      if (sf) ficha.ultima_situacao_fiscal = { situacao: sf.situacao, resumo: sf.resumo, consultada_em: dia(sf.criado_em) };
      if (await permissoes.pode(usuario.role, 'caixa_postal.usar')) {
        const { rows: [cp] } = await query('SELECT indicador, nao_lidas, verificado_em FROM caixa_postal WHERE empresa_id = $1', [id]);
        if (cp) ficha.caixa_postal = { mensagens_novas: cp.nao_lidas, verificada_em: dia(cp.verificado_em) };
      }
      return ficha;
    }
  },
  {
    nome: 'vencimentos',
    descricao: 'Certidões, licenças/alvarás e certificados digitais vencidos ou que vencem nos próximos N dias (empresas ativas), em ordem de data.',
    entrada: {
      type: 'object',
      properties: {
        dias: { type: 'integer', minimum: 1, maximum: 365, description: 'Quantos dias para frente (padrão 30)' },
        tipo: { type: 'string', enum: ['todos', 'certidoes', 'licencas', 'certificados'] },
        incluir_vencidos: { type: 'boolean', description: 'Incluir os que já venceram (padrão sim)' },
        empresa: { type: 'string', description: 'Opcional: só de uma empresa (nome ou CNPJ)' }
      },
      additionalProperties: false
    },
    async rodar({ dias, tipo = 'todos', incluir_vencidos: incluirVencidos = true, empresa }) {
      let empresaId = null;
      if (empresa) { const a = await umaEmpresa(empresa); if (!a.empresa) return a; empresaId = a.empresa.id; }
      const lista = await vencimentosAte(limitar(dias, 1, 365, 30), tipo, incluirVencidos !== false, empresaId);
      return { total: lista.length, itens: lista };
    }
  },
  {
    nome: 'processos_de_legalizacao',
    descricao: 'Processos de abertura, alteração e baixa: os abertos (padrão), só os em exigência, ou todos. Opcional: de uma empresa.',
    entrada: { type: 'object', properties: { situacao: { type: 'string', enum: ['abertos', 'exigencia', 'todos'] }, empresa: { type: 'string' } }, additionalProperties: false },
    async rodar({ situacao = 'abertos', empresa }) {
      const params = []; const cond = [];
      if (situacao === 'abertos') cond.push(`p.status <> 'concluido'`);
      if (situacao === 'exigencia') cond.push(`p.status = 'exigencia'`);
      if (empresa) { const a = await umaEmpresa(empresa); if (!a.empresa) return a; params.push(a.empresa.id); cond.push(`p.empresa_id = $${params.length}`); }
      const { rows } = await query(
        `SELECT e.razao_social AS empresa, p.tipo, p.descricao, p.status, p.orgao, p.protocolo, p.data_prevista_conclusao, u.nome AS responsavel
         FROM processos_legalizacao p JOIN empresas e ON e.id = p.empresa_id LEFT JOIN usuarios u ON u.id = p.responsavel_id
         ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
         ORDER BY CASE p.status WHEN 'exigencia' THEN 0 WHEN 'em_andamento' THEN 1 ELSE 2 END, p.data_prevista_conclusao NULLS LAST LIMIT 100`, params
      );
      return { total: rows.length, processos: rows.map((p) => ({ ...p, data_prevista_conclusao: dia(p.data_prevista_conclusao), atrasado: Boolean(p.data_prevista_conclusao && p.status !== 'concluido' && new Date(p.data_prevista_conclusao) < new Date()) })) };
    }
  },
  {
    nome: 'tarefas_dos_setores',
    descricao: 'Tarefas abertas dos setores (Fiscal, Contabilidade, Folha, Legalização) que a pessoa pode ver — colaborador vê só as próprias. Pode filtrar por setor, só atrasadas ou só pedidos de clientes.',
    entrada: {
      type: 'object',
      properties: {
        setor: { type: 'string', enum: Object.keys(SETORES) },
        so_atrasadas: { type: 'boolean' },
        so_pedidos_de_clientes: { type: 'boolean' }
      },
      additionalProperties: false
    },
    async rodar({ setor, so_atrasadas: soAtrasadas, so_pedidos_de_clientes: soPedidos }, usuario) {
      const lista = await tarefasVisiveis(usuario, { setor: setor || null, soAtrasadas: Boolean(soAtrasadas), soPedidosCliente: Boolean(soPedidos), limite: 100 });
      return { total: lista.length, setores_que_voce_ve: setoresVisiveis(usuario.role).map((s) => SETORES[s].rotulo), tarefas: lista };
    }
  },
  {
    nome: 'caixa_postal',
    descricao: 'Empresas com mensagens novas na Caixa Postal do e-CAC, pela ÚLTIMA verificação feita no sistema (não consulta a Receita agora e não abre mensagem nenhuma — abrir conta como ciência). Mostra o assunto e a data das mensagens.',
    permissao: 'caixa_postal.usar',
    entrada: { type: 'object', properties: { empresa: { type: 'string', description: 'Opcional: só de uma empresa' } }, additionalProperties: false },
    async rodar({ empresa }) {
      const params = []; let extra = '';
      if (empresa) { const a = await umaEmpresa(empresa); if (!a.empresa) return a; params.push(a.empresa.id); extra = ` AND cp.empresa_id = $${params.length}`; }
      const { rows } = await query(
        `SELECT e.razao_social AS empresa, e.cnpj, cp.nao_lidas, cp.mensagens, cp.erro, cp.verificado_em
         FROM caixa_postal cp JOIN empresas e ON e.id = cp.empresa_id
         WHERE (cp.nao_lidas > 0 OR cp.erro IS NOT NULL OR $${params.length + 1}::boolean)${extra}
         ORDER BY cp.nao_lidas DESC NULLS LAST, e.razao_social LIMIT 100`, [...params, Boolean(empresa)]
      );
      return {
        aviso: 'Situação da última verificação. Para atualizar, use a tela Caixa Postal da Receita (cada verificação é cobrada pelo SERPRO).',
        empresas: rows.map((r) => ({
          empresa: r.empresa, cnpj: r.cnpj, mensagens_novas: r.nao_lidas, erro: r.erro || undefined, verificada_em: dia(r.verificado_em),
          mensagens: (Array.isArray(r.mensagens) ? r.mensagens : []).slice(0, 10).map((m) => ({ assunto: m.assunto, enviada_em: m.enviada_em, ciencia_automatica_em: m.ciencia_em, relevante: m.relevante || undefined }))
        }))
      };
    }
  },
  {
    nome: 'pesquisar_manual',
    descricao: 'Procura no manual do sistema e nas respostas ensinadas pelo administrador como fazer algo no SISTEMA PRIVILEGE (telas, botões, passo a passo). Use antes de explicar "como faço" — nunca invente tela ou botão.',
    entrada: { type: 'object', properties: { pergunta: { type: 'string' } }, required: ['pergunta'], additionalProperties: false },
    async rodar({ pergunta }) {
      const { rows: memoria } = await query(`SELECT id, pergunta, resposta, secoes FROM ajuda_memoria WHERE publico = 'equipe'`);
      const ensinada = ajuda.acharNaMemoria(pergunta, memoria);
      const secoes = ajuda.buscar('equipe', pergunta, 2);
      return {
        resposta_ensinada: ensinada ? ensinada.resposta : undefined,
        manual: secoes.map((s, i) => ({ assunto: s.titulo, link: `/pages/ajuda.html#${s.id}`, texto: i === 0 ? s.markdown.replace(/^!\[[^\]]*\]\([^)]+\)\s*$/gm, '').slice(0, 6000) : (s.resumo || undefined) }))
      };
    }
  }
];

/** Ferramentas que a pessoa pode usar (as com "permissao" somem para quem não tem). */
async function ferramentasDe(usuario) {
  const lista = [];
  for (const f of FERRAMENTAS) if (!f.permissao || await permissoes.pode(usuario.role, f.permissao)) lista.push(f);
  return lista;
}

async function instrucoes(usuario) {
  const base = `Este é o SISTEMA PRIVILEGE, o sistema interno da Privilege Contabilidade e Consultoria (escritório de contabilidade em Francisco Beltrão/PR). Você está conectado em nome de ${usuario.nome}, com as permissões dela no sistema.

Como usar:
- As ferramentas só CONSULTAM. Para mudar algo (cadastrar, enviar guia, mexer no Domínio), diga em qual tela do sistema a pessoa faz isso — use "pesquisar_manual" para achar o passo a passo certo, e nunca invente tela ou botão.
- Comece por "resumo_do_escritorio" quando a pergunta for geral; use "ficha_da_empresa" para uma empresa.
- Responda em português do Brasil, simples (a equipe não é técnica). Datas no formato dd/mm/aaaa e valores em R$.
- Os dados são de clientes do escritório: são confidenciais. Use só para responder a pessoa.
- A Caixa Postal mostra a última verificação; o sistema nunca abre mensagens (abrir conta como ciência na Receita).`;
  try {
    const { rows } = await query(`SELECT split_part(pergunta, E'\\n', 1) AS p FROM ajuda_memoria WHERE publico = 'equipe' ORDER BY usos DESC, criado_em LIMIT 40`);
    if (!rows.length) return base;
    let indice = rows.map((r) => `- ${r.p}`).join('\n');
    if (indice.length > 3000) indice = `${indice.slice(0, 3000)}\n(… mais — use pesquisar_manual)`;
    return `${base}\n\nPerguntas que o administrador já respondeu (memória do assistente — use pesquisar_manual para ver a resposta):\n${indice}`;
  } catch (e) {
    return base;
  }
}

module.exports = { FERRAMENTAS, ferramentasDe, instrucoes, ErroFerramenta, acharEmpresa };
