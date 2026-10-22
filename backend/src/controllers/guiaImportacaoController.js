const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { query } = require('../config/db');
const { Documento } = require('../models/Documento');
const LogAuditoria = require('../models/LogAuditoria');
const { lerGuia, soDigitos } = require('../services/leitorGuias');
const { enviarParaTodos } = require('../services/rastreioEmail');
const { montarEmail } = require('../services/emailLayout');
const { emailsDaEmpresa } = require('../services/emailsCliente');
const { urlBaseSistema } = require('../utils/urlSistema');
const integra = require('../services/integraContadorService');
const { gerarDas } = require('../services/dasReceitaService');
const { UPLOAD_DIR } = require('../middlewares/upload');
const { AppError } = require('../middlewares/errorHandler');

/**
 * Importação de guias em lote:
 *  1. POST /lotes                 → abre um lote
 *  2. POST /lotes/:id/arquivos    → envia até 25 PDFs por vez; cada um é lido
 *     (CNPJ, competência, vencimento, valor) e ligado à empresa pelo CNPJ
 *  3. GET  /lotes/:id             → tabela de conferência
 *  4. POST /lotes/:id/confirmar   → os itens escolhidos viram documentos da
 *     empresa (categoria "guia", visíveis ao cliente) e o cliente recebe por e-mail
 *  5. DELETE /lotes/:id           → desiste: apaga os arquivos pendentes
 */

