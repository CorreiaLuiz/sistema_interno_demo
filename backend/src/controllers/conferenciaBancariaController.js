const { query } = require('../config/db');
const LogAuditoria = require('../models/LogAuditoria');
const { AppError } = require('../middlewares/errorHandler');
const { importarPlanilha, listarPastasEmpresas, nomeNoDominio } = require('../services/cadastroExtratosService');
const { conferirEGravar, conferirVarias, statusLote, mesLimiteDoAno } = require('../services/conferenciaBancariaService');

/**
 * Conferência bancária (setor Contábil):
 *  GET  /empresas?ano=            → lista com a situação de cada mês
 *  POST /planilha                 → atualiza o cadastro pela planilha de controle de extratos
 *  GET  /empresas/:id?ano=        → ficha com a última conferência
 *  POST /empresas/:id/conferir    → confere agora (pasta + Domínio)
 *  PUT  /empresas/:id             → corrige pasta e/ou código do Domínio
 *  PUT  /empresas/:id/vinculos    → liga um extrato a uma conta do Domínio
 *  PUT  /empresas/:id/encerramentos → marca/desmarca conta de banco encerrada
 *  POST /lote   /  GET /lote      → confere várias empresas em segundo plano
 *  GET  /pastas                   → pastas de "01 - Empresas Ativas"
 *  GET  /painel?ano=&responsavel= → números do painel (das conferências gravadas)
 */

function anoDaRequisicao(valor) {
  const atual = new Date().getFullYear();
  const ano = Number(valor || atual);
  if (!Number.isInteger(ano) || ano < 2015 || ano > atual) throw new AppError('Ano inválido.');
  return ano;
}

function idValido(valor) {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('Empresa inválida.', 404);
  return id;
}

// Erros da leitura do Domínio/pasta são mensagens para a equipe; os do
// PostgreSQL continuam escondidos pelo errorHandler.
const paraEquipe = (err) => (err.code && /^[0-9A-Z]{5}$/.test(err.code) ? err : new AppError(err.message, err.status || 502));

async function listar(req, res, next) {
  try {
    const ano = anoDaRequisicao(req.query.ano);
    const { rows } = await query(
      `SELECT e.id, e.nome, e.cnpj, e.codigo_dominio, e.codigo_origem, e.nome_dominio, e.responsavel, e.regime, e.situacao,
              e.bancos, e.formato, e.extratos, e.malote, e.na_pasta, e.solicitado, e.pasta, e.na_planilha, e.empresa_id,
              c.meses, c.pendencias, c.erro, c.conferido_em, u.nome AS conferido_por
         FROM cb_empresas e
         LEFT JOIN cb_conferencias c ON c.cb_empresa_id = e.id AND c.ano = $1
         LEFT JOIN usuarios u ON u.id = c.conferido_por
        ORDER BY e.na_planilha DESC, e.nome`,
      [ano]
    );
    res.json({ ano, mesLimite: mesLimiteDoAno(ano), empresas: rows, lote: statusLote() });
  } catch (err) { next(err); }
}

async function atualizarPlanilha(req, res, next) {
  try {
    const resumo = await importarPlanilha().catch((e) => { throw paraEquipe(e); });
    LogAuditoria.registrar({ usuarioId: req.usuario.id, acao: 'atualizou o cadastro da conferência bancária pela planilha', entidade: 'conferencia_bancaria', detalhes: resumo });
    res.json(resumo);
  } catch (err) { next(err); }
}

async function detalhar(req, res, next) {
  try {
    const id = idValido(req.params.id);
    const ano = anoDaRequisicao(req.query.ano);
    const { rows } = await query(
      `SELECT e.*, c.resultado, c.pendencias, c.erro, c.conferido_em, u.nome AS conferido_por
         FROM cb_empresas e
         LEFT JOIN cb_conferencias c ON c.cb_empresa_id = e.id AND c.ano = $2
         LEFT JOIN usuarios u ON u.id = c.conferido_por
        WHERE e.id = $1`,
      [id, ano]
    );
    if (!rows.length) throw new AppError('Empresa não encontrada.', 404);
    const vinculos = (await query('SELECT chave_ofx, codi_cta FROM cb_vinculos_conta WHERE cb_empresa_id = $1', [id])).rows;
    res.json({ ...rows[0], vinculos, ano, pastaBase: process.env.CB_PASTA_EMPRESAS || '' });
  } catch (err) { next(err); }
}

