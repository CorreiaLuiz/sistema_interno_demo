const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { query } = require('../config/db');
const Empresa = require('../models/Empresa');
const Certidao = require('../models/Certidao');
const { Documento } = require('../models/Documento');
const LogAuditoria = require('../models/LogAuditoria');
const { consultarCndFederal, configurado, ErroSerpro } = require('../services/serproCndService');
const integra = require('../services/integraContadorService');
const { emitirRelatorio } = require('../services/sitfisService');
const { UPLOAD_DIR } = require('../middlewares/upload');
const { AppError } = require('../middlewares/errorHandler');

/**
 * CND Federal pela API do SERPRO, a partir do botão "Certidões" da empresa.
 *   GET  /api/empresas/:id/cnd-federal  → última consulta guardada (sem custo)
 *   POST /api/empresas/:id/cnd-federal  → consulta no SERPRO (cobrada)
 * O PDF da certidão vira um documento da empresa (categoria "Certidão",
 * visível na Área do Cliente) e a certidão é gravada/atualizada na tela Certidões.
 */

const ORGAO = 'Receita Federal do Brasil / PGFN';
const dataBR = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

async function ultimoPdf(empresaId) {
  const { rows: [doc] } = await query(
    `SELECT id, nome_original, criado_em FROM documentos
     WHERE empresa_id = $1 AND categoria = 'certidao' AND descricao LIKE 'CND Federal%'
     ORDER BY criado_em DESC LIMIT 1`,
    [empresaId]
  );
  return doc || null;
}

async function ultimaSituacaoFiscal(empresaId) {
  const { rows: [s] } = await query(
    `SELECT situacao, resumo, documento_id, criado_em FROM situacao_fiscal WHERE empresa_id = $1 ORDER BY criado_em DESC LIMIT 1`,
    [empresaId]
  );
  return s || null;
}

async function ver(req, res, next) {
  try {
    const empresa = await Empresa.buscarPorId(req.params.id);
    if (!empresa) throw new AppError('Empresa não encontrada.', 404);
    res.json({
      configurado: configurado(),
      certidao: await Certidao.buscarPorEmpresaETipo(empresa.id, 'federal'),
      documento: await ultimoPdf(empresa.id),
      integra: { configurado: integra.configurado(), ultima: await ultimaSituacaoFiscal(empresa.id) }
    });
  } catch (err) {
    next(err);
  }
}

async function consultar(req, res, next) {
  try {
    const empresa = await Empresa.buscarPorId(req.params.id);
    if (!empresa) throw new AppError('Empresa não encontrada.', 404);

    let resultado;
    try {
      resultado = await consultarCndFederal(empresa.cnpj);
    } catch (err) {
      LogAuditoria.registrar({
        usuarioId: req.usuario.id, acao: 'CREATE', entidade: 'certidao', entidadeId: null,
        detalhes: { acao_especifica: 'consulta_cnd_federal', empresa_id: empresa.id, erro: err.message, status_serpro: err.statusSerpro || null }
      });
      if (err instanceof ErroSerpro) throw new AppError(err.message, err.httpStatus);
      throw err;
    }

    const hoje = new Date().toISOString().slice(0, 10);
    const regular = resultado.situacao === 'regular';
    const observacoes = `Consulta SERPRO em ${dataBR(hoje)}: ${resultado.mensagem}`
      + (resultado.codigoControle ? ` Código de controle: ${resultado.codigoControle}.` : '');

    const dados = regular
      ? { orgao_emissor: ORGAO, numero_certidao: resultado.codigoControle, data_emissao: resultado.dataEmissao, data_validade: resultado.dataValidade, observacoes }
      : { orgao_emissor: ORGAO, status: 'vencida', observacoes };
    const existente = await Certidao.buscarPorEmpresaETipo(empresa.id, 'federal');
    const certidao = existente
      ? await Certidao.atualizar(existente.id, dados)
      : await Certidao.criar({ ...dados, empresa_id: empresa.id, tipo: 'federal', responsavel_id: req.usuario.id });

    // Guarda o PDF como documento da empresa (o cliente vê na Área do Cliente)
    let documento = null;
    if (resultado.pdf && resultado.pdf.slice(0, 5).toString() === '%PDF-') {
      const nomeArmazenado = `${Date.now()}-${crypto.randomBytes(16).toString('hex')}.pdf`;
      await fs.promises.writeFile(path.join(UPLOAD_DIR, nomeArmazenado), resultado.pdf);
      const cnpj = String(empresa.cnpj).replace(/\D/g, '');
      documento = await Documento.criar({
        empresa_id: empresa.id,
        nome_original: `CND Federal ${cnpj} ${hoje}.pdf`,
        nome_armazenado: nomeArmazenado,
        caminho: path.join('uploads', nomeArmazenado),
        tipo_mime: 'application/pdf',
        tamanho_bytes: resultado.pdf.length,
        categoria: 'certidao',
        descricao: `CND Federal · válida até ${dataBR(resultado.dataValidade)}`.slice(0, 255),
        enviado_por: req.usuario.id,
        visivel_cliente: true
      });
    }

    LogAuditoria.registrar({
      usuarioId: req.usuario.id, acao: 'CREATE', entidade: 'certidao', entidadeId: certidao.id,
      detalhes: { acao_especifica: 'consulta_cnd_federal', empresa_id: empresa.id, status_serpro: resultado.statusSerpro, situacao: resultado.situacao }
    });

    res.json({ situacao: resultado.situacao, mensagem: resultado.mensagem, certidao, documento: documento || (regular ? await ultimoPdf(empresa.id) : null) });
  } catch (err) {
    next(err);
  }
}