const ROTULO_TIPO = { DAS: 'DAS', DARF: 'DARF', FGTS: 'FGTS', Estadual: 'Guia estadual', Municipal: 'Guia municipal', Guia: 'Guia' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Datas do banco chegam como Date (colunas DATE) ou texto AAAA-MM-DD
const dataBR = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(`${String(v).slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('pt-BR');
};
const competenciaBR = (c) => (c ? `${c.slice(5, 7)}/${c.slice(0, 4)}` : null);
const reais = (v) => (v === null || v === undefined ? null : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));

/** Descrição curta da guia: "DAS 08/2026 · vence 21/09/2026 · R$ 534,94". */
function descreverGuia(item) {
  return [
    `${ROTULO_TIPO[item.tipo_guia] || 'Guia'}${item.competencia ? ' ' + competenciaBR(item.competencia) : ''}`,
    item.vencimento && `vence ${dataBR(item.vencimento)}`,
    item.valor !== null && item.valor !== undefined && reais(item.valor)
  ].filter(Boolean).join(' · ');
}

async function apagarArquivo(nome) {
  await fs.promises.unlink(path.join(UPLOAD_DIR, nome)).catch(() => {});
}

async function loteDoUsuarioOuFalhar(loteId, usuario) {
  if (!UUID.test(loteId)) throw new AppError('Lote não encontrado.', 404);
  const { rows } = await query('SELECT DISTINCT usuario_id FROM guias_importacao WHERE lote_id = $1', [loteId]);
  if (rows.length && usuario.role !== 'administrador' && !rows.some((r) => r.usuario_id === usuario.id)) {
    throw new AppError('Este lote é de outra pessoa.', 403);
  }
}

/** Empresa pelo CNPJ completo; se não houver, pela raiz (8 primeiros dígitos) quando for única. */
async function acharEmpresa(cnpjLido) {
  if (!cnpjLido) return null;
  const { rows } = await query(
    `SELECT id, razao_social, cnpj, situacao FROM empresas
     WHERE regexp_replace(cnpj, '\\D', '', 'g') = $1
        OR LEFT(regexp_replace(cnpj, '\\D', '', 'g'), 8) = $2`,
    [cnpjLido, cnpjLido.slice(0, 8)]
  );
  const exata = rows.find((e) => soDigitos(e.cnpj) === cnpjLido);
  if (exata) return exata;
  return rows.length === 1 ? rows[0] : null;
}

async function listarItens(loteId) {
  const { rows } = await query(
    `SELECT g.*, e.razao_social AS empresa_nome, e.cnpj AS empresa_cnpj, e.situacao AS empresa_situacao, e.email AS empresa_email,
            EXISTS (SELECT 1 FROM guias_importacao o
                    WHERE o.status = 'importado' AND o.numero_documento IS NOT NULL
                      AND o.numero_documento = g.numero_documento AND o.id <> g.id) AS duplicado,
            -- Mesma empresa, mesmo tipo e mesmo mês já importados há pouco (ex: DAS gerado de novo na
            -- Receita, que sai com número diferente). Pode ser 2ª via de propósito: só vem desmarcada.
            (SELECT to_char(MAX(o.importado_em), 'YYYY-MM-DD') FROM guias_importacao o
              WHERE o.status = 'importado' AND o.id <> g.id AND g.empresa_id IS NOT NULL AND g.competencia IS NOT NULL
                AND o.empresa_id = g.empresa_id AND o.competencia = g.competencia
                AND COALESCE(o.tipo_guia, '') = COALESCE(g.tipo_guia, '')
                AND o.importado_em > NOW() - INTERVAL '60 days') AS mesmo_mes_importado_em,
            (SELECT COUNT(*)::int FROM clientes_portal_empresas ce JOIN clientes_portal c ON c.id = ce.cliente_id
              WHERE ce.empresa_id = g.empresa_id AND c.ativo) AS acessos_cliente
     FROM guias_importacao g
     LEFT JOIN empresas e ON e.id = g.empresa_id
     WHERE g.lote_id = $1 AND g.status <> 'descartado'
     ORDER BY g.empresa_id IS NULL DESC, e.razao_social, g.nome_original`,
    [loteId]
  );
  return rows;
}

async function criarLote(req, res) {
  res.status(201).json({ lote_id: crypto.randomUUID() });
}

async function enviarArquivos(req, res, next) {
  const arquivos = req.files || [];
  try {
    await loteDoUsuarioOuFalhar(req.params.loteId, req.usuario);
    if (!arquivos.length) throw new AppError('Nenhum arquivo enviado.', 400);

    const recusados = [];
    for (const arquivo of arquivos) {
      const buffer = fs.readFileSync(arquivo.path);
      if (!buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
        fs.unlink(arquivo.path, () => {});
        recusados.push(arquivo.originalname);
        continue;
      }
      const lido = await lerGuia(buffer);
      const empresa = lido.cnpj ? await acharEmpresa(lido.cnpj) : null;
      await query(
        `INSERT INTO guias_importacao
          (lote_id, usuario_id, nome_original, nome_armazenado, tamanho_bytes, tipo_guia, cnpj_lido, razao_social_lida,
           empresa_id, competencia, vencimento, pagar_ate, valor, numero_documento, erro_leitura)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [req.params.loteId, req.usuario.id, arquivo.originalname, arquivo.filename, arquivo.size,
          lido.tipo || null, lido.cnpj || null, lido.razao_social || null, empresa ? empresa.id : null,
          lido.competencia || null, lido.vencimento || null, lido.pagar_ate || null, lido.valor ?? null,
          lido.numero_documento || null, lido.erro || null]
      );
    }
    res.status(201).json({ recebidos: arquivos.length - recusados.length, recusados });
  } catch (err) {
    arquivos.forEach((a) => fs.unlink(a.path, () => {}));
    next(err);
  }
}

async function verLote(req, res, next) {
  try {
    await loteDoUsuarioOuFalhar(req.params.loteId, req.usuario);
    res.json(await listarItens(req.params.loteId));
  } catch (err) {
    next(err);
  }
}

/** Assunto do e-mail das guias de uma empresa. */
function assuntoEmailGuias(empresa, itens) {
  return itens.length === 1
    ? `${descreverGuia(itens[0]).split(' · ')[0]} — ${empresa.razao_social}`
    : `Guias para pagamento — ${empresa.razao_social}`;
}

/**
 * E-mail das guias no layout do escritório (uma linha em destaque por guia,
 * cada uma com o seu "Baixar PDF" que registra o download).
 */
