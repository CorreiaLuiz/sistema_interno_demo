// Teste de ponta a ponta: liga o sistema de verdade num banco TEMPORÁRIO (dados fictícios)
// e confere login, permissões, Área do Cliente (um cliente nunca vê outro), importação de
// guias e links públicos. E-mail, WhatsApp, SERPRO, Domínio e IA ficam desligados.
//
// Rodar: npm run test:integracao   (precisa do PostgreSQL ligado; usa o usuário do .env)
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const BACKEND = path.join(__dirname, '..', '..');
const RAIZ = path.join(BACKEND, '..');
require('dotenv').config({ path: path.join(BACKEND, '.env') });
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { pdfDas } = require('../ajudantes');

const BANCO = 'sistema_ana_teste_integracao';
const PORTA = 3300;
const API = `http://localhost:${PORTA}/api`;
const BASE = `http://localhost:${PORTA}`;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const conexao = (database) => new Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database });

let db; let srv; let temporaria;
const u = {}; const ids = {}; const doc = {};
let tCliente; let tOutroCliente;

/** Chamada à API. Devolve { status, dados }. */
async function api(metodo, url, { corpo, token } = {}) {
  const form = corpo instanceof FormData;
  const r = await fetch(API + url, {
    method: metodo,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(corpo && !form ? { 'Content-Type': 'application/json' } : {}) },
    body: corpo ? (form ? corpo : JSON.stringify(corpo)) : undefined
  });
  const texto = await r.text();
  let dados = texto; try { dados = JSON.parse(texto); } catch (e) { /* não é JSON */ }
  return { status: r.status, dados };
}
const ok = async (metodo, url, opcoes) => {
  const r = await api(metodo, url, opcoes);
  assert.ok(r.status < 300, `${metodo} ${url} → ${r.status} ${JSON.stringify(r.dados).slice(0, 200)}`);
  return r.dados;
};
const pdf = (linhas) => {
  const conteudo = 'BT /F1 12 Tf 50 790 Td 18 TL ' + linhas.map((l) => `(${l}) Tj T*`).join(' ') + ' ET';
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let s = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(s.length); s += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = s.length;
  s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return Buffer.from(s, 'latin1');
};
function formArquivo(campos, nome, conteudo, tipo = 'application/pdf') {
  const f = new FormData();
  f.append('arquivo', new Blob([conteudo], { type: tipo }), nome);
  for (const [k, v] of Object.entries(campos)) f.append(k, v);
  return f;
}

