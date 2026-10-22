/**
 * Gera as imagens (prints) dos manuais: frontend/ajuda/prints/{equipe,cliente}/*.png
 *
 *   npm run manual:prints
 *
 * NUNCA usa dados reais: cria um banco TEMPORÁRIO (sistema_ana_prints) com empresas e
 * pessoas fictícias, liga o sistema numa porta separada (3200) com e-mail, WhatsApp,
 * SERPRO e Domínio DESLIGADOS, fotografa as telas no Edge (sem abrir janela) e apaga
 * tudo no fim (banco, arquivos e pasta temporária). O sistema de verdade não é tocado.
 *
 * Para mudar o que aparece num print: ajuste os dados em semear() ou os passos em PRINTS.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const BACKEND = path.join(__dirname, '..');
const RAIZ = path.join(BACKEND, '..');
require(path.join(BACKEND, 'node_modules', 'dotenv')).config({ path: path.join(BACKEND, '.env') });
const { Pool } = require(path.join(BACKEND, 'node_modules', 'pg'));
const jwt = require(path.join(BACKEND, 'node_modules', 'jsonwebtoken'));
const bcrypt = require(path.join(BACKEND, 'node_modules', 'bcryptjs'));
const { pdfDas } = require(path.join(BACKEND, 'tests', 'ajudantes'));

const BANCO = 'sistema_ana_prints';
const PORTA = 3200;
const PORTA_EDGE = 9350;
const BASE = `http://[::1]:${PORTA}`;
const API = `http://localhost:${PORTA}/api`;
const SAIDA = path.join(RAIZ, 'frontend', 'ajuda', 'prints');
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
const SENHA_CLIENTE = crypto.randomBytes(12).toString('hex');
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const passo = (t) => console.log(`\n▸ ${t}`);
const conexao = (database) => new Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database });

/** PDF simples de texto (cartão CNPJ, contrato...), só para ter o que listar. */
function pdfTexto(linhas) {
  const conteudo = 'BT /F1 12 Tf 50 790 Td 18 TL ' + linhas.map((l) => `(${String(l).replace(/[()\\]/g, '')}) Tj T*`).join(' ') + ' ET';
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(conteudo, 'latin1')} >>\nstream\n${conteudo}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'];
  let pdf = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(pdf, 'latin1')); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

// ------------------------------------------------------------------ banco temporário
async function criarBanco() {
  passo(`Criando o banco temporário "${BANCO}" (dados fictícios)`);
  const adm = conexao('postgres');
  await adm.query(`DROP DATABASE IF EXISTS ${BANCO} WITH (FORCE)`);
  await adm.query(`CREATE DATABASE ${BANCO}`);
  await adm.end();
  const db = conexao(BANCO);
  const sql = (arq) => fs.readFileSync(arq, 'utf8').replace(/^\uFEFF/, '');
  await db.query(sql(path.join(RAIZ, 'database', 'schema.sql')));
  const pasta = path.join(RAIZ, 'database', 'migrations');
  for (const m of fs.readdirSync(pasta).filter((f) => /^\d{3}_.*\.sql$/.test(f) && Number(f.slice(0, 3)) >= 9).sort()) await db.query(sql(path.join(pasta, m)));
  return db;
}

async function apagarBanco(db) {
  if (db) await db.end().catch(() => {});
  const adm = conexao('postgres');
  await adm.query(`DROP DATABASE IF EXISTS ${BANCO} WITH (FORCE)`).catch(() => {});
  await adm.end();
}

