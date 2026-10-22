// @ts-check
const { query } = require('../config/db');
const LogAuditoria = require('../models/LogAuditoria');
const integra = require('../services/integraContadorService');
const caixaPostal = require('../services/caixaPostalService');
const { AppError } = require('../middlewares/errorHandler');

/**
 * Caixa Postal do e-CAC (Integra Contador):
 *   GET  /api/caixa-postal                          → empresas ativas + última verificação (sem custo)
 *   POST /api/caixa-postal/:empresaId/verificar     → pergunta à Receita se há mensagens novas e,
 *                                                     se houver, traz os ASSUNTOS (cobrado; não marca como lida)
 *   POST /api/caixa-postal/:empresaId/mensagens/:isn → abre o conteúdo (cobrado e CONTA COMO LEITURA na Receita)
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const soDigitos = (v) => String(v || '').replace(/\D/g, '');

async function empresaOuFalhar(id) {
  if (!UUID.test(String(id || ''))) throw new AppError('Empresa não encontrada.', 404);
  const { rows: [empresa] } = await query('SELECT id, razao_social, cnpj FROM empresas WHERE id = $1', [id]);
  if (!empresa) throw new AppError('Empresa não encontrada.', 404);
  return empresa;
}

function exigirIntegra() {
  if (!integra.configurado()) throw new AppError('O Integra Contador não está configurado no .env.', 503);
}

async function listar(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT e.id, e.razao_social, e.cnpj, e.regime_tributario,
              cp.indicador, cp.nao_lidas, cp.mensagens, cp.erro, cp.verificado_em, u.nome AS verificado_por_nome
       FROM empresas e
       LEFT JOIN caixa_postal cp ON cp.empresa_id = e.id
       LEFT JOIN usuarios u ON u.id = cp.verificado_por
       WHERE e.situacao = 'ativa'
       ORDER BY cp.nao_lidas DESC NULLS LAST, e.razao_social`
    );
    res.json({ configurado: integra.configurado(), empresas: rows });
  } catch (err) {
    next(err);
  }
}

async function verificar(req, res, next) {
  try {
    exigirIntegra();
    const empresa = await empresaOuFalhar(req.params.empresaId);
    const cnpj = soDigitos(empresa.cnpj);
    let indicador = null; let mensagens = []; let erro = null; let haMais = false;
    try {
      indicador = await caixaPostal.indicador(cnpj);
      if (indicador > 0) ({ mensagens, haMais } = await caixaPostal.naoLidas(cnpj));
    } catch (err) {
      if (!(err instanceof integra.ErroIntegra)) throw err;
      erro = err.message.slice(0, 400);
    }
    const naoLidas = erro ? null : mensagens.length;
    const { rows: [linha] } = await query(
      `INSERT INTO caixa_postal (empresa_id, indicador, nao_lidas, mensagens, erro, verificado_em, verificado_por)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6)
       ON CONFLICT (empresa_id) DO UPDATE SET
         indicador = EXCLUDED.indicador, nao_lidas = EXCLUDED.nao_lidas, mensagens = EXCLUDED.mensagens,
         erro = EXCLUDED.erro, verificado_em = NOW(), verificado_por = EXCLUDED.verificado_por
       RETURNING *`,
      [empresa.id, indicador, naoLidas, JSON.stringify(mensagens), erro, req.usuario.id]
    );
    LogAuditoria.registrar({
      usuarioId: req.usuario.id, acao: 'READ', entidade: 'empresa', entidadeId: empresa.id,
      detalhes: { acao_especifica: 'caixa_postal_verificar', nao_lidas: naoLidas, erro }
    });
    res.json({ ...linha, ha_mais: haMais, verificado_por_nome: req.usuario.nome });
  } catch (err) {
    next(err);
  }
}

async function abrirMensagem(req, res, next) {
  try {
    exigirIntegra();
    const empresa = await empresaOuFalhar(req.params.empresaId);
    const isn = soDigitos(req.params.isn);
    if (!isn) throw new AppError('Mensagem inválida.', 400);
    let mensagem;
    try {
      mensagem = await caixaPostal.detalhar(soDigitos(empresa.cnpj), isn);
    } catch (err) {
      if (err instanceof integra.ErroIntegra) throw new AppError(err.message, 502);
      throw err;
    }
    // Agora ela foi lida na Receita: sai da lista de não lidas guardada
    await query(
      `UPDATE caixa_postal SET
         mensagens = COALESCE((SELECT jsonb_agg(m) FROM jsonb_array_elements(mensagens) m WHERE m->>'isn' <> $2), '[]'::jsonb),
         nao_lidas = GREATEST(COALESCE(nao_lidas, 1) - 1, 0)
       WHERE empresa_id = $1 AND mensagens @> jsonb_build_array(jsonb_build_object('isn', $2::text))`,
      [empresa.id, isn]
    );
    // Quem abriu fica registrado: em intimações, a leitura conta como ciência
    LogAuditoria.registrar({
      usuarioId: req.usuario.id, acao: 'READ', entidade: 'empresa', entidadeId: empresa.id,
      detalhes: { acao_especifica: 'caixa_postal_abrir_mensagem', isn, assunto: mensagem.assunto }
    });
    res.json(mensagem);
  } catch (err) {
    next(err);
  }
}

module.exports = { listar, verificar, abrirMensagem };
