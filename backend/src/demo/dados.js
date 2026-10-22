/**
 * Dados FICTÍCIOS da demonstração. Nenhuma empresa, CNPJ ou pessoa daqui
 * existe de verdade (os CNPJs só têm dígitos verificadores válidos).
 *
 * Usado pelo `npm run demo:preparar` (cadastros, pastas e extratos) e pelo
 * "Domínio de demonstração" (dominioDemo.js), que responde à conferência
 * bancária com os mesmos números — para as telas fazerem sentido juntas.
 */

/** CNPJ válido a partir de 8 dígitos de base + filial 0001. */
function gerarCnpj(base8) {
  const n = `${base8}0001`.split('').map(Number);
  const dv = (nums, pesos) => {
    const s = nums.reduce((t, d, i) => t + d * pesos[i], 0) % 11;
    return s < 2 ? 0 : 11 - s;
  };
  const d1 = dv(n, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = dv([...n, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const c = `${base8}0001${d1}${d2}`;
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
}

// cenarios: um por mês (1 a 12) — ok | falta_importar | diferenca | sem_ofx | sem_nada
const EMPRESAS = [
  {
    chave: 'alfa', codigoDominio: 101, razao: 'Alfa Comércio de Materiais Ltda', fantasia: 'Alfa Materiais',
    cnpj: gerarCnpj('41528037'), regime: 'simples_nacional', cidade: 'Francisco Beltrão', uf: 'PR', situacao: 'ativa',
    email: 'financeiro@alfa-demo.com.br', telefone: '(46) 3000-0001', responsavel: 'A',
    contas: [
      { codi: 5, clas: '1110201', nome: 'BANCO SICREDI C/C 12345-6', banco: '748', agencia: '0101', numero: '123456',
        cenarios: ['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'falta_importar', 'sem_nada'] },
      { codi: 6, clas: '1110202', nome: 'BANCO DO BRASIL C/C 98765-4', banco: '001', agencia: '2222', numero: '987654',
        cenarios: ['ok', 'ok', 'ok', 'ok', 'diferenca', 'ok', 'ok', 'ok', 'ok'] }
    ]
  },
  {
    chave: 'beta', codigoDominio: 102, razao: 'Beta Serviços de Engenharia Ltda', fantasia: 'Beta Engenharia',
    cnpj: gerarCnpj('52639148'), regime: 'lucro_presumido', cidade: 'Pato Branco', uf: 'PR', situacao: 'ativa',
    email: 'contato@beta-demo.com.br', telefone: '(46) 3000-0002', responsavel: 'B',
    contas: [
      { codi: 5, clas: '1110201', nome: 'SICOOB C/C 55443-2', banco: '756', agencia: '3030', numero: '554432',
        cenarios: ['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok'] }
    ]
  },
  {
    chave: 'padaria', codigoDominio: 103, razao: 'Padaria Pão Dourado Ltda', fantasia: 'Pão Dourado',
    cnpj: gerarCnpj('63740259'), regime: 'simples_nacional', cidade: 'Francisco Beltrão', uf: 'PR', situacao: 'ativa',
    email: 'paodourado@demo.com.br', telefone: '(46) 3000-0003', responsavel: 'A',
    contas: [
      { codi: 5, clas: '1110201', nome: 'BANCO CRESOL C/C 77001-0', banco: '133', agencia: '4040', numero: '770010',
        cenarios: ['ok', 'ok', 'ok', 'ok', 'ok', 'sem_ofx', 'sem_ofx', 'falta_importar', 'falta_importar'] }
    ]
  },
  {
    chave: 'horizonte', codigoDominio: 104, razao: 'Construtora Horizonte Ltda', fantasia: 'Horizonte',
    cnpj: gerarCnpj('74851360'), regime: 'lucro_real', cidade: 'Cascavel', uf: 'PR', situacao: 'ativa',
    email: 'adm@horizonte-demo.com.br', telefone: '(45) 3000-0004', responsavel: 'C',
    contas: [
      { codi: 5, clas: '1110201', nome: 'BANCO ITAU C/C 33221-9', banco: '341', agencia: '5050', numero: '332219',
        cenarios: ['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok'] },
      { codi: 7, clas: '1110202', nome: 'BANCO BRADESCO C/C 44112-7', banco: '237', agencia: '6060', numero: '441127',
        cenarios: ['ok', 'ok', 'ok', 'diferenca', 'ok', 'ok', 'ok', 'ok', 'sem_nada'] }
    ]
  },
  {
    chave: 'mercado', codigoDominio: 105, razao: 'Mercado Bom Preço Ltda', fantasia: 'Bom Preço',
    cnpj: gerarCnpj('85962471'), regime: 'simples_nacional', cidade: 'Dois Vizinhos', uf: 'PR', situacao: 'ativa',
    email: 'mercado@bompreco-demo.com.br', telefone: '(46) 3000-0005', responsavel: 'D',
    contas: [
      { codi: 5, clas: '1110201', nome: 'SICREDI C/C 88990-1', banco: '748', agencia: '0707', numero: '889901',
        cenarios: ['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'falta_importar'] }
    ]
  },
  {
    chave: 'clinica', codigoDominio: 106, razao: 'Clínica Vida Plena Ltda', fantasia: 'Vida Plena',
    cnpj: gerarCnpj('96173582'), regime: 'lucro_presumido', cidade: 'Francisco Beltrão', uf: 'PR', situacao: 'ativa',
    email: 'clinica@vidaplena-demo.com.br', telefone: '(46) 3000-0006', responsavel: 'B', contas: []
  },
  {
    chave: 'transportes', codigoDominio: null, razao: 'Transportes Rota Sul Ltda', fantasia: 'Rota Sul',
    cnpj: gerarCnpj('17284693'), regime: 'simples_nacional', cidade: 'Marmeleiro', uf: 'PR', situacao: 'em_legalizacao',
    email: 'rotasul@demo.com.br', telefone: '(46) 3000-0007', responsavel: null, contas: []
  },
  {
    chave: 'tech', codigoDominio: null, razao: 'Tech Nova Sistemas Ltda', fantasia: 'Tech Nova',
    cnpj: gerarCnpj('28395704'), regime: 'simples_nacional', cidade: 'Pato Branco', uf: 'PR', situacao: 'em_legalizacao',
    email: 'contato@technova-demo.com.br', telefone: '(46) 3000-0008', responsavel: null, contas: []
  }
];

// Gerador de números "aleatórios" sempre iguais (a demo fica igual em toda instalação)
function sorteio(semente) {
  let s = semente >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const HISTORICOS_ENTRADA = ['PIX RECEBIDO CLIENTE', 'DEPOSITO', 'TED RECEBIDA', 'RECEBIMENTO BOLETO', 'VENDAS CARTAO'];
const HISTORICOS_SAIDA = ['PAGAMENTO FORNECEDOR', 'PIX ENVIADO', 'TARIFA BANCARIA', 'PAGAMENTO DAS', 'FOLHA DE PAGAMENTO', 'ENERGIA ELETRICA'];

/** Lançamentos do mês de uma conta (iguais no OFX e no Domínio). */
function transacoesDoMes(empresa, conta, ano, mes) {
  const r = sorteio(empresa.codigoDominio * 1000 + conta.codi * 100 + mes);
  const qtd = 5 + Math.floor(r() * 5);
  const lista = [];
  for (let i = 0; i < qtd; i++) {
    const entrada = r() < 0.45;
    const valor = Math.round((entrada ? 800 + r() * 9000 : 90 + r() * 4200) * 100) / 100;
    const dia = Math.min(28, 1 + Math.floor(r() * 28));
    const hist = entrada ? HISTORICOS_ENTRADA[Math.floor(r() * HISTORICOS_ENTRADA.length)] : HISTORICOS_SAIDA[Math.floor(r() * HISTORICOS_SAIDA.length)];
    lista.push({ data: `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`, valor: entrada ? valor : -valor, historico: hist, fitid: `${conta.numero}${mes}${i}` });
  }
  return lista.sort((a, b) => a.data.localeCompare(b.data));
}

// Meses além dos definidos (ex: demo usada no ano seguinte) saem conferidos
const cenarioDoMes = (conta, mes) => conta.cenarios[mes - 1] || 'ok';

module.exports = { EMPRESAS, gerarCnpj, transacoesDoMes, cenarioDoMes, sorteio };
