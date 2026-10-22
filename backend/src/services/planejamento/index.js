const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { query } = require('../../config/db');
const { extrairEmpresa, empresaPorCnpj, empresasDoSimples, limparCnpj, mesAnterior, CNPJ_VALIDO } = require('./extracao');
const { calcular } = require('./motor');
const { gerarPdf } = require('./parecer');
const { enviarEmail, enviarWhatsapp } = require('../notificacaoService');
const { montarEmail } = require('../emailLayout');
const HistoricoComunicacao = require('../../models/HistoricoComunicacao');
const { urlBaseSistema } = require('../../utils/urlSistema');

/**
 * Planejamento tributário — regras de negócio.
 *
 * Fluxo: analisar (Domínio + questionário → motor) → PDF interno (rascunho)
 *        → aprovar (gera o PDF do cliente) → enviar (e-mail com PDF + WhatsApp).
 * O questionário vai ao cliente por um link individual (token), sem login.
 * Os PDFs ficam em backend/uploads/planejamento/<cnpj>/.
 */

const PASTA_PDFS = path.join(__dirname, '../../../uploads/planejamento');
const PARAMETROS = path.join(__dirname, 'parametros.json');
const DIAS_VALIDADE_QUESTIONARIO = 30;

const lerParametros = () => JSON.parse(fs.readFileSync(PARAMETROS, 'utf8'));
const cnpjFormatado = (c) => c.replace(/^(\w{2})(\w{3})(\w{3})(\w{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

function erroPara(mensagem, status = 400) {
  return Object.assign(new Error(mensagem), { status });
}

function validarCnpj(cnpj) {
  const c = limparCnpj(cnpj);
  if (!CNPJ_VALIDO.test(c)) throw erroPara('CNPJ inválido.');
  return c;
}

/** Empresa do cadastro do sistema (se existir) para o CNPJ. */
async function empresaDoSistema(cnpj) {
  const { rows } = await query(
    `SELECT id, razao_social, email, telefone FROM empresas
      WHERE regexp_replace(upper(cnpj), '[^0-9A-Z]', '', 'g') = $1 LIMIT 1`,
    [cnpj]
  );
  return rows[0] || null;
}

/** Respostas mais recentes do questionário para o CNPJ (ou null). */
async function ultimasRespostas(cnpj) {
  const { rows } = await query(
    `SELECT respostas FROM pt_questionarios WHERE cnpj = $1 AND respondido_em IS NOT NULL
      ORDER BY respondido_em DESC LIMIT 1`,
    [cnpj]
  );
  return rows[0] ? rows[0].respostas : null;
}

/**
 * Faz uma análise e grava em pt_analises. Erros de leitura do Domínio
 * também são gravados (status 'erro'), para o radar mostrar quem falhou.
 */
async function analisar({ cnpj, fim, origem = 'manual', usuarioId = null, respostas }) {
  const c = validarCnpj(cnpj);
  const empresa = await empresaDoSistema(c);
  const resp = respostas !== undefined ? respostas : await ultimasRespostas(c);
  try {
    const dados = await extrairEmpresa(c, fim || mesAnterior());
    const resultado = calcular({ dados, respostas: resp, parametros: lerParametros() });
    const atual = resultado.regimes_2026[0];
    const { rows } = await query(
      `INSERT INTO pt_analises (cnpj, empresa_id, codigo_dominio, nome, periodo_fim, origem, resultado, respostas,
                                regime_atual_total, melhor_regime, economia, gerado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [c, empresa && empresa.id, dados.empresa.codi, dados.empresa.nome, dados.periodo.fim, origem, resultado, resp,
        atual.total, resultado.melhor_2026 && resultado.melhor_2026.regime,
        resultado.melhor_2026 ? resultado.melhor_2026.economia_vs_atual : 0, usuarioId]
    );
    return rows[0];
  } catch (err) {
    if (err.status === 404 || /não encontrado/i.test(err.message)) throw erroPara('CNPJ não encontrado no Domínio.', 404);
    const { rows } = await query(
      `INSERT INTO pt_analises (cnpj, empresa_id, origem, status, erro, gerado_por) VALUES ($1,$2,$3,'erro',$4,$5) RETURNING *`,
      [c, empresa && empresa.id, origem, err.message, usuarioId]
    );
    return rows[0];
  }
}

async function buscarAnalise(id) {
  const { rows } = await query(
    `SELECT a.*, ug.nome AS gerado_por_nome, ua.nome AS aprovado_por_nome, ue.nome AS enviado_por_nome
       FROM pt_analises a
       LEFT JOIN usuarios ug ON ug.id = a.gerado_por
       LEFT JOIN usuarios ua ON ua.id = a.aprovado_por
       LEFT JOIN usuarios ue ON ue.id = a.enviado_por
      WHERE a.id = $1`,
    [id]
  );
  if (!rows.length) throw erroPara('Análise não encontrada.', 404);
  return rows[0];
}

const caminhoPdf = (a, versao) => path.join(PASTA_PDFS, a.cnpj, `${a.id}-${versao}.pdf`);

/** Caminho do PDF (gera na hora se ainda não existir). */
async function pdfDaAnalise(id, versao = 'interno') {
  const a = await buscarAnalise(id);
  if (a.status === 'erro') throw erroPara('Esta análise falhou; faça uma nova análise.');
  if (versao === 'cliente') {
    if (!a.pdf_cliente || !fs.existsSync(a.pdf_cliente)) throw erroPara('O PDF do cliente só existe depois da aprovação.');
    return { caminho: a.pdf_cliente, analise: a };
  }
  if (a.pdf_interno && fs.existsSync(a.pdf_interno)) return { caminho: a.pdf_interno, analise: a };
  const destino = await gerarPdf({ resultado: a.resultado, respostas: a.respostas, versao: 'interno', destino: caminhoPdf(a, 'interno') });
  await query('UPDATE pt_analises SET pdf_interno = $2 WHERE id = $1', [a.id, destino]);
  return { caminho: destino, analise: a };
}

async function aprovar(id, usuario) {
  const a = await buscarAnalise(id);
  if (a.status === 'erro') throw erroPara('Não dá para aprovar uma análise com erro.');
  if (a.status !== 'rascunho') throw erroPara('Esta análise já foi aprovada.');
  const em = new Date();
  const destino = await gerarPdf({
    resultado: a.resultado, respostas: a.respostas, versao: 'cliente', destino: caminhoPdf(a, 'cliente'),
    aprovacao: { por: usuario.nome, em }
  });
  const { rows } = await query(
    `UPDATE pt_analises SET status = 'aprovado', aprovado_por = $2, aprovado_em = $3, pdf_cliente = $4 WHERE id = $1 RETURNING *`,
    [a.id, usuario.id, em, destino]
  );
  return rows[0];
}

/** E-mail/telefone sugeridos para o cliente (cadastro do sistema + último envio). */
async function contatosSugeridos(cnpj) {
  const c = validarCnpj(cnpj);
  const empresa = await empresaDoSistema(c);
  const { rows } = await query(
    `SELECT envio FROM (
       SELECT envio, enviado_em AS quando FROM pt_analises WHERE cnpj = $1 AND envio IS NOT NULL
       UNION ALL SELECT envio, criado_em FROM pt_questionarios WHERE cnpj = $1 AND envio IS NOT NULL
     ) x ORDER BY quando DESC NULLS LAST LIMIT 1`,
    [c]
  );
  const anterior = rows[0] ? rows[0].envio : {};
  return {
    email: anterior.email || (empresa && empresa.email) || '',
    telefone: anterior.telefone || (empresa && empresa.telefone) || ''
  };
}

const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validarContato({ email, telefone }) {
  const e = String(email || '').trim().toLowerCase();
  const t = String(telefone || '').replace(/\D/g, '');
  if (e && !REGEX_EMAIL.test(e)) throw erroPara('E-mail inválido.');
  if (t && (t.length < 10 || t.length > 13)) throw erroPara('WhatsApp inválido (informe DDD + número).');
  if (!e && !t) throw erroPara('Informe o e-mail e/ou o WhatsApp do cliente.');
  return { email: e, telefone: t };
}

/** Manda pelos canais informados; devolve { email: 'enviado'|'simulado'|'falhou: ...', whatsapp: ... }. */
async function despachar({ contato, empresaId, assunto, html, textoWhatsapp, anexos = [], usuarioId }) {
  const status = {};
  const canais = [];
  if (contato.email) canais.push(['email', contato.email, () => enviarEmail({ destinatario: contato.email, assunto, mensagem: textoWhatsapp, html, anexos })]);
  if (contato.telefone) canais.push(['whatsapp', contato.telefone, () => enviarWhatsapp({ destinatario: contato.telefone, mensagem: textoWhatsapp })]);
  for (const [canal, destino, enviar] of canais) {
    let erro = null;
    try {
      const r = await enviar();
      status[canal] = r && r.simulado ? 'simulado' : 'enviado';
    } catch (err) {
      erro = err.message;
      status[canal] = `falhou: ${err.message}`;
    }
    if (empresaId) {
      await HistoricoComunicacao.registrar({
        empresaId, processoId: null, canal, destinatario: destino, assunto: canal === 'email' ? assunto : null,
        mensagem: textoWhatsapp, status: erro ? 'falhou' : 'enviado', erro, enviadoPor: usuarioId
      }).catch((e) => console.error('Falha ao registrar histórico de comunicação:', e.message));
    }
  }
  return status;
}

async function enviarAoCliente(id, contatoInformado, usuario) {
  const a = await buscarAnalise(id);
  if (!['aprovado', 'enviado'].includes(a.status)) throw erroPara('Aprove a análise antes de enviar ao cliente.');
  if (!a.pdf_cliente || !fs.existsSync(a.pdf_cliente)) throw erroPara('PDF do cliente não encontrado; aprove novamente.');
  const contato = validarContato(contatoInformado);
  const r = a.resultado;
  const recomendacao = r.melhor_2026 && r.melhor_2026.regime !== r.regimes_2026[0].regime && r.melhor_2026.economia_vs_atual > Math.max(10000, r.regimes_2026[0].total * 0.05)
    ? `Identificamos uma possível economia de ${brl(r.melhor_2026.economia_vs_atual)} por ano com o ${r.melhor_2026.regime}.`
    : 'O regime atual continua sendo o mais econômico para a sua empresa.';
  const assunto = `Planejamento tributário — ${a.nome}`;
  const { html } = montarEmail({
    titulo: assunto,
    chamada: 'Planejamento tributário',
    saudacao: 'Olá!',
    paragrafos: [
      `Concluímos a análise de regime tributário da ${a.nome} (CNPJ ${cnpjFormatado(a.cnpj)}), com base nos dados contábeis dos últimos 12 meses.`,
      recomendacao,
      'O relatório completo, com o comparativo entre os regimes e a análise da Reforma Tributária de 2027, segue em anexo. Qualquer dúvida, é só falar com a nossa equipe.'
    ],
    avisoAnexo: 'Relatório de planejamento tributário em PDF'
  });
  const textoWhatsapp = `*${assunto}*\n\nOlá! Concluímos a análise de regime tributário da ${a.nome}. ${recomendacao}\n\n` +
    (contato.email ? `Enviamos o relatório completo em PDF para ${contato.email}.` : 'Fale com a nossa equipe para receber o relatório completo.');
  const canais = await despachar({
    contato, empresaId: a.empresa_id, assunto, html, textoWhatsapp, usuarioId: usuario.id,
    anexos: [{ nome: `Planejamento tributario - ${a.nome}.pdf`, caminho: a.pdf_cliente, tipo: 'application/pdf' }]
  });
  const algumOk = Object.values(canais).some((s) => s === 'enviado' || s === 'simulado');
  if (!algumOk) throw erroPara(`Não foi possível enviar: ${Object.values(canais).join(' / ')}`, 502);
  const { rows } = await query(
    `UPDATE pt_analises SET status = 'enviado', enviado_por = $2, enviado_em = NOW(), envio = $3 WHERE id = $1 RETURNING *`,
    [a.id, usuario.id, { ...contato, canais }]
  );
  return rows[0];
}

/** Cria o link do questionário e (opcionalmente) manda ao cliente. */
async function criarQuestionario({ cnpj, contato: contatoInformado, enviar, usuario }) {
  const c = validarCnpj(cnpj);
  const dominio = await empresaPorCnpj(c);
  if (!dominio) throw erroPara('CNPJ não encontrado no Domínio.', 404);
  const empresa = await empresaDoSistema(c);
  const contato = enviar ? validarContato(contatoInformado) : null;
  const token = crypto.randomBytes(24).toString('hex');
  const { rows } = await query(
    `INSERT INTO pt_questionarios (token, cnpj, empresa_id, nome_empresa, criado_por, expira_em)
     VALUES ($1,$2,$3,$4,$5, NOW() + ($6 || ' days')::interval) RETURNING *`,
    [token, c, empresa && empresa.id, dominio.nome, usuario.id, String(DIAS_VALIDADE_QUESTIONARIO)]
  );
  const link = `${urlBaseSistema()}/pages/questionario-planejamento.html?t=${token}`;
  let canais = null;
  if (enviar) {
    const assunto = `Planejamento tributário — ${dominio.nome}`;
    const { html } = montarEmail({
      titulo: assunto,
      chamada: 'Planejamento tributário',
      saudacao: 'Olá!',
      paragrafos: [
        `Queremos encontrar o regime tributário mais econômico para a ${dominio.nome} — hoje e com a Reforma Tributária de 2027.`,
        'Para isso, pedimos que responda a um questionário rápido (cerca de 5 minutos) sobre a empresa e os planos para os próximos meses.'
      ],
      botao: { texto: 'Responder o questionário', url: link },
      observacao: `O link é individual e vale por ${DIAS_VALIDADE_QUESTIONARIO} dias.`
    });
    const textoWhatsapp = `*${assunto}*\n\nOlá! Queremos encontrar o regime tributário mais econômico para a ${dominio.nome}. ` +
      `Responda o questionário rápido (cerca de 5 minutos) neste link:\n${link}`;
    canais = await despachar({ contato, empresaId: empresa && empresa.id, assunto, html, textoWhatsapp, usuarioId: usuario.id });
    await query('UPDATE pt_questionarios SET envio = $2 WHERE id = $1', [rows[0].id, { ...contato, canais }]);
  }
  return { ...rows[0], link, canais };
}

/** Questionário pelo token (rota pública): só o necessário para a página. */
async function questionarioPublico(token) {
  if (!/^[0-9a-f]{48}$/.test(String(token || ''))) throw erroPara('Link inválido.', 404);
  const { rows } = await query('SELECT * FROM pt_questionarios WHERE token = $1', [token]);
  const q = rows[0];
  if (!q) throw erroPara('Link inválido.', 404);
  if (new Date(q.expira_em) < new Date()) throw erroPara('Este link expirou. Peça um novo ao escritório.', 410);
  return q;
}

// Opções válidas do questionário (iguais às da página)
const OPCOES = {
  publico: ['Principalmente para outras empresas (CNPJ)', 'Principalmente para consumidor final (CPF)', 'Metade/metade'],
  regime_clientes: ['Lucro Presumido / Lucro Real (empresas médias e grandes)', 'Simples Nacional / MEI', 'Não sei', 'Não vendo para empresas'],
  mercado: ['Não, só no meu estado', 'Vendo para outros estados', 'Exporto', 'Outros estados e exporto'],
  crescimento: ['Deve diminuir', 'Estável', 'Crescer até 30%', 'Crescer mais de 30%'],
  fornecedores: ['Grandes empresas / indústrias (Presumido ou Real)', 'Pequenas empresas (Simples/MEI)', 'Misturado', 'Quase não tenho compras (só serviços)'],
  folha_planos: ['Não', 'Sim, contratar', 'Sim, reduzir equipe', 'Sim, alterar pró-labore'],
  socio_outra_empresa: ['Não', 'Sim, com mais de 10%', 'Sim, com até 10%', 'Sim, é sócio administrador de outra']
};

function validarRespostas(b) {
  const texto = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
  const erros = [];
  const nome = texto(b.nome, 120); if (nome.length < 2) erros.push('nome');
  const email = texto(b.email, 160).toLowerCase(); if (!REGEX_EMAIL.test(email)) erros.push('e-mail');
  const r = {};
  for (const [k, lista] of Object.entries(OPCOES)) { r[k] = texto(b[k], 100); if (!lista.includes(r[k])) erros.push(k); }
  const faturamento = Number(b.faturamento_previsto);
  if (!(faturamento > 0 && faturamento < 1e11)) erros.push('faturamento');
  const margem = Number(b.margem_estimada_pct);
  if (!(margem >= 0 && margem <= 100) || b.margem_estimada_pct === '' || b.margem_estimada_pct == null) erros.push('margem');
  if (erros.length) throw erroPara(`Confira os campos: ${erros.join(', ')}.`);
  return {
    nome, email, ...r, faturamento_previsto: faturamento, margem_estimada_pct: margem,
    investimentos: texto(b.investimentos, 2000), observacoes: texto(b.observacoes, 2000)
  };
}

/** Grava as respostas e dispara a análise em segundo plano. */
async function responderQuestionario(token, corpo) {
  const q = await questionarioPublico(token);
  if (String(corpo.site || '').trim()) throw erroPara('Envio recusado.');
  const respostas = { ...validarRespostas(corpo), cnpj: q.cnpj, recebido_em: new Date().toISOString() };
  await query('UPDATE pt_questionarios SET respostas = $2, respondido_em = NOW() WHERE id = $1', [q.id, respostas]);
  analisar({ cnpj: q.cnpj, origem: 'questionario', respostas })
    .then((a) => query('UPDATE pt_questionarios SET analise_id = $2 WHERE id = $1', [q.id, a.id]))
    .catch((err) => console.error('[planejamento] análise após questionário falhou:', err.message));
  return { ok: true };
}

// ---------- Radar da carteira (todas as empresas do Simples, em segundo plano) ----------
const radar = { emAndamento: false, total: 0, feitos: 0, erros: 0, inicio: null, fim: null, atual: null, ultimoErro: null };

function statusRadar() {
  return { ...radar };
}

async function iniciarRadar({ usuarioId, fim }) {
  if (radar.emAndamento) return statusRadar();
  const empresas = await empresasDoSimples();
  Object.assign(radar, { emAndamento: true, total: empresas.length, feitos: 0, erros: 0, inicio: new Date(), fim: null, atual: null, ultimoErro: null });
  (async () => {
    for (const e of empresas) {
      radar.atual = e.nome;
      try {
        const a = await analisar({ cnpj: e.cnpj, fim, origem: 'radar', usuarioId });
        if (a.status === 'erro') { radar.erros += 1; radar.ultimoErro = `${e.nome}: ${a.erro}`; }
      } catch (err) {
        radar.erros += 1;
        radar.ultimoErro = `${e.nome}: ${err.message}`;
      }
      radar.feitos += 1;
    }
    Object.assign(radar, { emAndamento: false, fim: new Date(), atual: null });
  })();
  return statusRadar();
}

module.exports = {
  analisar, buscarAnalise, pdfDaAnalise, aprovar, enviarAoCliente, contatosSugeridos,
  criarQuestionario, questionarioPublico, responderQuestionario, validarRespostas,
  iniciarRadar, statusRadar, validarCnpj, cnpjFormatado
};