// ------------------------------------------------------------------ dados fictícios
async function semear(db) {
  passo('Criando pessoas e empresas fictícias');
  const hash = await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 6);
  const usuarios = {};
  for (const [papel, nome, email] of [['administrador', 'Ana Exemplo', 'ana@exemplo.com.br'], ['analista_legalizacao', 'Bruno Legalização', 'bruno@exemplo.com.br'],
    ['supervisor_fiscal', 'Carla Fiscal', 'carla@exemplo.com.br'], ['supervisor_contabilidade', 'Diego Contábil', 'diego@exemplo.com.br'], ['supervisor_folha_pagamento', 'Elisa Folha', 'elisa@exemplo.com.br']]) {
    const { rows: [u] } = await db.query(`INSERT INTO usuarios (nome, email, senha_hash, role_id) SELECT $1,$2,$3,id FROM roles WHERE nome=$4 RETURNING id`, [nome, email, hash, papel]);
    usuarios[papel] = { id: u.id, nome, email, role: papel, token: jwt.sign({ id: u.id, nome, email, role: papel }, process.env.JWT_SECRET, { expiresIn: '2h' }) };
  }
  const adm = usuarios.administrador.token;
  async function api(metodo, url, corpo, token = adm) {
    const form = corpo instanceof FormData;
    const r = await fetch(API + url, { method: metodo, headers: { Authorization: `Bearer ${token}`, ...(corpo && !form ? { 'Content-Type': 'application/json' } : {}) }, body: corpo ? (form ? corpo : JSON.stringify(corpo)) : undefined });
    const dados = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`${metodo} ${url} → ${r.status} ${dados && dados.erro}`);
    return dados;
  }
  const hoje = new Date();
  const dia = (n) => { const d = new Date(hoje); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const mesPassado = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
  const comp = `${mesPassado.getFullYear()}-${String(mesPassado.getMonth() + 1).padStart(2, '0')}`;
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  const EMPRESAS = [
    ['alfa', 'Alfa Comércio de Alimentos Ltda', 'Mercadinho Alfa', '70.783.653/0001-70', 'simples_nacional', 'ativa', 'Francisco Beltrão', 'alfa@exemplo.com.br'],
    ['beta', 'Beta Serviços Médicos Ltda', 'Clínica Beta', '36.112.408/0001-55', 'lucro_presumido', 'ativa', 'Pato Branco', 'beta@exemplo.com.br'],
    ['gama', 'Gama Transportes Ltda', 'Gama Transportes', '29.553.761/0001-02', 'simples_nacional', 'ativa', 'Francisco Beltrão', 'gama@exemplo.com.br'],
    ['delta', 'Delta Tecnologia Ltda', 'Delta Tech', '41.880.236/0001-91', 'simples_nacional', 'ativa', 'Dois Vizinhos', 'delta@exemplo.com.br'],
    ['padaria', 'Padaria Pão Dourado Ltda', 'Pão Dourado', '33.271.905/0001-48', 'simples_nacional', 'ativa', 'Francisco Beltrão', 'padaria@exemplo.com.br'],
    ['joao', 'João da Silva Exemplo', 'João Eletricista', '52.604.117/0001-83', 'mei', 'ativa', 'Marmeleiro', 'joao@exemplo.com.br'],
    ['nova', 'Nova Estética Ltda', 'Nova Estética', '58.019.442/0001-27', 'simples_nacional', 'em_legalizacao', 'Francisco Beltrão', 'nova@exemplo.com.br']
  ];
  const ids = {};
  for (const [chave, razao, fantasia, cnpj, regime, situacao, cidade, email] of EMPRESAS) {
    const e = await api('POST', '/empresas', { razao_social: razao, nome_fantasia: fantasia, cnpj, regime_tributario: regime, situacao, cidade, uf: 'PR', email, telefone: '(46) 99999-0000', competencia_inicio: comp,
      ...(situacao === 'em_legalizacao' ? { responsavel_legalizacao_id: usuarios.analista_legalizacao.id } : {}) });
    ids[chave] = e.id;
  }
  await esperar(1200);
  for (const c of ['alfa', 'beta', 'gama']) {
    await api('POST', `/empresas/${ids[c]}/socios`, { nome: 'Carlos Exemplo', percentual_participacao: 60, administrador: true }).catch(() => {});
    await api('POST', `/empresas/${ids[c]}/socios`, { nome: 'Mariana Exemplo', percentual_participacao: 40, administrador: false }).catch(() => {});
  }

  passo('Processos, certidões, licenças e certificados');
  const proc = (c, tipo, extra) => api('POST', '/processos-legalizacao', { empresa_id: ids[c], tipo, status: 'em_andamento', responsavel_id: usuarios.analista_legalizacao.id, data_prevista_conclusao: dia(20), ...extra });
  const existentes = (await api('GET', '/processos-legalizacao?limite=50')).dados || [];
  const pNova = existentes.find((p) => p.empresa_id === ids.nova) || await proc('nova', 'abertura', { descricao: 'Abertura de clínica de estética' });
  const pDelta = await proc('delta', 'abertura', { descricao: 'Abertura de filial', protocolo: 'PRJ2600456' });
  const pAlfa = await proc('alfa', 'alteracao', { descricao: 'Alteração de endereço', orgao: 'Junta Comercial do Paraná' });
  await proc('beta', 'alteracao', { descricao: 'Inclusão de atividade', orgao: 'Junta Comercial do Paraná' });
  for (const [p, tipo, coluna] of [[pNova, 'abertura', 1], [pDelta, 'abertura', 2], [pAlfa, 'alteracao', 0]]) {
    const pipe = await api('GET', `/processos-legalizacao/pipeline?tipo=${tipo}`).catch(() => null);
    const colunas = pipe && (pipe.colunas || pipe.etapas || []);
    const destino = colunas && colunas[coluna] && (colunas[coluna].nome || colunas[coluna].etapa || colunas[coluna].titulo || colunas[coluna]);
    if (typeof destino === 'string') await api('POST', `/processos-legalizacao/${p.id}/mover`, { destino }).catch(() => {});
    const lista = await api('GET', `/processos-legalizacao/${p.id}/checklist`).catch(() => null);
    const itens = Array.isArray(lista) ? lista : (lista && lista.itens) || [];
    for (const it of itens.slice(0, 2)) await api('PATCH', `/processos-legalizacao/${p.id}/checklist/${it.id}`, { recebido: true }).catch(() => {});
  }
  for (const [c, tipo, orgao, em, val] of [['alfa', 'estadual', 'SEFAZ/PR', -60, 25], ['alfa', 'municipal', 'Prefeitura Municipal', -100, -10], ['beta', 'trabalhista', 'TST (CNDT)', -20, 160],
    ['gama', 'fgts', 'Caixa (CRF)', -25, 5], ['padaria', 'municipal', 'Prefeitura Municipal', -80, 70], ['delta', 'estadual', 'SEFAZ/PR', -15, 75]]) {
    await api('POST', '/certidoes', { empresa_id: ids[c], tipo, orgao_emissor: orgao, data_emissao: dia(em), data_validade: dia(val), numero_certidao: `EX-${100000 + Math.floor(Math.random() * 899999)}` });
  }
  for (const [c, tipo, orgao, val] of [['alfa', 'funcionamento', 'Prefeitura Municipal', 65], ['padaria', 'vigilancia_sanitaria', 'Vigilância Sanitária', 20], ['padaria', 'bombeiros', 'Corpo de Bombeiros', -15]]) {
    await api('POST', '/licencas', { empresa_id: ids[c], tipo, orgao_emissor: orgao, data_emissao: dia(-300), data_validade: dia(val), numero_licenca: `L-${10000 + Math.floor(Math.random() * 89999)}` });
  }
  for (const [c, val] of [['alfa', 40], ['beta', 200], ['padaria', -3]]) {
    await api('POST', '/certificados-digitais', { empresa_id: ids[c], tipo: 'e-cnpj', numero_serie: crypto.randomBytes(6).toString('hex').toUpperCase(), data_emissao: dia(-325), data_validade: dia(val), observacoes: 'Certificado A1 (exemplo)' });
  }
  // Situação fiscal (o SERPRO fica desligado: grava direto um resultado de exemplo)
  await db.query(`INSERT INTO situacao_fiscal (empresa_id, situacao, resumo, usuario_id) VALUES ($1,'regular',$2,$3)`, [ids.alfa, JSON.stringify({ certidao: { tipo: 'Certidão Positiva com Efeitos de Negativa', codigo: 'A1B2.C3D4.E5F6.7890', emissao: dia(-10), validade: dia(170) }, pendencias: [], suspensos: ['Débito com Exigibilidade Suspensa (SIEF)'], pgfnSemPendencias: true }), usuarios.administrador.id]);
  await db.query(`INSERT INTO certidoes (empresa_id, tipo, orgao_emissor, numero_certidao, status, data_emissao, data_validade, observacoes) VALUES ($1,'federal','Receita Federal do Brasil / PGFN','A1B2.C3D4.E5F6.7890','valida',$2,$3,'Certidão Positiva com Efeitos de Negativa, lida do Relatório de Situação Fiscal.')`, [ids.alfa, dia(-10), dia(170)]);

  passo('Documentos, Área do Cliente e pedidos');
  async function documento(c, nome, categoria, linhas, visivel = true) {
    const f = new FormData();
    f.append('arquivo', new Blob([pdfTexto(linhas)], { type: 'application/pdf' }), nome);
    f.append('empresa_id', ids[c]); f.append('categoria', categoria); f.append('visivel_cliente', String(visivel));
    return api('POST', '/documentos', f);
  }
  for (const c of ['alfa', 'padaria']) {
    await documento(c, 'Cartao CNPJ.pdf', 'cartao_cnpj', ['COMPROVANTE DE INSCRICAO E DE SITUACAO CADASTRAL', 'Documento de exemplo']);
    await documento(c, 'Contrato Social.pdf', 'contrato_social', ['CONTRATO SOCIAL', 'Documento de exemplo']);
  }
  await documento('alfa', 'Alvara de funcionamento.pdf', 'alvara', ['ALVARA DE FUNCIONAMENTO', 'Documento de exemplo']);
  await documento('alfa', 'Comprovante interno.pdf', 'comprovante', ['Documento interno'], false);

  const acesso = await api('POST', `/empresas/${ids.alfa}/acessos-cliente`, { nome: 'Cliente Exemplo', email: 'cliente@exemplo.com.br', telefone: '' });
  await api('POST', `/empresas/${ids.padaria}/acessos-cliente`, { nome: 'Cliente Exemplo', email: 'cliente@exemplo.com.br', telefone: '' });
  await api('POST', `/empresas/${ids.alfa}/acessos-cliente`, { nome: 'Sócia Exemplo', email: 'socia@exemplo.com.br', telefone: '' });
  const convite = await api('POST', `/empresas/${ids.gama}/acessos-cliente`, { nome: 'Novo Cliente', email: 'novo@exemplo.com.br', telefone: '' });
  await db.query('UPDATE clientes_portal SET senha_hash = $2 WHERE email = $1', ['cliente@exemplo.com.br', await bcrypt.hash(SENHA_CLIENTE, 6)]);
  const login = await fetch(`${API}/cliente/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'cliente@exemplo.com.br', senha: SENHA_CLIENTE }) }).then((r) => r.json());
  const tCli = login.token;
  await api('POST', `/cliente/empresas/${ids.alfa}/solicitacoes`, { setor: 'fiscal', tipo: 'regerar_das', competencia: comp, observacao: 'Esqueci de pagar no vencimento, preciso da guia atualizada.' }, tCli);
  await api('POST', `/cliente/empresas/${ids.alfa}/solicitacoes`, { setor: 'folha_pagamento', tipo: 'ferias', observacao: 'Funcionária quer tirar férias a partir do dia 10.' }, tCli);
  // Um pedido já respondido (para o print da lista de pedidos)
  const pedidoFgts = await api('POST', `/cliente/empresas/${ids.alfa}/solicitacoes`, { setor: 'folha_pagamento', tipo: 'regerar_fgts', competencia: comp, observacao: 'A guia do FGTS venceu.' }, tCli);
  const idPedido = pedidoFgts && (pedidoFgts.id || (pedidoFgts.solicitacao && pedidoFgts.solicitacao.id) || (pedidoFgts.tarefa && pedidoFgts.tarefa.id));
  if (idPedido) {
    const f = new FormData();
    f.append('arquivo', new Blob([pdfTexto(['GUIA DO FGTS', 'Documento de exemplo'])], { type: 'application/pdf' }), 'Guia FGTS atualizada.pdf');
    f.append('resposta', 'Segue a guia atualizada, com vencimento para sexta-feira.');
    await api('POST', `/tarefas-setor/folha_pagamento/${idPedido}/concluir-pedido`, f, usuarios.supervisor_folha_pagamento.token).catch((e) => console.log('   (pedido respondido não criado:', e.message, ')'));
  }

  passo('Tarefas, guias e e-mails');
  for (const [setor, c, descricao, u, prazo] of [['fiscal', 'alfa', 'Apurar ICMS-ST das notas de entrada', 'supervisor_fiscal', 3], ['fiscal', 'gama', 'Conferir notas canceladas do mês', 'supervisor_fiscal', -2],
    ['fiscal', 'delta', 'Enviar SPED Fiscal', 'supervisor_fiscal', 6], ['contabilidade', 'beta', 'Fechar balancete trimestral', 'supervisor_contabilidade', 5]]) {
    await api('POST', `/tarefas-setor/${setor}`, { empresa_id: ids[c], descricao, responsavel_email: usuarios[u].email, responsavel_nome: usuarios[u].nome, prazo: `${dia(prazo)}T17:00:00` });
  }
  const venc = new Date(mesPassado.getFullYear(), mesPassado.getMonth() + 1, 20).toLocaleDateString('pt-BR');
  const guia = (c, cnpj, razao, valor, n) => new Blob([pdfDas({ cnpj, razao, mes: `${MESES[mesPassado.getMonth()]}/${mesPassado.getFullYear()}`, venc, valor, numero: `07.20.${n}` })], { type: 'application/pdf' });
  const loteEnviado = (await api('POST', '/guias/lotes')).lote_id;
  const fg = new FormData();
  fg.append('arquivos', guia('alfa', '70.783.653/0001-70', 'ALFA COMERCIO DE ALIMENTOS LTDA', '1.234,56', '26289.1111111-1'), `DAS Alfa ${comp}.pdf`);
  fg.append('arquivos', guia('padaria', '33.271.905/0001-48', 'PADARIA PAO DOURADO LTDA', '845,10', '26289.2222222-2'), `DAS Padaria ${comp}.pdf`);
  fg.append('arquivos', guia('gama', '29.553.761/0001-02', 'GAMA TRANSPORTES LTDA', '2.310,00', '26289.3333333-3'), `DAS Gama ${comp}.pdf`);
  await api('POST', `/guias/lotes/${loteEnviado}/arquivos`, fg);
  const itens = (await api('GET', `/guias/lotes/${loteEnviado}`)).filter((i) => i.empresa_id);
  await api('POST', `/guias/lotes/${loteEnviado}/confirmar`, { itens: itens.map((i) => ({ id: i.id })), enviar_email: true });
  await esperar(itens.length * 1500 + 2500);
  const { rows: emails } = await db.query(`SELECT e.token, d.documento_id FROM emails_enviados e JOIN emails_enviados_documentos d ON d.email_id = e.id ORDER BY e.enviado_em`);
  for (const [i, m] of emails.entries()) {
    if (i % 3 !== 2) await fetch(`${API}/rastreio/${m.token}/a.gif`).catch(() => {});
    if (i % 2 === 0) await fetch(`${API}/rastreio/${m.token}/d/${m.documento_id}/arquivo`).catch(() => {});
  }
  await db.query(`UPDATE emails_enviados SET status = 'enviado' WHERE status = 'simulado'`);
  // Lote para a tela de conferência: uma guia nova, uma repetida (mesmo mês) e uma sem empresa
  // (lote da pessoa do Fiscal: é ela que aparece no print da conferência)
  const tFiscal = usuarios.supervisor_fiscal.token;
  const loteConf = (await api('POST', '/guias/lotes', null, tFiscal)).lote_id;
  const fc = new FormData();
  fc.append('arquivos', guia('delta', '41.880.236/0001-91', 'DELTA TECNOLOGIA LTDA', '612,40', '26289.4444444-4'), `DAS Delta ${comp}.pdf`);
  fc.append('arquivos', guia('alfa', '70.783.653/0001-70', 'ALFA COMERCIO DE ALIMENTOS LTDA', '1.240,02', '26290.5555555-5'), `DAS Alfa ${comp} (2a via).pdf`);
  fc.append('arquivos', guia('x', '76.202.032/0001-31', 'EMPRESA QUE NAO E CLIENTE LTDA', '99,90', '26289.9999999-9'), 'DAS outra empresa.pdf');
  await api('POST', `/guias/lotes/${loteConf}/arquivos`, fc, tFiscal);

  // Caixa Postal (SERPRO desligado: resultado de exemplo)
  const msgs = [
    { isn: '1', assunto: 'IMPORTANTE: Expiração de Procuração Eletrônica', enviada_em: dia(0), ciencia_em: dia(15), relevante: true, origem: 'RECEITA FEDERAL DO BRASIL', anexos: false },
    { isn: '2', assunto: 'Termo de Intimação Fiscal - Malha PJ', enviada_em: dia(-3), ciencia_em: dia(12), relevante: true, origem: 'RECEITA FEDERAL DO BRASIL', anexos: true },
    { isn: '3', assunto: 'Aviso de débito do Simples Nacional', enviada_em: dia(-9), ciencia_em: dia(6), relevante: false, origem: 'RECEITA FEDERAL DO BRASIL', anexos: false }
  ];
  await db.query(`INSERT INTO caixa_postal (empresa_id, indicador, nao_lidas, mensagens, verificado_por) VALUES ($1,2,3,$2,$3)`, [ids.alfa, JSON.stringify(msgs), usuarios.supervisor_fiscal.id]);
  for (const c of ['beta', 'padaria']) await db.query(`INSERT INTO caixa_postal (empresa_id, indicador, nao_lidas, mensagens, verificado_por) VALUES ($1,0,0,'[]',$2)`, [ids[c], usuarios.supervisor_fiscal.id]);

  // Planejamento tributário (o Domínio fica desligado: grava direto análises de exemplo)
  const fimPt = comp;
  for (const [c, nome, receita, atual, melhor, total, status, questionario] of [
    ['alfa', 'Alfa Comércio de Alimentos Ltda', 3200000, 0.0905, 'Lucro Presumido', 266000, 'rascunho', true],
    ['gama', 'Gama Transportes Ltda', 1850000, 0.0812, 'Lucro Presumido', 138000, 'aprovado', false],
    ['padaria', 'Padaria Pão Dourado Ltda', 920000, 0.0642, 'Simples Nacional (atual)', 59000, 'enviado', true],
    ['delta', 'Delta Tecnologia Ltda', 640000, 0.0975, 'Simples Nacional (atual)', 62400, 'rascunho', false]]) {
    const cnpj = EMPRESAS.find((e) => e[0] === c)[3].replace(/\D/g, '');
    const economia = melhor.startsWith('Simples') ? 0 : Math.round(receita * atual - total);
    const resultado = { base_anual: { rbt12: receita }, regimes_2026: [{ carga_sobre_receita: atual }], alertas: [] };
    await db.query(`INSERT INTO pt_analises (cnpj, empresa_id, nome, periodo_fim, origem, status, resultado, respostas, regime_atual_total, melhor_regime, economia, gerado_por, aprovado_em, enviado_em)
      VALUES ($1,$2,$3,$4,'manual',$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [cnpj, ids[c], nome, fimPt, status, JSON.stringify(resultado), questionario ? '{}' : null, Math.round(receita * atual), melhor, economia, usuarios.supervisor_contabilidade.id,
      status !== 'rascunho' ? dia(-3) : null, status === 'enviado' ? dia(-2) : null]);
    if (questionario) await db.query(`INSERT INTO pt_questionarios (token, cnpj, empresa_id, nome_empresa, criado_por, expira_em, respondido_em, respostas) VALUES ($1,$2,$3,$4,$5,$6,$7,'{}')`,
      [crypto.randomBytes(24).toString('hex'), cnpj, ids[c], nome, usuarios.supervisor_contabilidade.id, dia(20), dia(-4)]);
  }

  return { usuarios, ids, tCli, loteConf, linkConvite: convite && convite.link, acesso };
}