// ------------------------------------------------------------------ preparo
test.before(async () => {
  temporaria = fs.mkdtempSync(path.join(os.tmpdir(), 'ana-integracao-'));
  const pg = conexao('postgres');
  await pg.query(`DROP DATABASE IF EXISTS ${BANCO} WITH (FORCE)`);
  await pg.query(`CREATE DATABASE ${BANCO}`);
  await pg.end();
  db = conexao(BANCO);
  const sql = (arq) => fs.readFileSync(arq, 'utf8').replace(/^﻿/, '');
  await db.query(sql(path.join(RAIZ, 'database', 'schema.sql')));
  const pasta = path.join(RAIZ, 'database', 'migrations');
  // schema.sql já inclui até a 008; instalação nova roda da 009 em diante
  for (const m of fs.readdirSync(pasta).filter((f) => /^\d{3}_.*\.sql$/.test(f) && Number(f.slice(0, 3)) >= 9).sort()) await db.query(sql(path.join(pasta, m)));

  const bloqueado = 'http://127.0.0.1:9/bloqueado';
  srv = spawn(process.execPath, [path.join(BACKEND, 'src', 'server.js')], {
    cwd: BACKEND, stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, PORT: String(PORTA), APP_URL: BASE, NODE_ENV: 'production', DB_NAME: BANCO, UPLOAD_DIR: path.join(temporaria, 'uploads'),
      NOTIF_EMAIL_HOST: '', NOTIF_EMAIL_VIA: '', NOTIF_WHATSAPP_API_URL: '', AZURE_TENANT_ID: '', AZURE_CLIENT_ID: '', AZURE_CLIENT_SECRET: '',
      DOMINIO_DSN: '', DOMINIO_USUARIO: '', DOMINIO_SENHA: '', CB_PASTA_EMPRESAS: temporaria, CB_PLANILHA: path.join(temporaria, 'nao-existe.xlsx'),
      SERPRO_CND_CONSUMER_KEY: '', SERPRO_CND_CONSUMER_SECRET: '', SERPRO_INTEGRA_CONSUMER_KEY: '', SERPRO_INTEGRA_CONSUMER_SECRET: '',
      SERPRO_INTEGRA_AUTH_URL: bloqueado, SERPRO_INTEGRA_URL: bloqueado, SERPRO_TOKEN_URL: bloqueado, SERPRO_CND_URL: bloqueado,
      ANTHROPIC_API_KEY: '', BACKUP_PASTA_COPIA: '', EMAIL_AVISOS_GERAIS: '',
      ONBOARDING_EMAIL_TESTE: '', ONBOARDING_LEGALIZACAO_EMAIL: '', ONBOARDING_CADASTRO_EMAIL: '', ONBOARDING_FISCAL_EMAIL: '', ONBOARDING_CONTABIL_EMAIL: '', ONBOARDING_FOLHA_EMAIL: '' }
  });
  let erroSrv = ''; srv.stderr.on('data', (d) => { erroSrv += d; });
  for (let i = 0; ; i++) {
    await esperar(400);
    try { if ((await fetch(`${API}/health`)).ok) break; } catch (e) { /* subindo */ }
    if (i > 60) throw new Error(`o sistema não subiu: ${erroSrv.slice(0, 400)}`);
  }

  // Pessoas da equipe (fictícias), com token direto
  const hash = await bcrypt.hash('Senha-Certa-123', 6);
  for (const papel of ['administrador', 'analista_legalizacao', 'supervisor_fiscal', 'colaborador_fiscal', 'supervisor_folha_pagamento', 'colaborador_contabilidade']) {
    const email = `${papel}@exemplo.com.br`;
    const { rows: [l] } = await db.query(`INSERT INTO usuarios (nome, email, senha_hash, role_id) SELECT $1,$2,$3,id FROM roles WHERE nome=$4 RETURNING id`, [`Teste ${papel}`, email, hash, papel]);
    u[papel] = { id: l.id, email, token: jwt.sign({ id: l.id, nome: `Teste ${papel}`, email, role: papel }, process.env.JWT_SECRET, { expiresIn: '1h' }) };
  }
  const adm = u.administrador.token;
  for (const [chave, razao, cnpj] of [['alfa', 'Alfa Teste Ltda', '70.783.653/0001-70'], ['beta', 'Beta Teste Ltda', '36.112.408/0001-55']]) {
    ids[chave] = (await ok('POST', '/empresas', { token: adm, corpo: { razao_social: razao, cnpj, regime_tributario: 'simples_nacional', situacao: 'ativa', cidade: 'Francisco Beltrão', uf: 'PR', email: `${chave}@exemplo.com.br` } })).id;
  }
  doc.alfaVisivel = (await ok('POST', '/documentos', { token: adm, corpo: formArquivo({ empresa_id: ids.alfa, categoria: 'contrato_social', visivel_cliente: 'true' }, 'Contrato Alfa.pdf', pdf(['CONTRATO ALFA'])) })).id;
  doc.alfaInterno = (await ok('POST', '/documentos', { token: adm, corpo: formArquivo({ empresa_id: ids.alfa, categoria: 'comprovante', visivel_cliente: 'false' }, 'Interno Alfa.pdf', pdf(['INTERNO'])) })).id;
  doc.beta = (await ok('POST', '/documentos', { token: adm, corpo: formArquivo({ empresa_id: ids.beta, categoria: 'contrato_social', visivel_cliente: 'true' }, 'Contrato Beta.pdf', pdf(['CONTRATO BETA'])) })).id;

  // Dois clientes: um da Alfa, outro da Beta
  await ok('POST', `/empresas/${ids.alfa}/acessos-cliente`, { token: adm, corpo: { nome: 'Cliente Alfa', email: 'cliente.alfa@exemplo.com.br', telefone: '' } });
  await ok('POST', `/empresas/${ids.beta}/acessos-cliente`, { token: adm, corpo: { nome: 'Cliente Beta', email: 'cliente.beta@exemplo.com.br', telefone: '' } });
  const senhaCli = crypto.randomBytes(10).toString('hex');
  await db.query('UPDATE clientes_portal SET senha_hash = $1', [await bcrypt.hash(senhaCli, 6)]);
  tCliente = (await ok('POST', '/cliente/login', { corpo: { email: 'cliente.alfa@exemplo.com.br', senha: senhaCli } })).token;
  tOutroCliente = (await ok('POST', '/cliente/login', { corpo: { email: 'cliente.beta@exemplo.com.br', senha: senhaCli } })).token;
});