function montarEmailGuias(empresa, itens, { pixel, linkDocumento }) {
  const uma = itens.length === 1;
  const nomeGuia = (i) => ROTULO_TIPO[i.tipo_guia] || 'Guia';
  const soma = itens.every((i) => i.valor !== null && i.valor !== undefined)
    ? reais(itens.reduce((t, i) => t + Number(i.valor), 0)) : null;
  const urlPortal = `${urlBaseSistema()}/pages/cliente-login.html`;
  const conteudo = montarEmail({
    chamada: uma ? 'Guia para pagamento' : 'Guias para pagamento',
    titulo: uma ? `Sua guia ${nomeGuia(itens[0])} chegou` : `Suas ${itens.length} guias chegaram`,
    // Prévia na caixa de entrada: "DAS 08/2026 · vence 21/09/2026 · R$ 534,94"
    resumo: uma ? descreverGuia(itens[0]) : `${itens.length} guias da ${empresa.razao_social}${soma ? ` · total ${soma}` : ''}`,
    saudacao: 'Olá!',
    paragrafos: [
      `${uma ? 'A guia' : 'As guias'} da empresa ${empresa.razao_social} (CNPJ ${empresa.cnpj}) ` +
      `${uma ? 'já está disponível' : 'já estão disponíveis'} para pagamento. Confira ${uma ? 'o resumo' : 'os detalhes'} abaixo:`
    ],
    itens: itens.map((i) => ({
      etiqueta: nomeGuia(i),
      rotulo: i.competencia ? `Competência ${competenciaBR(i.competencia)}` : nomeGuia(i),
      detalhe: [
        i.vencimento && `Vencimento: ${dataBR(i.vencimento)}`,
        i.pagar_ate && dataBR(i.pagar_ate) !== dataBR(i.vencimento) && `pagar até ${dataBR(i.pagar_ate)}`
      ].filter(Boolean).join(' · ') || null,
      valor: i.valor !== null && i.valor !== undefined ? reais(i.valor) : null,
      link: uma ? null : linkDocumento(i.documento_id)
    })),
    total: soma,
    avisoAnexo: uma ? 'O PDF da guia também está em anexo neste e-mail.' : `Os ${itens.length} PDFs também estão em anexo neste e-mail.`,
    botao: uma ? { texto: 'Baixar a guia', url: linkDocumento(itens[0].documento_id) } : { texto: 'Acessar a Área do Cliente', url: urlPortal },
    linkSecundario: uma ? { texto: 'ou acesse a Área do Cliente', url: urlPortal } : null,
    observacao: 'Todas as guias ficam guardadas na sua Área do Cliente, caso precise de uma 2ª via.',
    pixel
  });
  return { html: conteudo.html, texto: conteudo.texto };
}

/** Por empresa, um e-mail com todas as guias dela anexadas (um para cada destinatário). Roda em segundo plano. */
async function enviarEmailsDasGuias(porEmpresa, usuarioId) {
  for (const { empresa, itens } of porEmpresa) {
    const destinatarios = await emailsDaEmpresa(empresa.id);
    const ids = itens.map((i) => i.id);
    if (!destinatarios.length) {
      await query(`UPDATE guias_importacao SET email_status = 'sem_email' WHERE id = ANY($1)`, [ids]);
      continue;
    }
    const anexos = itens.map((i) => ({ nome: i.nome_original, caminho: path.join(UPLOAD_DIR, i.nome_armazenado), tipo: 'application/pdf' }));
    // Um e-mail para cada destinatário — assim dá para saber quem abriu e quem baixou
    const status = await enviarParaTodos({
      destinatarios, pausaMs: 1200 /* não disparar tudo de uma vez no servidor de e-mail */, empresaId: empresa.id, assunto: assuntoEmailGuias(empresa, itens), tipo: 'guias',
      documentos: itens.map((i) => ({ id: i.documento_id })), anexos, enviadoPor: usuarioId,
      montar: (links) => montarEmailGuias(empresa, itens, links)
    });
    await query('UPDATE guias_importacao SET email_status = $2 WHERE id = ANY($1)', [ids, status]);
  }
}

