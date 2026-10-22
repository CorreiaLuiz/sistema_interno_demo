const cron = require('node-cron');
const { query } = require('../config/db');
const Empresa = require('../models/Empresa');
const { notificarMudancaStatus } = require('../services/notificacaoService');
const Notificacao = require('../models/Notificacao');

/**
 * Roda a função SQL que recalcula o status (valida/a_vencer/vencida) de
 * todas as certidões e licenças com base na data de hoje — mantém tudo
 * atualizado mesmo em registros que ninguém edita há semanas.
 */
async function atualizarStatusVencimentos() {
  await query('SELECT atualizar_status_vencimentos();');
}

/**
 * Verifica se já foi enviado um alerta para este registro nesta mesma
 * data de validade (evita reenviar o mesmo aviso todo dia).
 */
async function jaAlertado(tipoRegistro, registroId, dataValidade) {
  const { rows } = await query(
    'SELECT 1 FROM alertas_vencimento_enviados WHERE tipo_registro = $1 AND registro_id = $2 AND data_validade = $3',
    [tipoRegistro, registroId, dataValidade]
  );
  return rows.length > 0;
}

async function marcarAlertado(tipoRegistro, registroId, dataValidade) {
  await query(
    `INSERT INTO alertas_vencimento_enviados (tipo_registro, registro_id, data_validade)
     VALUES ($1, $2, $3)
     ON CONFLICT (tipo_registro, registro_id, data_validade) DO NOTHING`,
    [tipoRegistro, registroId, dataValidade]
  );
}

/**
 * Envia um alerta (e-mail/WhatsApp) para cada certidão ou licença que
 * está "a vencer" e ainda não teve alerta enviado para esta validade.
 */
async function enviarAlertasVencimento() {
  const { rows: certidoes } = await query(
    `SELECT id, empresa_id, tipo, data_validade FROM certidoes WHERE status = 'a_vencer'`
  );
  const { rows: licencas } = await query(
    `SELECT id, empresa_id, tipo, data_validade FROM licencas WHERE status = 'a_vencer'`
  );
  const { rows: certificados } = await query(
    `SELECT id, empresa_id, tipo, data_validade FROM certificados_digitais WHERE status = 'a_vencer'`
  );

  const itens = [
    ...certidoes.map((c) => ({ ...c, tipoRegistro: 'certidao' })),
    ...licencas.map((l) => ({ ...l, tipoRegistro: 'licenca' })),
    ...certificados.map((cd) => ({ ...cd, tipoRegistro: 'certificado_digital' }))
  ];

  const ROTULOS_TIPO_REGISTRO = {
    certidao: 'certidão',
    licenca: 'licença',
    certificado_digital: 'certificado digital'
  };

  for (const item of itens) {
    const jaEnviado = await jaAlertado(item.tipoRegistro, item.id, item.data_validade);
    if (jaEnviado) continue;

    const empresa = await Empresa.buscarPorId(item.empresa_id);
    // Empresa que saiu do escritório não é mais responsabilidade nossa
    if (!empresa || empresa.situacao === 'saiu_escritorio') continue;

    try {
      await notificarMudancaStatus({
        empresa,
        processo: { id: null, tipo: `${ROTULOS_TIPO_REGISTRO[item.tipoRegistro]} (${item.tipo}) próxima do vencimento` },
        statusAnterior: 'valida',
        statusNovo: 'a_vencer'
      });
      await marcarAlertado(item.tipoRegistro, item.id, item.data_validade);

      // Aviso no sininho de quem cuida desse tipo de vencimento
      const papeis = {
        certidao: ['administrador', 'analista_certidoes'],
        licenca: ['administrador', 'analista_licencas'],
        certificado_digital: ['administrador', 'analista_legalizacao']
      }[item.tipoRegistro];
      await Notificacao.avisar({
        papeis, tipo: 'vencimento',
        titulo: `${ROTULOS_TIPO_REGISTRO[item.tipoRegistro]} (${item.tipo}) vence em breve — ${empresa.razao_social}`,
        mensagem: `Validade: ${new Date(item.data_validade).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}`,
        link: `/pages/empresa.html?id=${empresa.id}#vencimentos`
      });
    } catch (err) {
      console.error(`[job-vencimentos] Falha ao alertar ${item.tipoRegistro} ${item.id}:`, err.message);
    }
  }
}

/**
 * Agenda o job para rodar todo dia às 06:00 (horário do servidor).
 * Chamar uma vez em server.js na inicialização.
 */
function iniciarJobVencimentos() {
  cron.schedule('0 6 * * *', async () => {
    console.log('[job-vencimentos] Iniciando rotina diária de vencimentos...');
    try {
      await atualizarStatusVencimentos();
      await enviarAlertasVencimento();
      await Notificacao.limparAntigas();
      await require('../controllers/guiaImportacaoController').limparPendentesAntigos();
      console.log('[job-vencimentos] Rotina concluída com sucesso.');
    } catch (err) {
      console.error('[job-vencimentos] Erro na rotina diária:', err);
    }
  });
  console.log('[job-vencimentos] Agendado para rodar todo dia às 06:00.');
}

module.exports = { iniciarJobVencimentos, atualizarStatusVencimentos, enviarAlertasVencimento };