/**
 * Relatório de Situação Fiscal pelo Integra Contador (cobrado):
 *   POST /api/empresas/:id/situacao-fiscal
 * O PDF fica nos documentos da empresa (só para a equipe). Se o relatório mostrar
 * uma certidão já emitida e válida, a CND Federal da empresa é atualizada com ela.
 */
async function situacaoFiscal(req, res, next) {
  try {
    const empresa = await Empresa.buscarPorId(req.params.id);
    if (!empresa) throw new AppError('Empresa não encontrada.', 404);
    if (!integra.configurado()) throw new AppError('O Integra Contador não está configurado no .env.', 503);
    const cnpj = String(empresa.cnpj).replace(/\D/g, '');

    let relatorio;
    try {
      relatorio = await emitirRelatorio(cnpj);
    } catch (err) {
      LogAuditoria.registrar({
        usuarioId: req.usuario.id, acao: 'CREATE', entidade: 'certidao', entidadeId: null,
        detalhes: { acao_especifica: 'situacao_fiscal', empresa_id: empresa.id, erro: err.message }
      });
      if (err instanceof integra.ErroIntegra) throw new AppError(err.message, err.httpStatus >= 500 ? 502 : err.httpStatus);
      throw err;
    }
    const { analise } = relatorio;
    const hoje = new Date().toISOString().slice(0, 10);

    const nomeArmazenado = `${Date.now()}-${crypto.randomBytes(16).toString('hex')}.pdf`;
    await fs.promises.writeFile(path.join(UPLOAD_DIR, nomeArmazenado), relatorio.pdf);
    const rotuloSituacao = { regular: 'sem pendências', pendencia: 'com pendências', indefinida: 'conferir' }[analise.situacao];
    const documento = await Documento.criar({
      empresa_id: empresa.id,
      nome_original: `Situacao fiscal ${cnpj} ${hoje}.pdf`,
      nome_armazenado: nomeArmazenado,
      caminho: path.join('uploads', nomeArmazenado),
      tipo_mime: 'application/pdf',
      tamanho_bytes: relatorio.pdf.length,
      categoria: 'certidao',
      descricao: `Relatório de Situação Fiscal (Receita/PGFN) · ${dataBR(hoje)} · ${rotuloSituacao}`.slice(0, 255),
      enviado_por: req.usuario.id,
      visivel_cliente: false
    });

    const resumo = { certidao: analise.certidao, pendencias: analise.pendencias, suspensos: analise.suspensos, pgfnSemPendencias: analise.pgfnSemPendencias };
    await query(
      'INSERT INTO situacao_fiscal (empresa_id, situacao, resumo, documento_id, usuario_id) VALUES ($1, $2, $3, $4, $5)',
      [empresa.id, analise.situacao, JSON.stringify(resumo), documento.id, req.usuario.id]
    );

    // Certidão já emitida e válida no relatório → atualiza a CND Federal da empresa
    let certidao = await Certidao.buscarPorEmpresaETipo(empresa.id, 'federal');
    const c = analise.certidao;
    const validadeAtual = certidao && certidao.data_validade ? new Date(certidao.data_validade).toISOString().slice(0, 10) : null;
    if (c && c.validade && c.validade >= hoje && (!validadeAtual || c.validade > validadeAtual || (certidao && certidao.status === 'vencida'))) {
      const dados = {
        orgao_emissor: ORGAO, numero_certidao: c.codigo, data_emissao: c.emissao, data_validade: c.validade,
        observacoes: `${c.tipo}, lida do Relatório de Situação Fiscal em ${dataBR(hoje)}.`
      };
      certidao = certidao
        ? await Certidao.atualizar(certidao.id, dados)
        : await Certidao.criar({ ...dados, empresa_id: empresa.id, tipo: 'federal', responsavel_id: req.usuario.id });
    }

    LogAuditoria.registrar({
      usuarioId: req.usuario.id, acao: 'CREATE', entidade: 'certidao', entidadeId: certidao ? certidao.id : null,
      detalhes: { acao_especifica: 'situacao_fiscal', empresa_id: empresa.id, situacao: analise.situacao, pendencias: analise.pendencias }
    });

    res.json({
      certidao,
      documento: await ultimoPdf(empresa.id),
      integra: { configurado: true, ultima: { situacao: analise.situacao, resumo, documento_id: documento.id, criado_em: new Date().toISOString() } }
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { ver, consultar, situacaoFiscal };