// ------------------------------------------------------------------ navegador
async function abrirEdge(perfil) {
  const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORTA_EDGE}`, `--user-data-dir=${perfil}`, '--lang=pt-BR', 'about:blank'], { stdio: 'ignore' });
  let alvos = null;
  for (let i = 0; i < 50 && !alvos; i++) { await esperar(300); try { alvos = await (await fetch(`http://127.0.0.1:${PORTA_EDGE}/json`)).json(); } catch (e) { /* abrindo */ } }
  const ws = new WebSocket(alvos.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let seq = 0; const pend = {}; const erros = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; }
    if (m.method === 'Runtime.exceptionThrown') erros.push(m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description);
  });
  const cdp = (method, params = {}) => new Promise((r) => { const id = ++seq; pend[id] = r; ws.send(JSON.stringify({ id, method, params })); });
  await cdp('Page.enable'); await cdp('Runtime.enable');
  const js = async (e) => (await cdp('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result.result.value;
  return {
    edge, ws, erros, cdp, js,
    tamanho: (w, h, mobile = false) => cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile }),
    ir: async (url, ms = 2500) => { await cdp('Page.navigate', { url: BASE + url }); await esperar(ms); },
    foto: async (arquivo) => {
      const s = await cdp('Page.captureScreenshot', { format: 'png' });
      fs.mkdirSync(path.dirname(arquivo), { recursive: true });
      fs.writeFileSync(arquivo, Buffer.from(s.result.data, 'base64'));
    }
  };
}

