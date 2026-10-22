/**
 * Avisos gerais do escritório — os únicos e-mails que vão para TODOS:
 *   - empresa nova no escritório (informativo interno, no cadastro)
 *   - empresa cadastrada no Domínio (ao concluir esse estágio da esteira)
 *   - saída da empresa do escritório (botão do administrador)
 *
 * Os textos seguem o modelo dos e-mails que o escritório já manda
 * manualmente. Um único e-mail sai com todos no "Para" (como hoje), com
 * "responder para" apontando para quem fez a ação no sistema.
 *
 * Destinatários: lista EMAIL_AVISOS_GERAIS do .env (e-mails separados por
 * vírgula — pode ser um e-mail de grupo). Se estiver vazia, vai para todos
 * os usuários ativos do sistema (útil durante os testes).
 */

const Usuario = require('../models/Usuario');
const HistoricoComunicacao = require('../models/HistoricoComunicacao');
const { enviarEmail } = require('./notificacaoService');

const ROTULOS_REGIME = {
  simples_nacional: 'Simples Nacional',
  lucro_presumido: 'Lucro Presumido',
  lucro_real: 'Lucro Real',
  mei: 'MEI'
};

async function destinatariosAvisosGerais() {
  const lista = (process.env.EMAIL_AVISOS_GERAIS || '')
    .split(',').map((e) => e.trim()).filter(Boolean);
  if (lista.length) return lista;

  const usuarios = await Usuario.listar();
  return usuarios.filter((u) => u.ativo && u.email).map((u) => u.email);
}

/** "Bom dia" / "Boa tarde" / "Boa noite" no horário de Brasília. */
function saudacao() {
  const hora = Number(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }));
  if (hora < 12) return 'Bom dia';
  if (hora < 18) return 'Boa tarde';
  return 'Boa noite';
}

/**
 * Date/'AAAA-MM-DD' → 'AAAA-MM-DD'. O driver do PostgreSQL devolve colunas
 * DATE como Date à meia-noite do horário LOCAL, então lê os componentes
 * locais (toISOString converteria para UTC e poderia mudar o dia).
 */
function dataIso(valor) {
  if (valor instanceof Date) {
    const dois = (n) => String(n).padStart(2, '0');
    return `${valor.getFullYear()}-${dois(valor.getMonth() + 1)}-${dois(valor.getDate())}`;
  }
  return String(valor).slice(0, 10);
}

/** Date/'AAAA-MM-DD' → 'DD/MM/AAAA'. */
function formatarData(valor) {
  const [ano, mes, dia] = dataIso(valor).split('-');
  return `${dia}/${mes}/${ano}`;
}

/** Date/'AAAA-MM-DD' → 'MM/AAAA'. */
function formatarCompetencia(valor) {
  return formatarData(valor).slice(3);
}

function diaSeguinte(valor) {
  const data = new Date(`${dataIso(valor)}T12:00:00Z`);
  data.setUTCDate(data.getUTCDate() + 1);
  return data.toISOString().slice(0, 10);
}

function assinatura(usuario) {
  return `\n\nAtenciosamente,\n${usuario.nome}\nPrivilege Contabilidade e Consultoria`;
}

function montarAvisoEntrada(empresa, usuario) {
  const razao = empresa.razao_social.toUpperCase();
  const competencia = empresa.competencia_inicio ? formatarCompetencia(empresa.competencia_inicio) : null;

  const itens = [];
  if (empresa.email) itens.push(`• E-mail: ${empresa.email}`);
  if (empresa.telefone) itens.push(`• Telefone: ${empresa.telefone}`);
  itens.push(`• Regime Tributário: ${ROTULOS_REGIME[empresa.regime_tributario] || empresa.regime_tributario};`);
  if (empresa.fator_r === true) itens.push('• Empresa TERÁ fator R;');
  if (empresa.fator_r === false) itens.push('• Empresa NÃO terá fator R;');
  if (empresa.pro_labore) itens.push(`• Pró-labore: ${empresa.pro_labore};`);
  if (empresa.observacoes) itens.push(`• Observações: ${empresa.observacoes}`);

  return {
    assunto: `${razao} - EMPRESA NOVA NO ESCRITÓRIO` +
      (competencia ? ` A PARTIR DA COMPETÊNCIA ${competencia}` : ''),
    mensagem:
      `${saudacao()} Pessoal.\n\n` +
      `Segue informativo interno referente à entrada da empresa ${razao} (CNPJ ${empresa.cnpj}) no escritório` +
      (competencia ? ` a partir da competência ${competencia}.` : '.') +
      `\n\n${itens.join('\n')}` +
      assinatura(usuario)
  };
}

function montarAvisoDominio(empresa, usuario) {
  const razao = empresa.razao_social.toUpperCase();
  return {
    assunto: `${razao} - EMPRESA CADASTRADA NO DOMÍNIO`,
    mensagem:
      `${saudacao()},\n\n` +
      `Empresa ${razao} (CNPJ ${empresa.cnpj}) cadastrada no sistema Domínio.` +
      assinatura(usuario)
  };
}

function montarAvisoSaida(empresa, usuario) {
  const razao = empresa.razao_social.toUpperCase();
  const encerramento = formatarData(empresa.data_saida);
  return {
    assunto: `${razao} - SAÍDA DO ESCRITÓRIO EM ${encerramento}`,
    mensagem:
      'Prezados (as),\n\n' +
      `Informo, por meio deste, que a empresa "${razao}" não é mais cliente do escritório desde ` +
      `${formatarData(diaSeguinte(empresa.data_saida))}.\n` +
      `Nossa responsabilidade com essa empresa se encerrou em ${encerramento}.` +
      (empresa.observacao_saida ? `\n\nObs.: ${empresa.observacao_saida}` : '') +
      assinatura(usuario)
  };
}

/**
 * Envia o aviso para todos e registra uma linha por destinatário no
 * histórico de comunicação da empresa. Nunca lança erro.
 */
async function enviarAvisoGeral({ empresa, usuario, assunto, mensagem }) {
  try {
    const destinatarios = await destinatariosAvisosGerais();
    if (!destinatarios.length) {
      console.log('[aviso-geral] Nenhum destinatário configurado — aviso não enviado.');
      return;
    }

    let status = 'enviado';
    let erro = null;
    try {
      await enviarEmail({ destinatario: destinatarios, assunto, mensagem, responderPara: usuario.email });
    } catch (err) {
      status = 'falhou';
      erro = err.message;
      console.error(`[aviso-geral] Falha ao enviar "${assunto}":`, err.message);
    }

    await Promise.all(destinatarios.map((destinatario) =>
      HistoricoComunicacao.registrar({
        empresaId: empresa.id, processoId: null, canal: 'email',
        destinatario, assunto, mensagem, status, erro, enviadoPor: usuario.id
      }).catch((e) => console.error('Falha ao registrar histórico de comunicação:', e))
    ));
  } catch (err) {
    console.error('[aviso-geral] Erro inesperado:', err);
  }
}

module.exports = {
  enviarAvisoEntrada: (empresa, usuario) => enviarAvisoGeral({ empresa, usuario, ...montarAvisoEntrada(empresa, usuario) }),
  enviarAvisoDominio: (empresa, usuario) => enviarAvisoGeral({ empresa, usuario, ...montarAvisoDominio(empresa, usuario) }),
  enviarAvisoSaida: (empresa, usuario) => enviarAvisoGeral({ empresa, usuario, ...montarAvisoSaida(empresa, usuario) }),
  montarAvisoEntrada, montarAvisoDominio, montarAvisoSaida
};