test.after(async () => {
  if (srv) srv.kill();
  await esperar(800);
  if (db) await db.end().catch(() => {});
  const adm = conexao('postgres');
  await adm.query(`DROP DATABASE IF EXISTS ${BANCO} WITH (FORCE)`).catch(() => {});
  await adm.end();
  if (temporaria) fs.rmSync(temporaria, { recursive: true, force: true });
});

// ------------------------------------------------------------------ login da equipe
test('login da equipe: senha errada não entra; sem login nada abre', async () => {
  assert.equal((await api('POST', '/auth/login', { corpo: { email: u.administrador.email, senha: 'errada' } })).status, 401);
  const certo = await api('POST', '/auth/login', { corpo: { email: u.administrador.email, senha: 'Senha-Certa-123' } });
  assert.equal(certo.status, 200);
  assert.ok(certo.dados.token);
  for (const url of ['/empresas', '/documentos', '/guias/receita', '/caixa-postal', '/planejamento/analises', '/emails-enviados', '/auditoria', '/conferencia-bancaria/painel', '/ajuda/equipe/manual', '/tarefas-setor/fiscal']) {
    assert.equal((await api('GET', url)).status, 401, `${url} abriu sem login`);
  }
  assert.equal((await api('GET', '/empresas', { token: 'abc.def.ghi' })).status, 401);
});

test('token da Área do Cliente não abre as telas da equipe (e vice-versa)', async () => {
  assert.equal((await api('GET', '/empresas', { token: tCliente })).status, 401);
  assert.equal((await api('GET', '/cliente/me', { token: u.administrador.token })).status, 401);
});