// ------------------------------------------------------------------ prints
async function fotografar(nav, dados) {
  const { usuarios, ids, tCli, loteConf, linkConvite } = dados;
  const E = (n) => path.join(SAIDA, 'equipe', n);
  const C = (n) => path.join(SAIDA, 'cliente', n);
  const feitos = [];
  async function print(arquivo, preparar) {
    nav.erros.length = 0;
    try {
      await preparar();
      await nav.foto(arquivo);
      feitos.push(path.basename(arquivo));
      console.log(`   ${path.basename(arquivo)}${nav.erros.length ? '  (aviso de JS: ' + String(nav.erros[0]).slice(0, 100) + ')' : ''}`);
    } catch (err) {
      console.log(`   ✖ ${path.basename(arquivo)}: ${err.message}`);
    }
  }
  const entrarEquipe = async (u = usuarios.administrador) => {
    await nav.ir('/pages/login.html', 800);
    await nav.js(`localStorage.clear(); localStorage.setItem('token', ${JSON.stringify(u.token)}); localStorage.setItem('usuario', ${JSON.stringify(JSON.stringify({ id: u.id, nome: u.nome, email: u.email, role: u.role }))}); localStorage.setItem('tema','light'); true`);
  };

  passo('Fotografando as telas da equipe');
  await nav.tamanho(1366, 860);
  await print(E('e-login.png'), async () => { await nav.ir('/pages/login.html', 600); await nav.js(`localStorage.clear(); localStorage.setItem('tema','light'); true`); await nav.ir('/pages/login.html', 1500); });
  await entrarEquipe();
  await print(E('e-dashboard.png'), () => nav.ir('/pages/dashboard.html', 3500));
  await print(E('e-empresas-lista.png'), () => nav.ir('/pages/empresas.html', 2500));
  await print(E('e-empresas-menu.png'), async () => { await nav.ir('/pages/empresas.html', 2500); await nav.js(`document.querySelector('.btn-dropdown-acoes').click(); true`); await esperar(500); });
  await print(E('e-empresa-nova.png'), async () => { await nav.ir('/pages/empresas.html', 2500); await nav.js(`document.getElementById('btn-nova-empresa').click(); true`); await esperar(800); });
  await print(E('e-empresa-ficha.png'), () => nav.ir(`/pages/empresa.html?id=${ids.alfa}`, 3500));
  await print(E('e-empresa-documentos.png'), () => nav.ir(`/pages/empresas.html?abrir=documentos&id=${ids.alfa}`, 3000));
  await print(E('e-area-cliente.png'), () => nav.ir(`/pages/empresas.html?abrir=portal&id=${ids.alfa}`, 3000));
  await print(E('e-cnd-situacao-fiscal.png'), () => nav.ir(`/pages/empresas.html?abrir=cnds&id=${ids.alfa}`, 3000));
  await print(E('e-legalizacao-quadro.png'), () => nav.ir('/pages/processos.html', 3500));
  await print(E('e-legalizacao-etapas.png'), async () => {
    await nav.ir('/pages/processos.html', 3000);
    const id = await nav.js(`fetch('/api/processos-legalizacao?limite=20',{headers:{Authorization:'Bearer '+localStorage.getItem('token')}}).then(r=>r.json()).then(j=>(j.dados||[])[0].id)`);
    await nav.js(`abrirModalEtapas(${JSON.stringify(id)}); true`); await esperar(1500);
  });
  await print(E('e-certidoes.png'), () => nav.ir('/pages/certidoes.html', 3000));
  await entrarEquipe(usuarios.supervisor_fiscal);
  await print(E('e-tarefas.png'), () => nav.ir('/pages/fiscal.html', 3000));
  await print(E('e-concluir-pedido.png'), async () => { await nav.ir('/pages/fiscal.html', 3000); await nav.js(`document.querySelector('[data-concluir-pedido]').click(); true`); await esperar(800); });
  await print(E('e-importar-guias.png'), () => nav.ir('/pages/importar-guias.html', 2500));
  await print(E('e-importar-receita.png'), async () => {
    await nav.ir('/pages/importar-guias.html', 2500);
    await nav.js(`const t=document.getElementById('receita-todas'); if(t){t.click();} document.getElementById('painel-receita').scrollIntoView({block:'start'}); true`); await esperar(600);
  });
  await print(E('e-importar-conferencia.png'), async () => {
    await nav.ir('/pages/importar-guias.html', 2000);
    await nav.js(`loteId=${JSON.stringify(loteConf)}; carregarConferencia().then(()=>{ filtroAtual='todas'; renderizarConferencia(); return true; })`); await esperar(1200);
  });
  await print(E('e-emails-enviados.png'), () => nav.ir('/pages/emails-enviados.html', 3000));
  await print(E('e-caixa-postal.png'), async () => { await nav.ir('/pages/caixa-postal.html', 2500); await nav.js(`const b=document.querySelector('[data-expandir]'); if(b) b.click(); true`); await esperar(600); });
  await print(E('e-caixa-postal-abrir.png'), async () => { await nav.js(`document.querySelector('[data-abrir]').click(); true`); await esperar(700); });
  await print(E('e-assistente.png'), async () => {
    await nav.tamanho(1366, 1180); // tela mais alta: cabe a pergunta e a resposta inteira
    await nav.ir('/pages/fiscal.html', 2500);
    // Só neste print: painel mais alto, para caber a pergunta e a resposta inteira
    await nav.js(`sessionStorage.clear(); const st=document.createElement('style'); st.textContent='.assist-painel{height:1000px!important;max-height:none!important}'; document.head.appendChild(st); document.querySelector('.assist-botao').click(); true`); await esperar(500);
    await nav.js(`const c=document.querySelector('.assist-form textarea'); c.value='Como mando as guias para os clientes?'; document.querySelector('.assist-form').dispatchEvent(new Event('submit',{cancelable:true})); true`);
    // Espera a resposta chegar e mostra a pergunta e o começo da resposta (não o fim da conversa)
    for (let i = 0; i < 30 && !(await nav.js(`!!document.querySelector('.assist-msg.assistente .assist-modo')`)); i++) await esperar(300);
    await esperar(800);
    await nav.js(`const m=document.querySelector('.assist-msg.usuario'); const c=document.querySelector('.assist-msgs'); c.scrollTop = m.getBoundingClientRect().top - c.getBoundingClientRect().top + c.scrollTop - 10; true`);
    await esperar(400);
  });
  await nav.tamanho(1366, 860);
  await entrarEquipe(usuarios.supervisor_contabilidade);
  await print(E('e-conferencia.png'), () => nav.ir('/pages/conferencia-bancaria.html', 3500));
  await print(E('e-planejamento.png'), () => nav.ir('/pages/planejamento.html', 3000));
  await entrarEquipe();
  await print(E('e-usuarios.png'), () => nav.ir('/pages/usuarios.html', 2500));
  await print(E('e-permissoes.png'), async () => {
    await nav.ir('/pages/usuarios.html', 2500);
    // Uma mudança marcada (sem salvar), para aparecer o destaque e o botão "Salvar permissões (1)"
    await nav.js(`document.querySelector('input[data-perm="certidoes.editar"][data-papel="supervisor_fiscal"]').click(); const p = document.getElementById('painel-permissoes'); window.scrollTo(0, p.getBoundingClientRect().top + window.scrollY - 80); true`);
    await esperar(500);
  });
  // Memória do assistente: uma resposta ensinada (vira pergunta frequente no manual)
  await nav.ir('/pages/ajuda.html', 1500);
  await nav.js(`fetch('/api/ajuda/memoria',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+localStorage.getItem('token')},
    body:JSON.stringify({publico:'equipe',pergunta:'Como troco o e-mail que recebe as guias?',resposta:'1. Abra **Empresas** e clique na empresa.\\n2. Em **Editar**, troque o **E-mail**.\\n3. Clique em **Salvar**.',secoes:['empresas']})}).then(r=>r.status)`);
  await print(E('e-ajuda-manual.png'), () => nav.ir('/pages/ajuda.html', 2500));
  await print(E('e-conectar-claude.png'), async () => {
    await nav.ir('/pages/ajuda.html?aba=conectar', 2500);
    await nav.js(`document.getElementById('chave-nome').value = 'Claude do meu computador'; document.getElementById('form-chave').requestSubmit(); true`);
    await esperar(1500);
    // A chave (de um banco temporário) não aparece na imagem: troca por pontinhos
    await nav.js(`document.querySelectorAll('.aj-chave-nova code').forEach((c) => { c.textContent = c.textContent.replace(/sp_[A-Za-z0-9_-]+/g, 'sp_••••••••••••••••'); }); true`);
  });
  await print(E('e-ajuda-ensinar.png'), async () => {
    await nav.ir('/pages/ajuda.html', 2000);
    await nav.js(`document.querySelector('[data-aba=memoria]').click(); true`); await esperar(1200);
    await nav.js(`document.getElementById('btn-ensinar').click(); true`); await esperar(800);
    await nav.js(`document.getElementById('ens-pergunta').value='Onde vejo as guias que ainda não foram pagas?'; document.getElementById('ens-resposta').value='1. Abra **E-mails enviados**.\\n2. Veja quem ainda não baixou a guia.'; true`);
  });

  passo('Fotografando a Área do Cliente');
  await nav.tamanho(1280, 820);
  const sairCliente = async () => { await nav.ir('/pages/cliente-login.html', 600); await nav.js(`localStorage.clear(); localStorage.setItem('tema','light'); true`); };
  await sairCliente();
  await print(C('c-login.png'), () => nav.ir('/pages/cliente-login.html', 1500));
  await print(C('c-esqueci-senha.png'), async () => { await nav.js(`document.getElementById('btn-esqueci-senha').click(); true`); await esperar(600); });
  if (linkConvite) {
    const token = (/token=([a-f0-9]{48})/.exec(linkConvite) || [])[1];
    if (token) await print(C('c-criar-senha.png'), () => nav.ir(`/pages/cliente-senha.html?token=${token}`, 2000));
  }
  const entrarCliente = async () => {
    await nav.ir('/pages/cliente-login.html', 600);
    await nav.js(`localStorage.clear(); localStorage.setItem('tema','light'); localStorage.setItem('cliente_token', ${JSON.stringify(tCli)}); localStorage.setItem('cliente_empresa', ${JSON.stringify(ids.alfa)}); true`);
  };
  await entrarCliente();
  const aba = (nome) => nav.js(`document.querySelector('[data-aba="${nome}"]').click(); true`);
  await print(C('c-inicio.png'), () => nav.ir('/pages/portal-cliente.html', 3000));
  await print(C('c-documentos.png'), async () => { await nav.ir('/pages/portal-cliente.html', 2500); await aba('documentos'); await esperar(1200); });
  await print(C('c-enviar-documento.png'), async () => {
    await nav.js(`const h=[...document.querySelectorAll('h2,h3')].find(x=>/Enviar documento ao escritório/.test(x.textContent)); if(h) h.scrollIntoView({block:'start'}); true`); await esperar(500);
  });
  await print(C('c-pedidos.png'), async () => { await nav.ir('/pages/portal-cliente.html', 2500); await aba('pedidos'); await esperar(1200); });
  await print(C('c-novo-pedido.png'), async () => {
    await nav.js(`document.getElementById('btn-novo-pedido').click(); true`); await esperar(600);
    await nav.js(`const s=document.getElementById('pedido-setor'); s.value='fiscal'; s.dispatchEvent(new Event('change')); true`); await esperar(300);
    await nav.js(`const t=document.getElementById('pedido-tipo'); t.value='regerar_das'; t.dispatchEvent(new Event('change')); true`); await esperar(400);
  });
  await print(C('c-minha-conta.png'), async () => { await nav.ir('/pages/portal-cliente.html', 2500); await aba('conta'); await esperar(800); });
  await nav.tamanho(390, 844, true);
  await print(C('c-celular.png'), () => nav.ir('/pages/portal-cliente.html', 3000));
  return feitos;
}