async function confirmar(req, res, next) {
  try {
    const loteId = req.params.loteId;
    await loteDoUsuarioOuFalhar(loteId, req.usuario);
    const escolhidos = Array.isArray(req.body.itens) ? req.body.itens : [];
    const enviarPorEmail = req.body.enviar_email !== false;
    const pendentes = (await listarItens(loteId)).filter((i) => i.status === 'pendente');
    const escolhaPorId = new Map(escolhidos.filter((e) => e && UUID.test(e.id)).map((e) => [e.id, e.empresa_id]));

    const porEmpresa = new Map();
    let importadas = 0;
    for (const item of pendentes) {
      if (!escolhaPorId.has(item.id)) continue;
      const empresaId = escolhaPorId.get(item.id) || item.empresa_id;
      if (!empresaId || !UUID.test(empresaId)) continue;
      const { rows: [empresa] } = await query('SELECT id, razao_social, cnpj FROM empresas WHERE id = $1', [empresaId]);
      if (!empresa) continue;

      const documento = await Documento.criar({
        empresa_id: empresa.id,
        nome_original: item.nome_original,
        nome_armazenado: item.nome_armazenado,
        caminho: path.join('uploads', item.nome_armazenado),
        tipo_mime: 'application/pdf',
        tamanho_bytes: item.tamanho_bytes,
        categoria: 'guia',
        descricao: descreverGuia(item).slice(0, 255),
        enviado_por: req.usuario.id,
        visivel_cliente: true
      });
      await query(
        `UPDATE guias_importacao SET status = 'importado', empresa_id = $2, documento_id = $3, importado_em = NOW(),
                email_status = $4 WHERE id = $1`,
        [item.id, empresa.id, documento.id, enviarPorEmail ? 'na_fila' : null]
      );
      importadas++;
      if (!porEmpresa.has(empresa.id)) porEmpresa.set(empresa.id, { empresa, itens: [] });
      porEmpresa.get(empresa.id).itens.push({ ...item, empresa_id: empresa.id, documento_id: documento.id });
    }

    // O que não foi escolhido é descartado (e o arquivo apagado)
    const descartar = pendentes.filter((i) => !escolhaPorId.has(i.id) || !(escolhaPorId.get(i.id) || i.empresa_id));
    for (const item of descartar) {
      await apagarArquivo(item.nome_armazenado);
      await query(`UPDATE guias_importacao SET status = 'descartado' WHERE id = $1`, [item.id]);
    }

    LogAuditoria.registrar({
      usuarioId: req.usuario.id, acao: 'CREATE', entidade: 'documento', entidadeId: null,
      detalhes: { acao_especifica: 'importacao_guias', importadas, empresas: porEmpresa.size, descartadas: descartar.length, email: enviarPorEmail }
    });

    if (enviarPorEmail && porEmpresa.size) {
      enviarEmailsDasGuias([...porEmpresa.values()], req.usuario.id)
        .catch((err) => console.error('[guias] Falha no envio dos e-mails:', err.message));
    }

    res.json({ importadas, empresas: porEmpresa.size, descartadas: descartar.length, emails_em_envio: enviarPorEmail ? porEmpresa.size : 0 });
  } catch (err) {
    next(err);
  }
}