test('usuário desativado perde o acesso na hora', async () => {
  const email = 'desativado@exemplo.com.br';
  const { rows: [l] } = await db.query(`INSERT INTO usuarios (nome, email, senha_hash, role_id) SELECT 'Desativado', $1, 'x', id FROM roles WHERE nome='colaborador_fiscal' RETURNING id`, [email]);
  const t = jwt.sign({ id: l.id, nome: 'Desativado', email, role: 'colaborador_fiscal' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  assert.equal((await api('GET', '/empresas', { token: t })).status, 200);
  await db.query('UPDATE usuarios SET ativo = false WHERE id = $1', [l.id]);
  assert.equal((await api('GET', '/empresas', { token: t })).status, 401);
});

// ------------------------------------------------------------------ permissões
test('permissões: cada papel só faz o que pode', async () => {
  const fiscal = u.supervisor_fiscal.token;
  assert.equal((await api('POST', '/empresas', { token: fiscal, corpo: { razao_social: 'X', cnpj: '76.202.032/0001-31' } })).status, 403, 'fiscal cadastrou empresa');
  assert.equal((await api('GET', '/auth/usuarios', { token: fiscal })).status, 403, 'fiscal viu usuários');
  assert.equal((await api('GET', '/auditoria', { token: fiscal })).status, 403, 'fiscal viu auditoria');
  assert.equal((await api('DELETE', `/empresas/${ids.beta}`, { token: u.analista_legalizacao.token })).status, 403, 'legalização apagou empresa');
  assert.equal((await api('GET', '/planejamento/analises', { token: u.supervisor_folha_pagamento.token })).status, 403, 'folha viu planejamento');
  assert.equal((await api('POST', '/planejamento/radar', { token: u.colaborador_contabilidade.token })).status, 403, 'colaborador rodou o radar');
  assert.equal((await api('GET', '/conferencia-bancaria/painel', { token: fiscal })).status, 403, 'fiscal viu conferência bancária');
  assert.equal((await api('GET', '/guias/receita', { token: u.colaborador_contabilidade.token })).status, 403, 'contábil importou guias');
  assert.equal((await api('POST', `/empresas/${ids.alfa}/situacao-fiscal`, { token: fiscal })).status, 403, 'fiscal consultou situação fiscal');
  assert.equal((await api('GET', '/ajuda/perguntas', { token: fiscal })).status, 403, 'fiscal viu perguntas da ajuda');
  assert.equal((await api('GET', '/tarefas-setor/folha_pagamento', { token: u.colaborador_fiscal.token })).status, 403, 'fiscal viu tarefas da folha');
  assert.equal((await api('GET', '/planejamento/analises', { token: u.colaborador_contabilidade.token })).status, 200);
});

test('permissões dos perfis: administrador libera e tira na hora; ninguém mais muda; usuários fica só com o administrador', async () => {
  const adm = u.administrador.token;
  const fiscal = u.supervisor_fiscal.token;
  const nova = { empresa_id: ids.alfa, tipo: 'federal', status: 'valida' };
  assert.equal((await api('POST', '/certidoes', { token: fiscal, corpo: nova })).status, 403, 'padrão: fiscal não cadastra certidão');
  assert.ok(!(await ok('GET', '/permissoes/minhas', { token: fiscal })).permissoes.includes('certidoes.editar'));
  assert.equal((await api('PUT', '/permissoes', { token: fiscal, corpo: { mudancas: { 'certidoes.editar': ['supervisor_fiscal'] } } })).status, 403, 'só o administrador muda');

  const m = await ok('GET', '/permissoes', { token: adm });
  const antes = m.permissoes.find((p) => p.chave === 'certidoes.editar').papeis;
  const r = await ok('PUT', '/permissoes', { token: adm, corpo: { mudancas: { 'certidoes.editar': [...antes, 'supervisor_fiscal'], 'usuarios.gerenciar': ['supervisor_fiscal'] } } });
  assert.equal(r.mudadas, 1, 'usuarios.gerenciar não pode ser dado a outro perfil');
  assert.ok(r.permissoes.find((p) => p.chave === 'certidoes.editar').mudada);
  assert.ok((await ok('GET', '/permissoes/minhas', { token: fiscal })).permissoes.includes('certidoes.editar'));
  const criada = await api('POST', '/certidoes', { token: fiscal, corpo: nova });
  assert.equal(criada.status, 201, 'liberado: fiscal cadastra');
  assert.equal((await api('GET', '/auth/usuarios', { token: fiscal })).status, 403);

  // volta ao padrão: a linha some e o fiscal perde de novo
  const volta = await ok('PUT', '/permissoes', { token: adm, corpo: { mudancas: { 'certidoes.editar': antes } } });
  assert.ok(!volta.permissoes.find((p) => p.chave === 'certidoes.editar').mudada);
  assert.equal((await api('POST', '/certidoes', { token: fiscal, corpo: nova })).status, 403);
  assert.equal((await api('PUT', '/permissoes', { token: adm, corpo: { mudancas: { 'inventada.x': [] } } })).status, 400);
  const login = await ok('POST', '/auth/login', { corpo: { email: u.supervisor_fiscal.email, senha: 'Senha-Certa-123' } });
  assert.ok(Array.isArray(login.permissoes) && login.permissoes.includes('guias.importar'), 'login já traz as permissões');
});

test('conector do Claude (MCP): chave pessoal, só consulta, respeita permissões, desligar vale na hora', async () => {
  const adm = u.administrador.token;
  const rpc = async (chave, method, params, comoEndereco = false) => {
    const r = await fetch(`${API}/mcp${comoEndereco ? '/' + chave : ''}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(comoEndereco ? {} : { Authorization: `Bearer ${chave}` }) },
      body: JSON.stringify({ jsonrpc: '2.0', ...(method.startsWith('notifications/') ? {} : { id: 7 }), method, ...(params ? { params } : {}) })
    });
    return { status: r.status, dados: r.status === 202 ? null : await r.json() };
  };
  assert.equal((await api('POST', '/conector/chaves', { token: u.supervisor_fiscal.token, corpo: { nome: 'x' } })).status, 403, 'padrão: só o administrador conecta');
  assert.equal((await rpc('sp_chave-que-nao-existe-1234567890', 'tools/list')).status, 401);
  const { chave, id } = await ok('POST', '/conector/chaves', { token: adm, corpo: { nome: 'Teste do conector' } });
  assert.match(chave, /^sp_/);

  const ini = await rpc(chave, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'teste', version: '1' } });
  assert.equal(ini.dados.result.serverInfo.name, 'sistema-privilege');
  assert.match(ini.dados.result.instructions, /Só CONSULTAM|só CONSULTAM/i);
  assert.equal((await rpc(chave, 'notifications/initialized')).status, 202);
  const nomes = (await rpc(chave, 'tools/list')).dados.result.tools.map((t) => t.name);
  for (const n of ['resumo_do_escritorio', 'buscar_empresas', 'ficha_da_empresa', 'vencimentos', 'caixa_postal', 'pesquisar_manual']) assert.ok(nomes.includes(n), n);

  const busca = await rpc(chave, 'tools/call', { name: 'buscar_empresas', arguments: { texto: 'alfa' } }, true);
  assert.equal(busca.dados.result.structuredContent.empresas[0].razao_social, 'Alfa Teste Ltda', 'chave no endereço também funciona');
  const ficha = (await rpc(chave, 'tools/call', { name: 'ficha_da_empresa', arguments: { empresa: '70783653' } })).dados.result.structuredContent;
  assert.equal(ficha.empresa.razao_social, 'Alfa Teste Ltda');
  assert.ok(Array.isArray(ficha.certidoes) && Array.isArray(ficha.tarefas_abertas));
  const resumo = (await rpc(chave, 'tools/call', { name: 'resumo_do_escritorio', arguments: {} })).dados.result.structuredContent;
  assert.ok(resumo.empresas_por_situacao.ativa >= 2);
  const nada = (await rpc(chave, 'tools/call', { name: 'ficha_da_empresa', arguments: { empresa: 'empresa que não existe xyz' } })).dados.result;
  assert.equal(nada.isError, true);
  assert.ok((await rpc(chave, 'tools/call', { name: 'apagar_tudo', arguments: {} })).dados.error, 'ferramenta que não existe');

  // Outra pessoa com o conector liberado só vê as ferramentas das permissões dela
  const m = await ok('GET', '/permissoes', { token: adm });
  const antes = m.permissoes.find((p) => p.chave === 'claude.conectar').papeis;
  await ok('PUT', '/permissoes', { token: adm, corpo: { mudancas: { 'claude.conectar': [...antes, 'analista_legalizacao'] } } });
  const chaveLeg = (await ok('POST', '/conector/chaves', { token: u.analista_legalizacao.token, corpo: { nome: 'Legalização' } })).chave;
  const nomesLeg = (await rpc(chaveLeg, 'tools/list')).dados.result.tools.map((t) => t.name);
  assert.ok(nomesLeg.includes('ficha_da_empresa'));
  // Tirar a permissão desliga as chaves dela na hora
  await ok('PUT', '/permissoes', { token: adm, corpo: { mudancas: { 'claude.conectar': antes } } });
  assert.equal((await rpc(chaveLeg, 'tools/list')).status, 401);

  assert.equal((await api('DELETE', `/conector/chaves/${id}`, { token: adm })).status, 204);
  assert.equal((await rpc(chave, 'tools/list')).status, 401, 'chave desligada para de funcionar');
  const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM logs_auditoria WHERE acao = 'consulta_claude'`);
  assert.ok(rows[0].n >= 4, 'consultas ficam na auditoria');
});

// ------------------------------------------------------------------ Área do Cliente
test('Área do Cliente: vê só a própria empresa e só o que foi liberado', async () => {
  const me = await ok('GET', '/cliente/me', { token: tCliente });
  assert.deepEqual(me.empresas.map((e) => e.id), [ids.alfa]);

  const docs = await ok('GET', `/cliente/empresas/${ids.alfa}/documentos`, { token: tCliente });
  const lista = Array.isArray(docs) ? docs : docs.dados || docs.documentos || [];
  const idsDocs = lista.map((d) => d.id);
  assert.ok(idsDocs.includes(doc.alfaVisivel), 'documento liberado não aparece');
  assert.ok(!idsDocs.includes(doc.alfaInterno), 'documento interno apareceu para o cliente');

  const baixa = await fetch(`${API}/cliente/empresas/${ids.alfa}/documentos/${doc.alfaVisivel}/download`, { headers: { Authorization: `Bearer ${tCliente}` } });
  assert.equal(baixa.status, 200);
  assert.match(Buffer.from(await baixa.arrayBuffer()).toString('latin1'), /CONTRATO ALFA/);
});

test('Área do Cliente: trocar o ID na endereço não abre dados de outra empresa', async () => {
  for (const url of [`/cliente/empresas/${ids.beta}/resumo`, `/cliente/empresas/${ids.beta}/documentos`, `/cliente/empresas/${ids.beta}/solicitacoes`,
    `/cliente/empresas/${ids.beta}/documentos/${doc.beta}/download`]) {
    assert.equal((await api('GET', url, { token: tCliente })).status, 404, url);
  }
  // documento de outra empresa pelo caminho da própria empresa
  assert.equal((await api('GET', `/cliente/empresas/${ids.alfa}/documentos/${doc.beta}/download`, { token: tCliente })).status, 404);
  // documento interno da própria empresa
  assert.equal((await api('GET', `/cliente/empresas/${ids.alfa}/documentos/${doc.alfaInterno}/download`, { token: tCliente })).status, 404);
  // pedido em nome de outra empresa
  assert.equal((await api('POST', `/cliente/empresas/${ids.beta}/solicitacoes`, { token: tCliente, corpo: { setor: 'fiscal', tipo: 'regerar_das', observacao: 'x' } })).status, 404);
  // o outro cliente também não vê a Alfa
  assert.equal((await api('GET', `/cliente/empresas/${ids.alfa}/resumo`, { token: tOutroCliente })).status, 404);
});

test('Área do Cliente: acesso removido pela equipe para de funcionar', async () => {
  const acesso = await ok('POST', `/empresas/${ids.beta}/acessos-cliente`, { token: u.administrador.token, corpo: { nome: 'Sócio Beta', email: 'socio.beta@exemplo.com.br', telefone: '' } });
  const senha = crypto.randomBytes(10).toString('hex');
  await db.query('UPDATE clientes_portal SET senha_hash = $2 WHERE email = $1', ['socio.beta@exemplo.com.br', await bcrypt.hash(senha, 6)]);
  const t = (await ok('POST', '/cliente/login', { corpo: { email: 'socio.beta@exemplo.com.br', senha } })).token;
  assert.equal((await api('GET', `/cliente/empresas/${ids.beta}/resumo`, { token: t })).status, 200);
  const lista = await ok('GET', `/empresas/${ids.beta}/acessos-cliente`, { token: u.administrador.token });
  const item = (Array.isArray(lista) ? lista : lista.acessos || lista.dados || []).find((a) => a.email === 'socio.beta@exemplo.com.br');
  assert.ok(item, `acesso não listado: ${JSON.stringify(acesso).slice(0, 120)}`);
  await ok('DELETE', `/empresas/${ids.beta}/acessos-cliente/${item.cliente_id || item.id}`, { token: u.administrador.token });
  assert.notEqual((await api('GET', `/cliente/empresas/${ids.beta}/resumo`, { token: t })).status, 200);
});

test('Área do Cliente: login errado não diz se o e-mail existe', async () => {
  const a = await api('POST', '/cliente/login', { corpo: { email: 'cliente.alfa@exemplo.com.br', senha: 'errada-123' } });
  const b = await api('POST', '/cliente/login', { corpo: { email: 'naoexiste@exemplo.com.br', senha: 'errada-123' } });
  assert.equal(a.status, 401);
  assert.equal(b.status, a.status);
  assert.equal(b.dados.erro, a.dados.erro);
});

test('Área do Cliente: pedido do cliente chega na fila do setor', async () => {
  await ok('POST', `/cliente/empresas/${ids.alfa}/solicitacoes`, { token: tCliente, corpo: { setor: 'fiscal', tipo: 'regerar_das', competencia: '2026-09', observacao: 'Pedido de teste' } });
  const fila = await ok('GET', '/tarefas-setor/fiscal?pedidos_cliente=1', { token: u.supervisor_fiscal.token });
  const itens = fila.dados || fila.tarefas || fila;
  assert.ok(itens.some((t) => t.empresa_id === ids.alfa && /Pedido de teste/.test(JSON.stringify(t))), 'pedido não apareceu para o Fiscal');
});

// ------------------------------------------------------------------ envio de arquivos
test('arquivo disfarçado (.exe com nome .pdf) é recusado', async () => {
  const exe = Buffer.concat([Buffer.from('MZ'), crypto.randomBytes(200)]);
  const r = await api('POST', '/documentos', { token: u.administrador.token, corpo: formArquivo({ empresa_id: ids.alfa, categoria: 'outros', visivel_cliente: 'false' }, 'guia.pdf', exe) });
  assert.ok(r.status >= 400 && r.status < 500, `aceitou: ${r.status}`);
  const r2 = await api('POST', `/cliente/empresas/${ids.alfa}/documentos`, { token: tCliente, corpo: formArquivo({ descricao: 'x' }, 'nota.pdf', exe) });
  assert.ok(r2.status >= 400 && r2.status < 500, `cliente enviou .exe: ${r2.status}`);
});

// ------------------------------------------------------------------ importar guias
test('importar guias: acha a empresa pelo CNPJ, libera no portal e marca 2ª via do mesmo mês', async () => {
  const fiscal = u.supervisor_fiscal.token;
  const guia = (cnpj, razao, valor, numero) => new Blob([pdfDas({ cnpj, razao, mes: 'setembro/2026', venc: '20/10/2026', valor, numero })], { type: 'application/pdf' });

  const lote = (await ok('POST', '/guias/lotes', { token: fiscal })).lote_id;
  const f = new FormData();
  f.append('arquivos', guia('70.783.653/0001-70', 'ALFA TESTE LTDA', '1.234,56', '07.20.26289.1111111-1'), 'DAS Alfa.pdf');
  f.append('arquivos', guia('76.202.032/0001-31', 'NAO E CLIENTE LTDA', '99,90', '07.20.26289.9999999-9'), 'DAS outra.pdf');
  await ok('POST', `/guias/lotes/${lote}/arquivos`, { token: fiscal, corpo: f });
  const itens = await ok('GET', `/guias/lotes/${lote}`, { token: fiscal });
  const alfa = itens.find((i) => i.empresa_id === ids.alfa);
  assert.ok(alfa, 'guia da Alfa não ligada à empresa');
  assert.ok(itens.some((i) => !i.empresa_id), 'guia de quem não é cliente deveria ficar sem empresa');
  await ok('POST', `/guias/lotes/${lote}/confirmar`, { token: fiscal, corpo: { itens: [{ id: alfa.id }], enviar_email: false } });

  const docs = await ok('GET', `/cliente/empresas/${ids.alfa}/documentos`, { token: tCliente });
  const lista = Array.isArray(docs) ? docs : docs.dados || docs.documentos || [];
  assert.ok(lista.some((d) => d.categoria === 'guia'), 'guia não apareceu na Área do Cliente');
  const docsBeta = await ok('GET', `/cliente/empresas/${ids.beta}/documentos`, { token: tOutroCliente });
  const listaBeta = Array.isArray(docsBeta) ? docsBeta : docsBeta.dados || docsBeta.documentos || [];
  assert.ok(!listaBeta.some((d) => d.categoria === 'guia'), 'guia foi para outra empresa');

  // Mesma empresa, mesmo mês: vem avisando que já foi enviada
  const lote2 = (await ok('POST', '/guias/lotes', { token: fiscal })).lote_id;
  const f2 = new FormData();
  f2.append('arquivos', guia('70.783.653/0001-70', 'ALFA TESTE LTDA', '1.240,02', '07.20.26290.5555555-5'), 'DAS Alfa 2a via.pdf');
  await ok('POST', `/guias/lotes/${lote2}/arquivos`, { token: fiscal, corpo: f2 });
  const [segunda] = await ok('GET', `/guias/lotes/${lote2}`, { token: fiscal });
  assert.ok(segunda.mesmo_mes_importado_em, 'não avisou que a guia do mês já foi enviada');

  // Outra pessoa não mexe no lote de quem importou
  assert.ok((await api('POST', `/guias/lotes/${lote2}/confirmar`, { token: u.colaborador_fiscal.token, corpo: { itens: [{ id: segunda.id }] } })).status >= 400);
});

// ------------------------------------------------------------------ links públicos
test('links públicos: código inválido não abre nada', async () => {
  const falso = crypto.randomBytes(24).toString('hex');
  assert.equal((await api('GET', `/planejamento/publico/questionario/${falso}`)).status, 404);
  assert.equal((await api('GET', `/cliente/link-senha/${falso}`)).status >= 400, true);
  const r = await fetch(`${API}/rastreio/${falso}/d/${doc.alfaVisivel}/arquivo`);
  assert.equal(r.status, 404);
  assert.doesNotMatch(await r.text(), /CONTRATO ALFA/);
  // pixel de abertura sempre responde a imagem, mesmo com código falso
  const gif = await fetch(`${API}/rastreio/${falso}/a.gif`);
  assert.equal(gif.headers.get('content-type'), 'image/gif');
});

test('ajuda: manual do cliente é público e não mostra telas da equipe; o da equipe pede login', async () => {
  const m = await ok('GET', '/ajuda/cliente/manual');
  const texto = JSON.stringify(m).toLowerCase();
  assert.ok(!texto.includes('caixa postal') && !texto.includes('conferência bancária') && !texto.includes('planejamento tributário'));
  assert.equal((await api('GET', '/ajuda/equipe/manual')).status, 401);
  const busca = await ok('POST', '/ajuda/cliente/buscar', { corpo: { pergunta: 'esqueci minha senha' } });
  assert.equal(busca.modo, 'busca');
  // pergunta enorme não derruba nada (a busca pública corta em 500 letras)
  assert.equal((await api('POST', '/ajuda/cliente/buscar', { corpo: { pergunta: 'x'.repeat(5000) } })).status, 200);
});

test('ajuda: administrador ensina uma resposta e o assistente passa a usar; cliente só vê as dos clientes', async () => {
  const adm = u.administrador.token;
  const corpo = { publico: 'equipe', pergunta: 'Quem aprova as férias da equipe?', resposta: 'O supervisor da Folha de Pagamento.', secoes: ['inventada'] };
  assert.equal((await api('POST', '/ajuda/memoria', { token: u.supervisor_fiscal.token, corpo })).status, 403, 'só o administrador ensina');
  const { id } = await ok('POST', '/ajuda/memoria', { token: adm, corpo });
  const r = await ok('POST', '/ajuda/equipe/perguntar', { token: u.supervisor_fiscal.token, corpo: { pergunta: 'quem aprova as ferias da equipe' } });
  assert.equal(r.modo, 'memoria');
  assert.equal(r.resposta, 'O supervisor da Folha de Pagamento.');
  const lista = await ok('GET', '/ajuda/memoria', { token: adm });
  const item = lista.memoria.find((m) => m.id === id);
  assert.equal(item.usos, 1);
  assert.deepEqual(item.secoes, [], 'seção que não existe no manual é descartada');
  assert.ok((await ok('GET', '/ajuda/equipe/manual', { token: adm })).frequentes.some((f) => f.pergunta.includes('férias')), 'vira pergunta frequente');
  assert.ok(!(await ok('GET', '/ajuda/cliente/manual')).frequentes.some((f) => f.pergunta.includes('férias')), 'resposta da equipe não vai para o cliente');
  assert.equal((await ok('POST', '/ajuda/cliente/buscar', { corpo: { pergunta: 'quem aprova as ferias da equipe' } })).modo, 'busca');
  assert.equal((await api('DELETE', `/ajuda/memoria/${id}`, { token: adm })).status, 204);
});

test('cabeçalhos de segurança nas páginas', async () => {
  const r = await fetch(`${BASE}/pages/login.html`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(r.headers.get('x-frame-options') || /frame-ancestors/.test(r.headers.get('content-security-policy') || ''), 'página pode ser embutida em outro site');
  assert.ok(!r.headers.get('x-powered-by'), 'mostra que é Express');
});

// ------------------------------------------------------------------ formulário do site
test('formulário de diagnóstico do site: grava, avisa o administrador e ignora robô', async () => {
  const r = await ok('POST', '/contatos-site', { corpo: { nome: 'José Exemplo', email: 'JOSE@Exemplo.com.br', whatsapp: '(46) 98888-7777', faturamento: 'Até R$ 81 mil/ano', objetivo: 'Abrir uma nova empresa' } });
  assert.ok(r.id);
  assert.equal((await api('POST', '/contatos-site', { corpo: { nome: 'Robô', email: 'robo@exemplo.com.br', site: 'http://spam' } })).status, 201);
  assert.equal((await api('POST', '/contatos-site', { corpo: { nome: 'Sem e-mail', email: 'nao-e-email' } })).status, 400);

  const lista = await ok('GET', '/contatos-site', { token: u.administrador.token });
  assert.equal(lista.length, 1, 'robô foi gravado');
  assert.equal(lista[0].nome, 'José Exemplo');
  assert.equal(lista[0].email, 'jose@exemplo.com.br');
  assert.equal(lista[0].faturamento, 'Até R$ 81 mil/ano', 'acentos');
  const { rows: avisos } = await db.query(`SELECT 1 FROM notificacoes n JOIN usuarios u ON u.id = n.usuario_id WHERE n.tipo = 'contato_site' AND u.id = $1`, [u.administrador.id]);
  assert.equal(avisos.length, 1, 'administrador não foi avisado');

  assert.equal((await api('GET', '/contatos-site')).status, 401);
  assert.equal((await api('GET', '/contatos-site', { token: u.supervisor_fiscal.token })).status, 403);
  assert.equal((await api('PATCH', `/contatos-site/${r.id}`, { token: u.administrador.token, corpo: { status: 'invalido' } })).status, 400);
  const at = await ok('PATCH', `/contatos-site/${r.id}`, { token: u.administrador.token, corpo: { status: 'em_contato', observacao: 'Liguei hoje' } });
  assert.equal(at.status, 'em_contato');
});
