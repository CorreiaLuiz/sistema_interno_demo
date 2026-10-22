// @ts-check
/**
 * Caixa Postal do e-CAC pelo Integra Contador.
 *   indicador(cnpj)        Monitorar CAIXAPOSTAL/INNOVAMSG63   → 0 sem novas, 1 uma nova, 2 várias
 *   naoLidas(cnpj)         Consultar CAIXAPOSTAL/MSGCONTRIBUINTE61 → só os ASSUNTOS (não marca como lida)
 *   detalhar(cnpj, isn)    Consultar CAIXAPOSTAL/MSGDETALHAMENTO62 → texto completo.
 *     ATENÇÃO: abrir o conteúdo conta como LEITURA na Receita (igual abrir no e-CAC) —
 *     em intimações, o prazo pode começar a contar. A tela pede confirmação antes.
 */

const integra = require('./integraContadorService');

const dataISO = (v) => (/^\d{8}$/.test(String(v || '')) ? `${String(v).slice(0, 4)}-${String(v).slice(4, 6)}-${String(v).slice(6, 8)}` : null);
const primeiro = (dados) => (dados && Array.isArray(dados.conteudo) ? dados.conteudo[0] || {} : dados || {});

function montarAssunto(m) {
  return String(m.assuntoModelo || '').replace(/\+\+VARIAVEL\+\+/g, m.valorParametroAssunto || '').replace(/\s+/g, ' ').trim();
}

function resumirMensagem(m) {
  return {
    isn: String(m.isn),
    assunto: montarAssunto(m),
    enviada_em: dataISO(m.dataEnvio),
    ciencia_em: dataISO(m.dataCiencia),           // data da ciência (tácita, se ninguém abrir antes)
    relevante: String(m.relevancia) === '2',
    origem: m.descricaoOrigem || null,
    anexos: String(m.indicadorAnexos || '') === '1'
  };
}

async function indicador(cnpj) {
  const r = await integra.chamar('Monitorar', { contribuinte: cnpj, idSistema: 'CAIXAPOSTAL', idServico: 'INNOVAMSG63', dados: '' });
  const valor = Number(primeiro(r.dados).indicadorMensagensNovas);
  return Number.isNaN(valor) ? null : valor;
}

/** Até 50 mensagens não lidas, mais recentes primeiro. */
async function naoLidas(cnpj) {
  const r = await integra.chamar('Consultar', { contribuinte: cnpj, idSistema: 'CAIXAPOSTAL', idServico: 'MSGCONTRIBUINTE61', dados: { statusLeitura: '2', indicadorPagina: '0' } });
  const c = primeiro(r.dados);
  const lista = (c.listaMensagens || []).map(resumirMensagem);
  return { mensagens: lista, haMais: c.indicadorUltimaPagina === 'N' };
}

async function detalhar(cnpj, isn) {
  const r = await integra.chamar('Consultar', { contribuinte: cnpj, idSistema: 'CAIXAPOSTAL', idServico: 'MSGDETALHAMENTO62', dados: { isn: String(isn) } });
  const m = primeiro(r.dados);
  const variaveis = Array.isArray(m.variaveis) ? m.variaveis : [];
  const corpo = String(m.corpoModelo || '').replace(/\+\+(\d+)\+\+/g, (_, n) => variaveis[Number(n) - 1] ?? '');
  return { ...resumirMensagem(m), corpo_html: corpo };
}

module.exports = { indicador, naoLidas, detalhar };