// ------------------------------------------------------------------
(async () => {
  console.log('Prints dos manuais — banco e dados FICTÍCIOS, nada do sistema real é usado');
  if (!EDGE) { console.error('Microsoft Edge não encontrado.'); process.exit(1); }
  const temporaria = fs.mkdtempSync(path.join(os.tmpdir(), 'prints-manual-'));
  let db = null; let srv = null; let nav = null;
  try {
    db = await criarBanco();
    passo(`Ligando o sistema na porta ${PORTA} (e-mail, WhatsApp, SERPRO e Domínio desligados)`);
    const bloqueado = 'http://127.0.0.1:9/bloqueado';
    srv = spawn(process.execPath, [path.join(BACKEND, 'src', 'server.js')], {
      cwd: BACKEND, stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, PORT: String(PORTA), APP_URL: `http://localhost:${PORTA}`, NODE_ENV: 'production', DB_NAME: BANCO, UPLOAD_DIR: path.join(temporaria, 'uploads'),
        NOTIF_EMAIL_HOST: '', NOTIF_EMAIL_VIA: '', NOTIF_WHATSAPP_API_URL: '', AZURE_TENANT_ID: '', AZURE_CLIENT_ID: '', AZURE_CLIENT_SECRET: '',
        DOMINIO_DSN: '', DOMINIO_USUARIO: '', DOMINIO_SENHA: '', CB_PASTA_EMPRESAS: temporaria, CB_PLANILHA: path.join(temporaria, 'nao-existe.xlsx'),
        SERPRO_CND_CONSUMER_KEY: '', SERPRO_CND_CONSUMER_SECRET: '',
        SERPRO_INTEGRA_CONSUMER_KEY: 'exemplo', SERPRO_INTEGRA_CONSUMER_SECRET: 'exemplo', SERPRO_INTEGRA_CERT_PATH: path.join(temporaria, 'nao-usado.pfx'), SERPRO_INTEGRA_CERT_SENHA: 'x',
        SERPRO_INTEGRA_AUTH_URL: bloqueado, SERPRO_INTEGRA_URL: bloqueado, SERPRO_TOKEN_URL: bloqueado, SERPRO_CND_URL: bloqueado,
        ANTHROPIC_API_KEY: '', BACKUP_PASTA_COPIA: '',
        // Responsáveis reais da equipe (nomes/e-mails do .env) NÃO podem aparecer nos prints
        EMAIL_AVISOS_GERAIS: '', ONBOARDING_EMAIL_TESTE: '', ONBOARDING_LEGALIZACAO_EMAIL: '', ONBOARDING_CADASTRO_EMAIL: '',
        ONBOARDING_FISCAL_EMAIL: '', ONBOARDING_CONTABIL_EMAIL: '', ONBOARDING_FOLHA_EMAIL: '',
        PORTAL_RESPONSAVEL_FISCAL_EMAIL: 'carla@exemplo.com.br', PORTAL_RESPONSAVEL_CONTABILIDADE_EMAIL: 'diego@exemplo.com.br',
        PORTAL_RESPONSAVEL_FOLHA_PAGAMENTO_EMAIL: 'elisa@exemplo.com.br', PORTAL_RESPONSAVEL_LEGALIZACAO_EMAIL: 'bruno@exemplo.com.br' }
    });
    let erroSrv = ''; srv.stderr.on('data', (d) => { erroSrv += d; });
    for (let i = 0; i < 60; i++) {
      await esperar(500);
      try { if ((await fetch(`${API}/health`)).ok) break; } catch (e) { /* subindo */ }
      if (i === 59) throw new Error(`o sistema não subiu: ${erroSrv.slice(0, 300)}`);
    }
    const dados = await semear(db);
    nav = await abrirEdge(path.join(temporaria, 'edge'));
    const feitos = await fotografar(nav, dados);
    console.log(`\n✔ ${feitos.length} imagens em ${SAIDA}`);
  } catch (err) {
    console.error(`\n✖ ${err.message}`);
    process.exitCode = 1;
  } finally {
    if (nav) { try { nav.ws.close(); } catch (e) { /* já fechado */ } nav.edge.kill(); }
    if (srv) srv.kill();
    await esperar(1500);
    await apagarBanco(db);
    fs.rmSync(temporaria, { recursive: true, force: true });
    console.log('Banco temporário e arquivos de exemplo apagados.');
  }
})();
