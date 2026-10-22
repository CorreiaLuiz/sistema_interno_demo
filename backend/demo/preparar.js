/**
 * Prepara a DEMONSTRAÇÃO do SISTEMA PRIVILEGE do zero:
 *   1. cria o backend/.env de demonstração (se ainda não existir);
 *   2. cria o banco PostgreSQL da demo e roda schema + migrações;
 *   3. cadastra usuários, empresas fictícias, processos, certidões, licenças,
 *      tarefas, Área do Cliente, guias, e-mails e a conferência bancária —
 *      usando a própria API do sistema (as regras são as de verdade);
 *   4. gera extratos OFX, a planilha de controle e guias DAS de exemplo
 *      em backend/demo-arquivos.
 *
 * Uso:  npm run demo:preparar            (primeira vez)
 *       npm run demo:preparar -- --recriar  (apaga a demo e monta de novo)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { spawn } = require('child_process');

const BACKEND = path.join(__dirname, '..');
const RAIZ = path.join(BACKEND, '..');
const ARQ_ENV = path.join(BACKEND, '.env');
const PASTA_DEMO = path.join(BACKEND, 'demo-arquivos');
const PORTA_TEMP = 3999;
const RECRIAR = process.argv.includes('--recriar');
const SE_PRECISO = process.argv.includes('--se-preciso'); // npm run demo: não refaz o que já existe

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const passo = (t) => console.log(`\n▸ ${t}`);

function perguntar(texto) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((r) => rl.question(texto, (resp) => { rl.close(); r(resp.trim()); }));
}

// ------------------------------------------------------------------ 1. .env
async function garantirEnv() {
  if (fs.existsSync(ARQ_ENV)) {
    const atual = fs.readFileSync(ARQ_ENV, 'utf8');
    if (!/^MODO_DEMO=true/m.test(atual)) {
      throw new Error('Já existe um backend/.env que NÃO é de demonstração. Para não misturar com dados reais, rode a demo numa cópia separada do projeto.');
    }
    return;
  }
  passo('Criando backend/.env de demonstração');
  let senha = process.env.DEMO_DB_PASSWORD;
  if (!senha) senha = await perguntar('Senha do usuário "postgres" do PostgreSQL deste computador: ');
  const modelo = fs.readFileSync(path.join(BACKEND, '.env.example'), 'utf8');
  const valores = {
    NODE_ENV: 'production',
    DB_NAME: 'sistema_ana_demo',
    DB_PASSWORD: senha,
    JWT_SECRET: crypto.randomBytes(48).toString('hex'),
    ADMIN_EMAIL: '', ADMIN_SENHA: '',
    CB_PASTA_EMPRESAS: path.join(PASTA_DEMO, 'empresas'),
    CB_PLANILHA: path.join(PASTA_DEMO, 'Controle Extratos CC.xlsx')
  };
  let env = modelo.replace(/^([A-Z0-9_]+)=.*$/gm, (linha, chave) => (chave in valores ? `${chave}=${valores[chave]}` : linha));
  env = `# DEMONSTRAÇÃO — dados fictícios. Não use este .env com dados reais.\nMODO_DEMO=true\n\n${env}`;
  fs.writeFileSync(ARQ_ENV, env, 'utf8');
}

// ------------------------------------------------------------------ 2. banco
async function prepararBanco() {
  require('dotenv').config({ path: ARQ_ENV, override: true });
  const { Client } = require('pg');
  const conexao = (database) => new Client({
    host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database
  });

  const adm = conexao('postgres');
  try {
    await adm.connect();
  } catch (err) {
    throw new Error(`Não consegui entrar no PostgreSQL (${err.message}). Confira se ele está instalado e se a senha no backend/.env (DB_PASSWORD) está certa.`);
  }
  const nome = process.env.DB_NAME;
  if (!/^[a-z0-9_]+$/.test(nome)) throw new Error('DB_NAME inválido no .env.');
  const { rowCount } = await adm.query('SELECT 1 FROM pg_database WHERE datname = $1', [nome]);
  if (rowCount && SE_PRECISO) {
    await adm.end();
    return null; // demonstração já montada
  }
  if (rowCount && !RECRIAR) {
    await adm.end();
    throw new Error(`O banco "${nome}" já existe. Para montar a demonstração de novo: npm run demo:recriar`);
  }
  if (rowCount) {
    passo(`Apagando o banco "${nome}" antigo`);
    await adm.query(`DROP DATABASE ${nome} WITH (FORCE)`);
  }
  passo(`Criando o banco "${nome}"`);
  await adm.query(`CREATE DATABASE ${nome}`);
  await adm.end();

  const db = conexao(nome);
  await db.connect();
  const sql = (arquivo) => fs.readFileSync(arquivo, 'utf8').replace(/^﻿/, '');
  passo('Criando as tabelas (schema + migrações)');
  await db.query(sql(path.join(RAIZ, 'database', 'schema.sql')));
  // O schema.sql já inclui as migrações até a 008
  const migracoes = fs.readdirSync(path.join(RAIZ, 'database', 'migrations')).filter((f) => /^\d{3}_.*\.sql$/.test(f) && Number(f.slice(0, 3)) >= 9).sort();
  for (const m of migracoes) {
    await db.query('BEGIN');
    await db.query(sql(path.join(RAIZ, 'database', 'migrations', m)));
    await db.query('COMMIT');
    console.log(`   ${m}`);
  }

  passo('Criando os usuários de demonstração');
  const bcrypt = require('bcryptjs');
  const { CONTAS_DEMO, SENHA_DEMO } = require('../src/config/demo');
  const hash = await bcrypt.hash(SENHA_DEMO, 10);
  const usuarios = {};
  for (const c of CONTAS_DEMO) {
    const { rows: [u] } = await db.query(
      `INSERT INTO usuarios (nome, email, senha_hash, role_id) SELECT $1, $2, $3, id FROM roles WHERE nome = $4 RETURNING id`,
      [c.nome, c.email, hash, c.papel]
    );
    if (!u) throw new Error(`Papel "${c.papel}" não existe no banco.`);
    usuarios[c.papel] = { id: u.id, ...c };
  }
  // Analista de certidões/licenças também ajudam a demonstrar as permissões
  for (const [papel, nomeU, email] of [['analista_certidoes', 'Analista de Certidões', 'certidoes@demo.com.br'], ['analista_licencas', 'Analista de Licenças', 'licencas@demo.com.br']]) {
    const { rows: [u] } = await db.query(`INSERT INTO usuarios (nome, email, senha_hash, role_id) SELECT $1, $2, $3, id FROM roles WHERE nome = $4 RETURNING id`, [nomeU, email, hash, papel]);
    if (u) usuarios[papel] = { id: u.id, email, nome: nomeU };
  }
  return { db, usuarios, hash };
}

// ------------------------------------------------------------------ 3. arquivos (OFX, planilha, guias)
async function gerarArquivos() {
  const { EMPRESAS, transacoesDoMes, cenarioDoMes } = require('../src/demo/dados');
  const { pdfDas } = require('../src/demo/pdf');
  const ExcelJS = require('exceljs');
  passo('Gerando extratos OFX, planilha de controle e guias de exemplo');
  fs.rmSync(PASTA_DEMO, { recursive: true, force: true });
  const ano = new Date().getFullYear();
  const mesLimite = new Date().getMonth(); // até o mês passado
  const sigla = { '748': 'SICREDI', '001': 'BB', '756': 'SICOOB', '133': 'CRESOL', '341': 'ITAU', '237': 'BRADESCO' };
  const pastaDe = (e) => e.razao.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+LTDA$/, '');

  for (const e of EMPRESAS) {
    const base = path.join(PASTA_DEMO, 'empresas', pastaDe(e));
    fs.mkdirSync(path.join(base, 'CONTABILIDADE', 'MOVIMENTO CONTABIL', String(ano)), { recursive: true });
    for (const c of e.contas) {
      for (let mes = 1; mes <= mesLimite; mes++) {
        const cen = cenarioDoMes(c, mes);
        if (cen === 'sem_nada' || cen === 'sem_ofx') continue; // cliente ainda não mandou o extrato
        const mm = String(mes).padStart(2, '0');
        const pastaMes = path.join(base, 'CONTABILIDADE', 'MOVIMENTO CONTABIL', String(ano), `${ano} ${mm}`);
        fs.mkdirSync(pastaMes, { recursive: true });
        const fim = new Date(ano, mes, 0).getDate();
        const trs = transacoesDoMes(e, c, ano, mes).map((t) => `<STMTTRN>
<TRNTYPE>${t.valor > 0 ? 'CREDIT' : 'DEBIT'}
<DTPOSTED>${t.data.replace(/-/g, '')}120000
<TRNAMT>${t.valor.toFixed(2)}
<FITID>${t.fitid}
<MEMO>${t.historico}
</STMTTRN>`).join('\n');
        const ofx = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
ENCODING:USASCII
CHARSET:1252

<OFX>
<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>${ano}${mm}${fim}235959</SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><TRNUID>1<STMTRS><CURDEF>BRL
<BANKACCTFROM><BANKID>${c.banco}<BRANCHID>${c.agencia}<ACCTID>${c.numero}<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><DTSTART>${ano}${mm}01<DTEND>${ano}${mm}${fim}
${trs}
</BANKTRANLIST>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>
`;
        fs.writeFileSync(path.join(pastaMes, `${sigla[c.banco] || 'BANCO'} ${mm} ${ano}.ofx`), ofx, 'latin1');
      }
    }
  }

  // Planilha "Controle Extratos CC" (aba Digitação, mesmo layout da planilha do escritório)
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Digitação');
  ws.getRow(1).values = [null, 'Nº', 'Resp.', 'Empresa', 'CNPJ', 'Grupo', 'Cód. Domínio', 'Filial', 'Regime', 'Situação', 'Contato', 'Malote', 'Banco(s)', 'Formato', 'Extratos', 'Solicitado em', 'Por', 'Na pasta', 'Obs.', 'Obs. 2'];
  ws.getRow(2).values = [null, '', '', '(dados fictícios de demonstração)'];
  EMPRESAS.filter((e) => e.codigoDominio).forEach((e, i) => {
    ws.getRow(3 + i).values = [null, i + 1, e.responsavel, e.razao.toUpperCase(), e.cnpj, '', e.codigoDominio, '', e.regime === 'simples_nacional' ? 'SN' : e.regime === 'lucro_presumido' ? 'LP' : 'LR', 'ATIVA',
      e.email, 'E-MAIL', e.contas.map((c) => sigla[c.banco]).join(' / ') || 'SEM BANCO', 'OFX', 'MENSAL', '', '', '', '', ''];
  });
  await wb.xlsx.writeFile(path.join(PASTA_DEMO, 'Controle Extratos CC.xlsx'));

  // Guias DAS de exemplo para testar "Importar guias" (competência do mês passado)
  const pastaGuias = path.join(PASTA_DEMO, 'guias-exemplo');
  fs.mkdirSync(pastaGuias, { recursive: true });
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const ref = new Date(ano, new Date().getMonth() - 1, 1);
  const venc = new Date(ref.getFullYear(), ref.getMonth() + 1, 20).toLocaleDateString('pt-BR');
  EMPRESAS.filter((e) => e.regime === 'simples_nacional').forEach((e, i) => {
    const valor = (350 + i * 187.35).toFixed(2).replace('.', ',');
    fs.writeFileSync(path.join(pastaGuias, `DAS-${e.cnpj.replace(/\D/g, '').slice(0, 8)}-${ref.getFullYear()}${String(ref.getMonth() + 1).padStart(2, '0')}.pdf`),
      pdfDas({ cnpj: e.cnpj, razao: e.razao.toUpperCase(), mesExtenso: `${MESES[ref.getMonth()]}/${ref.getFullYear()}`, vencimento: venc, valor, numero: `07.20.${String(ref.getFullYear()).slice(2)}${String(ref.getMonth() + 1).padStart(3, '0')}.${String(1000000 + i * 1111).slice(0, 7)}-${i}` }));
  });
  // Uma guia de uma empresa que NÃO está cadastrada (mostra o "sem empresa" na conferência)
  fs.writeFileSync(path.join(pastaGuias, 'DAS-empresa-nao-cadastrada.pdf'), pdfDas({
    cnpj: '76.202.032/0001-31', razao: 'EMPRESA QUE NAO E CLIENTE LTDA', mesExtenso: `${MESES[ref.getMonth()]}/${ref.getFullYear()}`,
    vencimento: venc, valor: '99,90', numero: '07.20.99999.9999999-9'
  }));
}

// ------------------------------------------------------------------ 4. cadastros pela API
function subirServidorTemporario() {
  const env = { ...process.env, PORT: String(PORTA_TEMP), APP_URL: `http://localhost:${PORTA_TEMP}`, MODO_DEMO: 'true', NODE_ENV: 'production' };
  const srv = spawn(process.execPath, [path.join(BACKEND, 'src', 'server.js')], { cwd: BACKEND, env, stdio: ['ignore', 'ignore', 'pipe'] });
  let erro = '';
  srv.stderr.on('data', (d) => { erro += d; });
  return { srv, erro: () => erro };
}

async function cadastrar({ db, usuarios }) {
  const jwt = require('jsonwebtoken');
  const { EMPRESAS } = require('../src/demo/dados');
  const { pdfTexto, pdfDas } = require('../src/demo/pdf');
  const { CLIENTE_DEMO } = require('../src/config/demo');
  const API = `http://localhost:${PORTA_TEMP}/api`;
  const tokenDe = (u) => jwt.sign({ id: u.id, nome: u.nome, email: u.email, role: u.papel }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const adm = tokenDe(usuarios.administrador);

  async function api(metodo, url, corpo, token = adm) {
    const ehForm = corpo instanceof FormData;
    const r = await fetch(API + url, {
      method: metodo,
      headers: { Authorization: `Bearer ${token}`, ...(corpo && !ehForm ? { 'Content-Type': 'application/json' } : {}) },
      body: corpo ? (ehForm ? corpo : JSON.stringify(corpo)) : undefined
    });
    const dados = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`${metodo} ${url} → ${r.status} ${dados && dados.erro}`);
    return dados;
  }
  const hoje = new Date();
  const dia = (n) => { const d = new Date(hoje); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const pdfDoc = (titulo, linhas) => new Blob([pdfTexto([{ texto: titulo, negrito: true, tamanho: 15 }, '', ...linhas])], { type: 'application/pdf' });
  async function enviarDocumento(empresaId, nome, categoria, blob, visivel = true, descricao) {
    const f = new FormData();
    f.append('arquivo', blob, nome);
    f.append('empresa_id', empresaId);
    f.append('categoria', categoria);
    if (descricao) f.append('descricao', descricao);
    f.append('visivel_cliente', String(visivel));
    return api('POST', '/documentos', f);
  }

  passo('Cadastrando empresas fictícias');
  const ids = {};
  for (const e of EMPRESAS) {
    const nova = await api('POST', '/empresas', {
      razao_social: e.razao, nome_fantasia: e.fantasia, cnpj: e.cnpj, regime_tributario: e.regime,
      situacao: e.situacao, cidade: e.cidade, uf: e.uf, email: e.email, telefone: e.telefone,
      data_abertura: dia(-400 - e.razao.length * 20), competencia_inicio: dia(-30).slice(0, 7),
      ...(e.situacao === 'em_legalizacao' ? { responsavel_legalizacao_id: usuarios.analista_legalizacao.id } : {})
    });
    ids[e.chave] = nova.id;
    console.log(`   ${e.razao}`);
  }
  await esperar(1500); // esteira de integração roda em segundo plano

  passo('Sócios e esteira de empresa nova');
  const SOCIOS = [['Carlos Alberto Fictício', 60, true], ['Mariana Exemplo', 40, false]];
  for (const e of EMPRESAS) {
    for (const [i, [nomeS, pct, admS]] of SOCIOS.entries()) {
      if (i === 1 && e.situacao !== 'ativa') continue;
      await api('POST', `/empresas/${ids[e.chave]}/socios`, { nome: `${nomeS.split(' ')[0]} ${e.fantasia.split(' ')[0]} ${nomeS.split(' ').slice(1).join(' ')}`, percentual_participacao: e.situacao === 'ativa' ? pct : 100, administrador: admS });
    }
    // Empresas ativas já passaram pela esteira (Legalização → Cadastro no Domínio → Fechamento setorial)
    if (e.situacao === 'ativa') {
      for (let n = 0; n < 2; n++) await api('POST', `/onboarding/${ids[e.chave]}/avancar`, {}).catch(() => {});
    }
  }
  await api('POST', `/onboarding/${ids.tech}/avancar`, {}).catch(() => {}); // uma em "Cadastro no Domínio"

  passo('Processos de legalização e quadro (pipeline)');
  const proc = async (chave, tipo, extra = {}) => api('POST', '/processos-legalizacao', {
    empresa_id: ids[chave], tipo, status: 'em_andamento', responsavel_id: usuarios.analista_legalizacao.id,
    data_prevista_conclusao: dia(20), ...extra
  });
  const existentes = (await api('GET', '/processos-legalizacao?limite=50')).dados || [];
  const garantir = async (chave, tipo, extra) => existentes.find((p) => p.empresa_id === ids[chave] && p.tipo === tipo) || proc(chave, tipo, extra);
  const pTransp = await garantir('transportes', 'abertura', { descricao: 'Abertura de transportadora — Simples Nacional', protocolo: 'PRJ2600123' });
  const pTech = await garantir('tech', 'abertura', { descricao: 'Abertura de empresa de software', protocolo: 'PRJ2600456' });
  const pAlfa = await proc('alfa', 'alteracao', { descricao: 'Alteração de endereço e entrada de sócio', orgao: 'Junta Comercial do Paraná' });
  const pClinica = await proc('clinica', 'alteracao', { descricao: 'Inclusão de atividade (CNAE) de fisioterapia', orgao: 'Junta Comercial do Paraná', data_prevista_conclusao: dia(-5) });
  await api('POST', `/processos-legalizacao/${pTransp.id}/mover`, { destino: 'Inscrição Estadual' });
  await api('POST', `/processos-legalizacao/${pTech.id}/mover`, { destino: 'Receita Federal (DBE/CNPJ)' });
  await api('POST', `/processos-legalizacao/${pAlfa.id}/mover`, { destino: 'Junta Comercial' });
  await api('PUT', `/processos-legalizacao/${pClinica.id}`, { status: 'exigencia', observacoes: 'Junta pediu nova via do contrato assinada por todos os sócios.' });
  for (const [p, item] of [[pTransp, 'Comprovante de endereço da sede'], [pTech, 'RG e CPF dos sócios']]) {
    const lista = await api('GET', `/processos-legalizacao/${p.id}/checklist`).catch(() => null);
    const itens = Array.isArray(lista) ? lista : (lista && lista.itens) || [];
    for (const it of itens.slice(0, 2)) await api('PATCH', `/processos-legalizacao/${p.id}/checklist/${it.id}`, { recebido: true }).catch(() => {});
    void item;
  }

  passo('Certidões e licenças');
  const certidoes = [
    ['alfa', 'estadual', 'SEFAZ/PR', dia(-60), dia(25)], ['alfa', 'municipal', 'Prefeitura Municipal', dia(-100), dia(-10)],
    ['alfa', 'trabalhista', 'TST (CNDT)', dia(-20), dia(160)], ['beta', 'estadual', 'SEFAZ/PR', dia(-30), dia(60)],
    ['beta', 'fgts', 'Caixa (CRF)', dia(-25), dia(5)], ['padaria', 'municipal', 'Prefeitura Municipal', dia(-80), dia(10)],
    ['horizonte', 'trabalhista', 'TST (CNDT)', dia(-170), dia(-2)], ['mercado', 'estadual', 'SEFAZ/PR', dia(-15), dia(75)],
    ['clinica', 'municipal', 'Prefeitura Municipal', dia(-40), dia(50)]
  ];
  for (const [c, tipo, orgao, emissao, validade] of certidoes) {
    await api('POST', '/certidoes', { empresa_id: ids[c], tipo, orgao_emissor: orgao, data_emissao: emissao, data_validade: validade, numero_certidao: `DEMO-${Math.floor(Math.random() * 1e6)}` });
  }
  const licencas = [
    ['alfa', 'funcionamento', 'Prefeitura Municipal', dia(-300), dia(65)], ['padaria', 'vigilancia_sanitaria', 'Vigilância Sanitária', dia(-340), dia(20)],
    ['padaria', 'bombeiros', 'Corpo de Bombeiros (CLCB)', dia(-700), dia(-15)], ['clinica', 'vigilancia_sanitaria', 'Vigilância Sanitária', dia(-200), dia(165)],
    ['horizonte', 'ambiental', 'IAT (licença ambiental)', dia(-500), dia(230)], ['mercado', 'bombeiros', 'Corpo de Bombeiros (CLCB)', dia(-100), dia(265)]
  ];
  for (const [c, tipo, orgao, emissao, validade] of licencas) {
    await api('POST', '/licencas', { empresa_id: ids[c], tipo, orgao_emissor: orgao, data_emissao: emissao, data_validade: validade, numero_licenca: `L-${Math.floor(Math.random() * 1e5)}` });
  }
  for (const [c, validade] of [['alfa', dia(40)], ['beta', dia(200)], ['padaria', dia(-3)], ['horizonte', dia(12)], ['mercado', dia(300)]]) {
    await api('POST', '/certificados-digitais', { empresa_id: ids[c], tipo: 'e-cnpj', numero_serie: crypto.randomBytes(6).toString('hex').toUpperCase(), data_emissao: dia(-325), data_validade: validade, observacoes: 'Certificado A1 (fictício)' });
  }

  passo('CND Federal (SERPRO simulado)');
  for (const c of ['alfa', 'beta', 'padaria', 'horizonte', 'mercado']) {
    const r = await api('POST', `/empresas/${ids[c]}/cnd-federal`);
    console.log(`   ${c}: ${r.situacao}`);
  }

  passo('Documentos das empresas');
  for (const e of EMPRESAS.filter((x) => x.situacao === 'ativa')) {
    await enviarDocumento(ids[e.chave], `Cartao CNPJ ${e.fantasia}.pdf`, 'cartao_cnpj', pdfDoc('COMPROVANTE DE INSCRIÇÃO E DE SITUAÇÃO CADASTRAL', [
      `CNPJ: ${e.cnpj}`, `Nome empresarial: ${e.razao.toUpperCase()}`, `Título do estabelecimento: ${e.fantasia.toUpperCase()}`,
      `Município: ${e.cidade.toUpperCase()}   UF: ${e.uf}`, 'Situação cadastral: ATIVA']));
    await enviarDocumento(ids[e.chave], `Contrato Social ${e.fantasia}.pdf`, 'contrato_social', pdfDoc('CONTRATO SOCIAL (CONSOLIDADO)', [
      e.razao, `CNPJ ${e.cnpj}`, '', 'Cláusula 1ª — A sociedade gira sob o nome empresarial acima.', 'Cláusula 2ª — Capital social de R$ 50.000,00.']));
  }
  await enviarDocumento(ids.alfa, 'Comprovante pagamento aluguel.pdf', 'comprovante', pdfDoc('COMPROVANTE DE PAGAMENTO', ['Aluguel da sede — documento interno do escritório']), false);

  passo('Área do Cliente (login do cliente e pedidos)');
  for (const c of ['alfa', 'padaria', 'mercado']) await api('POST', `/empresas/${ids[c]}/acessos-cliente`, { nome: CLIENTE_DEMO.nome, email: CLIENTE_DEMO.email, telefone: '' });
  const bcrypt = require('bcryptjs');
  const { SENHA_DEMO } = require('../src/config/demo');
  await db.query('UPDATE clientes_portal SET senha_hash = $2 WHERE email = $1', [CLIENTE_DEMO.email, await bcrypt.hash(SENHA_DEMO, 10)]);
  const login = await fetch(`${API}/cliente/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: CLIENTE_DEMO.email, senha: SENHA_DEMO }) }).then((r) => r.json());
  const tCli = login.token;
  const mesPassado = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
  const comp = `${mesPassado.getFullYear()}-${String(mesPassado.getMonth() + 1).padStart(2, '0')}`;
  await api('POST', `/cliente/empresas/${ids.alfa}/solicitacoes`, { setor: 'fiscal', tipo: 'regerar_das', competencia: comp, observacao: 'Esqueci de pagar no vencimento, preciso da guia atualizada.' }, tCli);
  await api('POST', `/cliente/empresas/${ids.padaria}/solicitacoes`, { setor: 'folha_pagamento', tipo: 'ferias', observacao: 'Funcionária Maria (fictícia) quer tirar férias a partir do dia 10.' }, tCli);
  await api('POST', `/cliente/empresas/${ids.mercado}/solicitacoes`, { setor: 'folha_pagamento', tipo: 'regerar_fgts', competencia: comp, observacao: 'A guia do FGTS venceu.' }, tCli);

  passo('Tarefas dos setores');
  const tarefas = [
    ['fiscal', 'alfa', 'Apurar ICMS-ST das notas de entrada', 'fiscal@demo.com.br', 'Supervisor Fiscal', dia(3)],
    ['fiscal', 'mercado', 'Conferir notas canceladas do mês', 'fiscal@demo.com.br', 'Supervisor Fiscal', dia(-2)],
    ['contabilidade', 'horizonte', 'Conciliar conta de empréstimo (BNDES)', 'contabil@demo.com.br', 'Supervisor Contábil', dia(7)],
    ['contabilidade', 'beta', 'Fechar balancete trimestral', 'contabil@demo.com.br', 'Supervisor Contábil', dia(-1)],
    ['folha_pagamento', 'padaria', 'Calcular rescisão de funcionário (fictício)', 'folha@demo.com.br', 'Supervisor da Folha', dia(2)],
    ['folha_pagamento', 'clinica', 'Admissão de recepcionista', 'folha@demo.com.br', 'Supervisor da Folha', dia(5)]
  ];
  for (const [setor, c, descricao, email, nomeR, prazo] of tarefas) {
    await api('POST', `/tarefas-setor/${setor}`, { empresa_id: ids[c], descricao, responsavel_email: email, responsavel_nome: nomeR, prazo: `${prazo}T17:00:00` });
  }

  passo('Importação de guias DAS + e-mails aos clientes (simulados)');
  const { lote_id: loteId } = await api('POST', '/guias/lotes');
  const f = new FormData();
  const pastaGuias = path.join(PASTA_DEMO, 'guias-exemplo');
  for (const nome of fs.readdirSync(pastaGuias).filter((n) => !/nao-cadastrada/.test(n)).slice(0, 4)) {
    f.append('arquivos', new Blob([fs.readFileSync(path.join(pastaGuias, nome))], { type: 'application/pdf' }), nome);
  }
  await api('POST', `/guias/lotes/${loteId}/arquivos`, f);
  const lote = await api('GET', `/guias/lotes/${loteId}`);
  const itens = (Array.isArray(lote) ? lote : lote.itens || []).filter((i) => i.empresa_id);
  await api('POST', `/guias/lotes/${loteId}/confirmar`, { itens: itens.map((i) => ({ id: i.id })), enviar_email: true });
  console.log(`   ${itens.length} guias importadas`);
  // Guias usadas no lote saem da pasta de exemplo (as outras ficam para você testar)
  await esperar(itens.length * 1500 + 2500);

  // Alguns clientes "abrem" e "baixam" — para a tela E-mails enviados ter o que mostrar
  const { rows: emails } = await db.query(`SELECT e.token, d.documento_id FROM emails_enviados e
     JOIN emails_enviados_documentos d ON d.email_id = e.id ORDER BY e.enviado_em`);
  for (const [i, m] of emails.entries()) {
    if (i % 3 !== 2) await fetch(`${API}/rastreio/${m.token}/a.gif`);
    if (i % 2 === 0) await fetch(`${API}/rastreio/${m.token}/d/${m.documento_id}/arquivo`);
  }
  await db.query(`UPDATE emails_enviados SET status = 'enviado' WHERE status = 'simulado'`);

  passo('Conferência bancária (Domínio simulado)');
  await api('POST', '/conferencia-bancaria/planilha');
  const cbs = await api('GET', '/conferencia-bancaria/empresas');
  const lista = Array.isArray(cbs) ? cbs : cbs.empresas || cbs.dados || [];
  const idsCb = lista.filter((x) => x.codigo_dominio).map((x) => x.id);
  await api('POST', '/conferencia-bancaria/lote', { ids: idsCb, ano: hoje.getFullYear() });
  for (let n = 0; n < 60; n++) {
    await esperar(1000);
    const st = await api('GET', '/conferencia-bancaria/lote');
    if (st && !st.rodando && !st.emAndamento) break;
  }
  console.log(`   ${idsCb.length} empresas conferidas`);

  passo('Integra Contador simulado: situação fiscal e Caixa Postal');
  for (const c of ['alfa', 'padaria', 'mercado']) {
    await api('POST', `/empresas/${ids[c]}/situacao-fiscal`).catch((e) => console.log(`   (situação fiscal: ${e.message})`));
    await api('POST', `/caixa-postal/${ids[c]}/verificar`).catch((e) => console.log(`   (caixa postal: ${e.message})`));
  }

  passo('Planejamento tributário (Domínio simulado)');
  for (const c of ['alfa', 'padaria', 'mercado']) {
    const cnpj = EMPRESAS.find((e) => e.chave === c).cnpj.replace(/\D/g, '');
    await api('POST', '/planejamento/analisar', { cnpj }).catch((e) => console.log(`   (planejamento: ${e.message})`));
  }

  passo('Pedido de diagnóstico pelo site');
  await fetch(`${API}/contatos-site`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome: 'Joana Fictícia', email: 'joana@exemplo.com.br', whatsapp: '(46) 99999-0000', faturamento: 'R$ 81 mil – R$ 360 mil/ano', objetivo: 'Trocar de contador' }) });
}

// ------------------------------------------------------------------
(async () => {
  console.log('SISTEMA PRIVILEGE — preparando a DEMONSTRAÇÃO (dados fictícios)');
  let banco;
  let servidor;
  try {
    await garantirEnv();
    banco = await prepararBanco();
    if (!banco) {
      console.log('\nA demonstração já está montada — ligando o sistema em http://localhost:3000/pages/login.html');
      console.log('(para apagar tudo e montar de novo: npm run demo:recriar)');
      return;
    }
    await gerarArquivos();
    passo('Subindo o sistema por um instante para cadastrar os dados');
    servidor = subirServidorTemporario();
    for (let i = 0; i < 40; i++) {
      await esperar(500);
      try { if ((await fetch(`http://localhost:${PORTA_TEMP}/api/demo`)).ok) break; } catch (e) { /* subindo */ }
      if (i === 39) throw new Error(`O sistema não subiu: ${servidor.erro().slice(0, 300)}`);
    }
    await cadastrar(banco);
    // Arquivos usados no lote de importação ficam também como exemplo; a lista de logins:
    const { CONTAS_DEMO, CLIENTE_DEMO, SENHA_DEMO } = require('../src/config/demo');
    console.log('\n✔ Demonstração pronta!\n');
    if (!SE_PRECISO) console.log('  Ligue o sistema:   npm start');
    console.log('  Abra no navegador: http://localhost:3000/pages/login.html\n');
    console.log(`  Logins (senha de todos: ${SENHA_DEMO}):`);
    CONTAS_DEMO.forEach((c) => console.log(`   - ${c.rotulo.padEnd(26)} ${c.email}`));
    console.log(`   - Área do Cliente            ${CLIENTE_DEMO.email}  (http://localhost:3000/pages/cliente-login.html)`);
    console.log(`\n  Guias DAS para testar a importação: ${path.join(PASTA_DEMO, 'guias-exemplo')}`);
  } catch (err) {
    console.error(`\n✖ ${err.message}`);
    process.exitCode = 1;
  } finally {
    if (servidor) servidor.srv.kill();
    if (banco) await banco.db.end().catch(() => {});
  }
})();