async function descartarLote(req, res, next) {
  try {
    await loteDoUsuarioOuFalhar(req.params.loteId, req.usuario);
    const { rows } = await query(
      `UPDATE guias_importacao SET status = 'descartado' WHERE lote_id = $1 AND status = 'pendente' RETURNING nome_armazenado`,
      [req.params.loteId]
    );
    for (const r of rows) await apagarArquivo(r.nome_armazenado);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

/** Status do envio dos e-mails de um lote já confirmado (a tela consulta). */
async function statusEmails(req, res, next) {
  try {
    await loteDoUsuarioOuFalhar(req.params.loteId, req.usuario);
    const { rows } = await query(
      `SELECT email_status, COUNT(DISTINCT empresa_id)::int AS empresas
       FROM guias_importacao WHERE lote_id = $1 AND status = 'importado' GROUP BY email_status`,
      [req.params.loteId]
    );
    res.json(Object.fromEntries(rows.map((r) => [r.email_status || 'sem_envio', r.empresas])));
  } catch (err) {
    next(err);
  }
}

/**
 * Buscar DAS na Receita (Integra Contador): a guia gerada entra no lote como se
 * tivesse sido enviada em PDF — depois segue a mesma conferência e o mesmo e-mail.
 *   GET  /receita              → se está configurado + empresas do Simples/MEI ativas
 *   POST /lotes/:id/receita    → { empresa_id, periodo: 'AAAA-MM' } — uma empresa por chamada
 *                                (a tela chama uma a uma e mostra o andamento). Cada guia é cobrada.
 */
async function receitaStatus(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT id, razao_social, cnpj, regime_tributario FROM empresas
       WHERE situacao = 'ativa' AND regime_tributario IN ('simples_nacional', 'mei')
       ORDER BY razao_social`
    );
    res.json({ configurado: integra.configurado(), empresas: rows });
  } catch (err) {
    next(err);
  }
}

async function buscarNaReceita(req, res, next) {
  try {
    await loteDoUsuarioOuFalhar(req.params.loteId, req.usuario);
    if (!integra.configurado()) throw new AppError('O Integra Contador não está configurado no .env.', 503);
    const periodo = String(req.body.periodo || '');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo)) throw new AppError('Mês inválido.', 400);
    if (!UUID.test(String(req.body.empresa_id || ''))) throw new AppError('Empresa inválida.', 400);
    const { rows: [empresa] } = await query('SELECT id, razao_social, cnpj, regime_tributario FROM empresas WHERE id = $1', [req.body.empresa_id]);
    if (!empresa) throw new AppError('Empresa não encontrada.', 404);
    const cnpj = soDigitos(empresa.cnpj);

    let pdf;
    try {
      pdf = await gerarDas({ cnpj, regime: empresa.regime_tributario, periodo });
    } catch (err) {
      LogAuditoria.registrar({
        usuarioId: req.usuario.id, acao: 'CREATE', entidade: 'documento', entidadeId: null,
        detalhes: { acao_especifica: 'das_receita', empresa_id: empresa.id, periodo, erro: err.message }
      });
      // Erro de uma empresa não derruba as outras: a tela mostra o motivo na lista
      if (err instanceof integra.ErroIntegra) return res.json({ ok: false, motivo: err.message });
      throw err;
    }

    const nomeArmazenado = `${Date.now()}-${crypto.randomBytes(16).toString('hex')}.pdf`;
    await fs.promises.writeFile(path.join(UPLOAD_DIR, nomeArmazenado), pdf);
    const lido = await lerGuia(pdf);
    await query(
      `INSERT INTO guias_importacao
        (lote_id, usuario_id, nome_original, nome_armazenado, tamanho_bytes, tipo_guia, cnpj_lido, razao_social_lida,
         empresa_id, competencia, vencimento, pagar_ate, valor, numero_documento, erro_leitura)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [req.params.loteId, req.usuario.id, `DAS ${cnpj} ${periodo}.pdf`, nomeArmazenado, pdf.length,
        lido.tipo || 'DAS', lido.cnpj || cnpj, lido.razao_social || empresa.razao_social, empresa.id,
        lido.competencia || periodo, lido.vencimento || null, lido.pagar_ate || null, lido.valor ?? null,
        lido.numero_documento || null, lido.erro || null]
    );
    LogAuditoria.registrar({
      usuarioId: req.usuario.id, acao: 'CREATE', entidade: 'documento', entidadeId: null,
      detalhes: { acao_especifica: 'das_receita', empresa_id: empresa.id, periodo, valor: lido.valor ?? null }
    });
    res.json({ ok: true, valor: lido.valor ?? null, vencimento: lido.vencimento || null });
  } catch (err) {
    next(err);
  }
}

/** Limpeza diária: arquivos de importações abandonadas há mais de 2 dias. */
async function limparPendentesAntigos() {
  const { rows } = await query(
    `UPDATE guias_importacao SET status = 'descartado'
     WHERE status = 'pendente' AND criado_em < NOW() - INTERVAL '2 days' RETURNING nome_armazenado`
  );
  for (const r of rows) await apagarArquivo(r.nome_armazenado);
  return rows.length;
}

module.exports = { criarLote, enviarArquivos, verLote, confirmar, descartarLote, statusEmails, limparPendentesAntigos, receitaStatus, buscarNaReceita };