async function conferir(req, res, next) {
  try {
    const id = idValido(req.params.id);
    const ano = anoDaRequisicao(req.body && req.body.ano);
    if (statusLote().rodando) throw new AppError('Há uma conferência de várias empresas em andamento. Aguarde terminar.', 409);
    const resultado = await conferirEGravar(id, ano, req.usuario.id).catch((e) => { throw paraEquipe(e); });
    res.json({ pendencias: resultado.pendencias.filter((p) => p.gravidade !== 'baixa').length });
  } catch (err) { next(err); }
}

async function corrigir(req, res, next) {
  try {
    const id = idValido(req.params.id);
    const { rows } = await query('SELECT id, codigo_dominio FROM cb_empresas WHERE id = $1', [id]);
    if (!rows.length) throw new AppError('Empresa não encontrada.', 404);
    const body = req.body || {};
    const mudou = {};

    if (body.pasta !== undefined) {
      const pasta = body.pasta ? String(body.pasta).trim() : null;
      if (pasta && !(await listarPastasEmpresas()).includes(pasta)) throw new AppError('Pasta não encontrada em "01 - Empresas Ativas".');
      await query('UPDATE cb_empresas SET pasta = $2, pasta_manual = $3 WHERE id = $1', [id, pasta, !!pasta]);
      mudou.pasta = pasta;
    }
    if (body.codigo_dominio !== undefined) {
      const codigo = body.codigo_dominio === null || body.codigo_dominio === '' ? null : Number(body.codigo_dominio);
      let nomeDominio = null;
      if (codigo !== null) {
        if (!Number.isInteger(codigo) || codigo <= 0) throw new AppError('Código do Domínio inválido.');
        const emp = await nomeNoDominio(codigo).catch((e) => { throw paraEquipe(e); });
        if (!emp) throw new AppError(`Não existe empresa com o código ${codigo} no Domínio.`);
        nomeDominio = emp.nome;
      }
      await query('UPDATE cb_empresas SET codigo_dominio = $2, codigo_origem = $3, nome_dominio = $4 WHERE id = $1',
        [id, codigo, codigo === null ? null : 'manual', nomeDominio]);
      if (codigo !== rows[0].codigo_dominio) await query('DELETE FROM cb_vinculos_conta WHERE cb_empresa_id = $1', [id]);
      if (codigo !== rows[0].codigo_dominio) await query('DELETE FROM cb_contas_encerradas WHERE cb_empresa_id = $1', [id]);
      mudou.codigo_dominio = codigo;
    }
    LogAuditoria.registrar({ usuarioId: req.usuario.id, acao: 'corrigiu o cadastro da conferência bancária', entidade: 'conferencia_bancaria', detalhes: { id, ...mudou } });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function vincular(req, res, next) {
  try {
    const id = idValido(req.params.id);
    const { chave_ofx: chave, codi_cta: codi } = req.body || {};
    if (!chave || typeof chave !== 'string' || chave.length > 80) throw new AppError('Extrato inválido.');
    if (codi === 'auto') {
      await query('DELETE FROM cb_vinculos_conta WHERE cb_empresa_id = $1 AND chave_ofx = $2', [id, chave]);
    } else {
      const conta = codi === null ? null : Number(codi);
      if (conta !== null && (!Number.isInteger(conta) || conta <= 0)) throw new AppError('Conta inválida.');
      await query(
        `INSERT INTO cb_vinculos_conta (cb_empresa_id, chave_ofx, codi_cta, usuario_id) VALUES ($1, $2, $3, $4)
         ON CONFLICT (cb_empresa_id, chave_ofx) DO UPDATE SET codi_cta = EXCLUDED.codi_cta, usuario_id = EXCLUDED.usuario_id, criado_em = NOW()`,
        [id, chave, conta, req.usuario.id]
      );
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
}

/** Marca (ou desmarca, com mes = null) uma conta de banco como encerrada. mes = 'AAAA-MM', último mês com movimento. */
async function encerrar(req, res, next) {
  try {
    const id = idValido(req.params.id);
    const codi = Number(req.body && req.body.codi_cta);
    const mes = req.body ? req.body.mes : undefined;
    if (!Number.isInteger(codi) || codi <= 0) throw new AppError('Conta inválida.');
    if (mes === null || mes === '') {
      await query('DELETE FROM cb_contas_encerradas WHERE cb_empresa_id = $1 AND codi_cta = $2', [id, codi]);
    } else {
      if (!/^(20\d{2})-(0[1-9]|1[0-2])$/.test(String(mes))) throw new AppError('Mês de encerramento inválido.');
      await query(
        `INSERT INTO cb_contas_encerradas (cb_empresa_id, codi_cta, encerrada_em, usuario_id) VALUES ($1, $2, $3, $4)
         ON CONFLICT (cb_empresa_id, codi_cta) DO UPDATE SET encerrada_em = EXCLUDED.encerrada_em, usuario_id = EXCLUDED.usuario_id, criado_em = NOW()`,
        [id, codi, `${mes}-01`, req.usuario.id]
      );
    }
    LogAuditoria.registrar({ usuarioId: req.usuario.id, acao: mes ? `marcou a conta ${codi} como encerrada em ${mes}` : `desmarcou o encerramento da conta ${codi}`, entidade: 'conferencia_bancaria', entidadeId: null, detalhes: { cb_empresa_id: id, codi, mes } });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function iniciarLote(req, res, next) {
  try {
    const ano = anoDaRequisicao(req.body && req.body.ano);
    let ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0) : null;
    if (!ids || !ids.length) {
      ids = (await query('SELECT id FROM cb_empresas WHERE na_planilha AND codigo_dominio IS NOT NULL ORDER BY nome')).rows.map((r) => r.id);
    }
    if (!ids.length) throw new AppError('Nenhuma empresa para conferir.');
    const status = conferirVarias(ids, ano, req.usuario);
    LogAuditoria.registrar({ usuarioId: req.usuario.id, acao: `iniciou a conferência bancária de ${ids.length} empresa(s)`, entidade: 'conferencia_bancaria', detalhes: { ano, total: ids.length } });
    res.status(202).json(status);
  } catch (err) { next(err.status === 409 ? new AppError(err.message, 409) : err); }
}

/**
 * Painel: números do escritório calculados das conferências já gravadas
 * (não consulta o Domínio). Filtros: ano e responsável.
 */
const GRUPO_MES = { ok: 'conferido', lancado_sem_ofx: 'conferido', falta_importar: 'importar', falta_extrato: 'extrato', diferenca: 'diferenca', nao_identificada: 'diferenca' };

async function painel(req, res, next) {
  try {
    const ano = anoDaRequisicao(req.query.ano);
    const responsavel = req.query.responsavel ? String(req.query.responsavel).slice(0, 10) : null;
    const { rows } = await query(
      `SELECT e.id, e.nome, e.codigo_dominio, e.responsavel, e.pasta, c.resultado, c.pendencias, c.erro, c.conferido_em
         FROM cb_empresas e
         LEFT JOIN cb_conferencias c ON c.cb_empresa_id = e.id AND c.ano = $1
        WHERE e.na_planilha AND ($2::text IS NULL OR e.responsavel = $2)`,
      [ano, responsavel]
    );
    const anos = (await query('SELECT DISTINCT ano FROM cb_conferencias ORDER BY ano DESC')).rows.map((r) => r.ano);
    const responsaveis = (await query('SELECT DISTINCT responsavel FROM cb_empresas WHERE na_planilha AND responsavel IS NOT NULL ORDER BY 1')).rows.map((r) => r.responsavel);
    const mesLimite = mesLimiteDoAno(ano);

    const totais = { empresas: rows.length, conferidas: 0, emDia: 0, comDiferenca: 0, faltaImportar: 0, faltaExtrato: 0, naoConferidas: 0, somaDiferencas: 0 };
    const porMes = Array.from({ length: mesLimite }, (_, i) => ({ m: i + 1, conferido: 0, importar: 0, extrato: 0, diferenca: 0 }));
    const porResp = new Map();
    const diferencas = [];
    const contas = [];

    for (const e of rows) {
      const chaveResp = e.responsavel || '—';
      if (!porResp.has(chaveResp)) porResp.set(chaveResp, { responsavel: chaveResp, empresas: 0, emDia: 0, comPendencia: 0, naoConferidas: 0, diferenca: 0, importar: 0, extrato: 0, encerradas: 0 });
      const pr = porResp.get(chaveResp);
      pr.empresas++;
      const r = e.resultado;
      if (!r || e.erro) { totais.naoConferidas++; pr.naoConferidas++; continue; }
      totais.conferidas++;
      const baixa = (p) => p.gravidade === 'baixa';
      const pend = r.pendencias.filter((p) => !baixa(p));
      if (!pend.length) { totais.emDia++; pr.emDia++; } else pr.comPendencia++;

      const statuses = new Set(r.resumoMeses.map((x) => x.status));
      if (statuses.has('diferenca') || statuses.has('nao_identificada')) totais.comDiferenca++;
      if (statuses.has('falta_importar')) totais.faltaImportar++;
      if (statuses.has('falta_extrato')) totais.faltaExtrato++;
      for (const x of r.resumoMeses) {
        const g = GRUPO_MES[x.status];
        if (g && porMes[x.m - 1]) porMes[x.m - 1][g]++;
      }
      pr.diferenca += pend.filter((p) => p.tipo === 'diferenca' || p.tipo === 'vincular').length;
      pr.importar += pend.filter((p) => p.tipo === 'importar').length;
      pr.extrato += pend.filter((p) => p.tipo === 'extrato').length;

      let soma = 0; let meses = 0; const nomesContas = new Set();
      for (const p of r.pendencias) {
        if (p.tipo !== 'diferenca' || !p.valores) continue;
        soma += Math.abs(p.valores.difEntradas || 0) + Math.abs(p.valores.difSaidas || 0);
        meses++;
        nomesContas.add(p.conta);
      }
      if (soma > 0) {
        totais.somaDiferencas += soma;
        diferencas.push({ id: e.id, nome: e.nome, codigo: e.codigo_dominio, responsavel: e.responsavel, soma: Math.round(soma * 100) / 100, meses, contas: [...nomesContas] });
      }

      for (const c of r.contas || []) {
        if (!c.encerramento && !c.suspeita) continue;
        if (c.encerramento) pr.encerradas++;
        contas.push({
          id: e.id, empresa: e.nome, responsavel: e.responsavel, conta: c.nome, codi: c.codi,
          situacao: c.encerramento ? 'encerrada' : 'suspeita',
          motivo: c.encerramento ? c.encerramento.origem : c.suspeita.motivo,
          detalhe: c.encerramento ? (c.encerramento.arquivo || c.encerramento.data || null) : (c.suspeita.texto || null),
          mes: c.encerramento ? c.encerramento.mes : (c.suspeita.desde ?? null),
          saldo: c.saldoFinal || 0
        });
      }
    }
    totais.somaDiferencas = Math.round(totais.somaDiferencas * 100) / 100;
    diferencas.sort((a, b) => b.soma - a.soma);
    contas.sort((a, b) => Math.abs(b.saldo) - Math.abs(a.saldo));

    res.json({
      ano, mesLimite, anos, responsaveis, responsavel, totais, porMes,
      porResponsavel: [...porResp.values()].sort((a, b) => String(a.responsavel).localeCompare(String(b.responsavel))),
      diferencas: diferencas.slice(0, 15), totalEmpresasComDiferencaEmReais: diferencas.length,
      contas
    });
  } catch (err) { next(err); }
}

function verLote(req, res) {
  res.json(statusLote());
}

async function pastas(req, res, next) {
  try {
    res.json(await listarPastasEmpresas().catch((e) => { throw paraEquipe(e); }));
  } catch (err) { next(err); }
}

module.exports = { listar, atualizarPlanilha, detalhar, conferir, corrigir, vincular, encerrar, iniciarLote, verLote, pastas, painel };
