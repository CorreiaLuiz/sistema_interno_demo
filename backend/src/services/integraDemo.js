/**
 * Integra Contador SIMULADO para a demonstração (MODO_DEMO=true): responde no
 * mesmo formato do SERPRO, com dados fictícios, para as telas de DAS da Receita,
 * Situação fiscal e Caixa Postal funcionarem sem contrato nem certificado.
 *
 * Regra da demonstração (igual à CND): CNPJ terminado em 9 tem pendência na
 * Receita e mensagens novas na Caixa Postal; os outros estão em dia.
 */
const { query } = require('../config/db');
const { pdfTexto, pdfDas } = require('../demo/pdf');

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const dois = (n) => String(n).padStart(2, '0');
const dataBR = (d) => `${dois(d.getDate())}/${dois(d.getMonth() + 1)}/${d.getFullYear()}`;
const dataSerpro = (d) => `${d.getFullYear()}${dois(d.getMonth() + 1)}${dois(d.getDate())}`;
const diasAtras = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
const comPendencia = (cnpj) => cnpj.endsWith('9');
const b64 = (buf) => Buffer.from(buf).toString('base64');

async function razaoSocial(cnpj) {
  const { rows } = await query(`SELECT razao_social FROM empresas WHERE regexp_replace(cnpj, '\\D', '', 'g') = $1 LIMIT 1`, [cnpj]);
  return rows[0] ? rows[0].razao_social : 'EMPRESA DE DEMONSTRAÇÃO LTDA';
}
const cnpjFormatado = (c) => `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;

const MENSAGENS = [
  { isn: '9001', assuntoModelo: 'Termo de Intimação - ++VARIAVEL++', valorParametroAssunto: 'Malha Fiscal PJ', dias: 2, relevancia: '2', indicadorAnexos: '1',
    corpo: '<p>Prezado contribuinte,</p><p>Fica intimado a apresentar, no prazo de <b>20 dias</b>, os documentos que comprovem as receitas declaradas no PGDAS-D do período de ++1++.</p><p>Mensagem fictícia da demonstração.</p>', variaveis: ['janeiro a março'] },
  { isn: '9002', assuntoModelo: 'Aviso de débito do Simples Nacional', dias: 9, relevancia: '1', indicadorAnexos: '0',
    corpo: '<p>Constam débitos em aberto do Simples Nacional. Regularize para evitar a exclusão do regime.</p><p>Mensagem fictícia da demonstração.</p>', variaveis: [] }
];

async function responder(grupo, { contribuinte, idServico, dados }) {
  const cnpj = String(contribuinte || '').replace(/\D/g, '');
  const p = typeof dados === 'string' && dados ? JSON.parse(dados) : dados || {};

  if (idServico === 'GERARDAS12' || idServico === 'GERARDASPDF21') {
    const pa = String(p.periodoApuracao || '');
    const ano = Number(pa.slice(0, 4)); const mes = Number(pa.slice(4, 6));
    const venc = new Date(ano, mes, 20);
    const valor = (300 + (Number(cnpj.slice(-4)) % 2700) + mes * 13.37).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const pdf = pdfDas({ cnpj: cnpjFormatado(cnpj), razao: (await razaoSocial(cnpj)).toUpperCase(), mesExtenso: `${MESES[mes - 1]}/${ano}`,
      vencimento: dataBR(venc), valor, numero: `07.20.${String(ano).slice(2)}${dois(mes)}9.${cnpj.slice(-7)}-${mes % 10}` });
    return { status: 200, dados: [{ pdf: b64(pdf) }], mensagens: [{ codigo: 'Sucesso-PGDASD', texto: 'Requisição efetuada com sucesso.' }] };
  }

  if (idServico === 'SOLICITARPROTOCOLO91') return { status: 200, dados: { protocoloRelatorio: 'DEMO', tempoEspera: 1000 }, mensagens: [] };

  if (idServico === 'RELATORIOSITFIS92') {
    const razao = await razaoSocial(cnpj);
    const linhas = [
      { texto: 'MINISTÉRIO DA FAZENDA', negrito: true, tamanho: 12 },
      { texto: 'Informações de Apoio para Emissão de Certidão', negrito: true, tamanho: 13 },
      `CNPJ: ${cnpjFormatado(cnpj)} - ${razao}`,
      ''
    ];
    if (comPendencia(cnpj)) {
      linhas.push({ texto: 'Pendência - Débito (SIEF) ________________', negrito: true },
        'Código 1001 - Simples Nacional - PA 08/2026 - Saldo devedor R$ 1.234,56 (fictício)',
        { texto: 'Pendência - Omissão de DCTF ________________', negrito: true },
        'Período 07/2026 (fictício)');
    } else {
      const emissao = diasAtras(12); const validade = new Date(emissao); validade.setDate(validade.getDate() + 180);
      linhas.push('Certidão Negativa emitida com o código de controle: A1B2.C3D4.E5F6.7890',
        'Emissão: ' + dataBR(emissao) + ' Data de Validade: ' + dataBR(validade),
        'Diagnóstico Fiscal na Receita Federal',
        'Não foram detectadas pendências/exigibilidades suspensas nos controles da Receita Federal.',
        'Não foram detectadas pendências/exigibilidades suspensas nos controles da',
        'Procuradoria-Geral da Fazenda Nacional.');
    }
    return { status: 200, dados: { pdf: b64(pdfTexto(linhas)) }, mensagens: [] };
  }

  if (idServico === 'INNOVAMSG63') return { status: 200, dados: { conteudo: [{ indicadorMensagensNovas: comPendencia(cnpj) ? '2' : '0' }] }, mensagens: [] };

  if (idServico === 'MSGCONTRIBUINTE61') {
    const lista = comPendencia(cnpj) ? MENSAGENS.map((m) => ({ ...m, dataEnvio: dataSerpro(diasAtras(m.dias)), dataCiencia: dataSerpro(diasAtras(m.dias - 45)), descricaoOrigem: 'RECEITA FEDERAL DO BRASIL' })) : [];
    return { status: 200, dados: { conteudo: [{ listaMensagens: lista, indicadorUltimaPagina: 'S' }] }, mensagens: [] };
  }

  if (idServico === 'MSGDETALHAMENTO62') {
    const m = MENSAGENS.find((x) => x.isn === String(p.isn)) || MENSAGENS[0];
    return { status: 200, dados: { conteudo: [{ ...m, dataEnvio: dataSerpro(diasAtras(m.dias)), dataCiencia: dataSerpro(diasAtras(m.dias - 45)), descricaoOrigem: 'RECEITA FEDERAL DO BRASIL', corpoModelo: m.corpo }] }, mensagens: [] };
  }

  return { status: 200, dados: null, mensagens: [{ codigo: 'Demo', texto: `Serviço ${grupo}/${idServico} não simulado na demonstração.` }] };
}

module.exports = { responder };
