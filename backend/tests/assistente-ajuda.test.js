// Assistente de ajuda: manuais, busca e o pedido à IA (Claude) — a IA é SIMULADA: sem internet e sem custo.
const test = require('node:test');
const assert = require('node:assert/strict');
const ajuda = require('../src/services/ajudaService');

const PUBLICOS = ['equipe', 'cliente'];

test('manuais: cada seção tem id único, título e conteúdo', () => {
  for (const p of PUBLICOS) {
    const secoes = ajuda.carregarManual(p);
    assert.ok(secoes.length >= 5, `manual ${p} vazio`);
    const ids = secoes.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, `id repetido no manual ${p}`);
    for (const s of secoes) assert.ok(s.titulo && s.markdown.length > 100, `seção ${s.id} sem conteúdo`);
  }
});

test('manual do cliente não fala de telas internas da equipe', () => {
  const texto = ajuda.manualParaIa('cliente').toLowerCase();
  for (const interno of ['caixa postal da receita', 'conferência bancária', 'auditoria', 'importar guias', 'integra contador']) {
    assert.ok(!texto.includes(interno), `manual do cliente cita "${interno}"`);
  }
});

test('Markdown vira HTML seguro: escapa HTML e só aceita links do sistema ou https', () => {
  const html = ajuda.renderizar('Texto <script>alert(1)</script> **forte**\n\n1. um\n2. dois\n\n> dica\n\n[ruim](javascript:alert(1)) [bom](/pages/ajuda.html)', 'equipe');
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('<strong>forte</strong>'));
  assert.ok(html.includes('<ol>') && /<li>dois\s*<\/li><\/ol>/.test(html));
  assert.ok(html.includes('class="ajuda-dica"'));
  assert.ok(!/href="javascript/i.test(html));
  assert.ok(html.includes('href="/pages/ajuda.html"'));
});

test('itálico com um asterisco; BC × 8% não vira itálico', () => {
  assert.equal(ajuda.renderizar('abas *Geral* e *Produtos* e **forte**', 'equipe'), '<p>abas <em>Geral</em> e <em>Produtos</em> e <strong>forte</strong></p>');
  assert.equal(ajuda.renderizar('Imposto = BC * 8% e 2*3', 'equipe'), '<p>Imposto = BC * 8% e 2*3</p>');
});

test('sub-itens ficam dentro do passo e a numeração continua', () => {
  const html = ajuda.renderizar('1. um\n2. dois\n   - a\n   - b\n3. três', 'equipe').replace(/\s+/g, '');
  assert.equal(html, '<ol><li>um</li><li>dois<ul><li>a</li><li>b</li></ul></li><li>três</li></ol>');
});

test('imagem que não existe não aparece quebrada', () => {
  const html = ajuda.renderizar('![Legenda](nao-existe-123.png)', 'equipe');
  assert.equal(html, '');
});

test('busca: perguntas comuns caem no assunto certo', () => {
  const casos = [
    ['equipe', 'como mando a guia pro cliente', 'importar-guias'],
    ['equipe', 'intimação no ecac', 'caixa-postal'],
    ['equipe', 'como cadastro um usuario novo', 'usuarios-auditoria'],
    ['equipe', 'liberar acesso do cliente ao portal', 'liberar-area-cliente'],
    ['equipe', 'compensa mudar para o lucro presumido', 'planejamento'],
    ['cliente', 'onde baixo minha guia', 'documentos-guias'],
    ['cliente', 'esqueci a senha', 'esqueci-senha'],
    ['cliente', 'preciso da segunda via do das', 'pedidos'],
    ['cliente', 'telefone do escritorio', 'contato']
  ];
  for (const [p, pergunta, esperado] of casos) {
    assert.equal((ajuda.buscar(p, pergunta)[0] || {}).id, esperado, `"${pergunta}"`);
  }
  assert.deepEqual(ajuda.buscar('equipe', 'xyzw qwerty'), []);
});

test('histórico da conversa: só texto, alternado, termina na resposta, no máximo 8', () => {
  const h = ajuda.limparHistorico([
    { papel: 'assistente', texto: 'oi' }, { papel: 'usuario', texto: 'a' }, { papel: 'usuario', texto: 'b' },
    { papel: 'assistente', texto: 'c' }, { papel: 'sistema', texto: 'ignorar' }, { papel: 'usuario', texto: 'd' }
  ]);
  assert.deepEqual(h, [{ role: 'user', content: 'b' }, { role: 'assistant', content: 'c' }]);
  assert.deepEqual(ajuda.limparHistorico('lixo'), []);
});

/** Cliente da API de mentira: grava os pedidos e responde o que o teste mandar. */
function iaFalsa(t, responder) {
  const pedidos = [];
  const criar = async (p) => { pedidos.push(p); return responder(p, pedidos.length); };
  ajuda._definirClienteIa({ beta: { messages: { create: criar } }, messages: { create: criar } });
  t.after(() => ajuda._definirClienteIa(null));
  return pedidos;
}
const resposta = (json, extra = {}) => ({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(json) }], usage: { input_tokens: 10, output_tokens: 20 }, ...extra });

test('IA: manda o manual certo, cacheado, com contexto e formato fixo; devolve seções com imagens', async (t) => {
  const pedidos = iaFalsa(t, () => resposta({ resposta: '1. Abra **Importar guias**.', secoes: ['importar-guias', 'inventada'] }));
  const r = await ajuda.responder({ publico: 'equipe', pergunta: 'Como mando guias?', contexto: 'pessoa X', historico: [{ papel: 'usuario', texto: 'oi' }, { papel: 'assistente', texto: 'olá' }] });
  const p = pedidos[0];
  assert.equal(p.model, 'claude-opus-5-5');
  assert.equal(p.fallbacks, 'default');
  assert.deepEqual(p.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(p.output_config.effort, 'low');
  assert.equal(p.output_config.format.type, 'json_schema');
  assert.equal(p.system[0].cache_control.type, 'ephemeral');
  assert.ok(p.system[0].text.includes('<secao id="importar-guias"'));
  assert.ok(!/Date|\d{2}:\d{2}:\d{2}/.test(p.system[0].text.slice(0, 400)), 'nada variável no começo do system (quebra o cache)');
  assert.equal(p.messages.length, 3);
  assert.ok(p.messages[2].content.includes('[Contexto: pessoa X]') && p.messages[2].content.includes('Como mando guias?'));
  assert.equal(r.modo, 'ia');
  assert.deepEqual(r.secoes.map((s) => s.id), ['importar-guias'], 'seção inventada pela IA é descartada');
});

test('IA do cliente nunca recebe o manual da equipe', async (t) => {
  const pedidos = iaFalsa(t, () => resposta({ resposta: 'ok', secoes: [] }));
  await ajuda.responder({ publico: 'cliente', pergunta: 'Onde vejo a guia?' });
  assert.ok(pedidos[0].system[0].text.includes('Área do Cliente'));
  assert.ok(!pedidos[0].system[0].text.includes('<secao id="caixa-postal"'));
});

test('IA: se a API recusar o parâmetro de reserva, tenta sem ele', async (t) => {
  const Anthropic = require('@anthropic-ai/sdk').default;
  const pedidos = iaFalsa(t, (p, n) => {
    if (n === 1) throw new Anthropic.BadRequestError(400, { error: { message: 'fallbacks: not supported' } }, 'fallbacks: not supported', new Headers());
    return resposta({ resposta: 'ok', secoes: [] });
  });
  const r = await ajuda.responder({ publico: 'equipe', pergunta: 'teste' });
  assert.equal(r.modo, 'ia');
  assert.equal(pedidos[1].fallbacks, undefined);
});

test('IA fora do ar, recusa ou resposta estranha → responde pela busca no manual', async (t) => {
  iaFalsa(t, () => { throw new Error('sem internet'); });
  let r = await ajuda.responder({ publico: 'cliente', pergunta: 'esqueci a senha' });
  assert.equal(r.modo, 'busca');
  assert.equal(r.secoes[0].id, 'esqueci-senha');
  assert.match(r.resposta, /indisponível/);

  iaFalsa(t, () => ({ stop_reason: 'refusal', content: [] }));
  r = await ajuda.responder({ publico: 'cliente', pergunta: 'esqueci a senha' });
  assert.equal(r.modo, 'busca');

  iaFalsa(t, () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'não é json' }] }));
  r = await ajuda.responder({ publico: 'cliente', pergunta: 'esqueci a senha' });
  assert.equal(r.modo, 'busca');
});

const MEMORIA = [
  { id: 'm1', pergunta: 'Como troco o e-mail que recebe as guias?\nmudar email das guias do cliente', resposta: 'Abra a empresa e mude o **E-mail**.', secoes: ['empresas'] },
  { id: 'm2', pergunta: 'Quem aprova as férias?', resposta: 'O supervisor da Folha.', secoes: [] }
];

test('memória: acha a resposta ensinada só quando a pergunta é bem parecida', () => {
  assert.equal(ajuda.acharNaMemoria('como troco o email que recebe as guias', MEMORIA).id, 'm1');
  assert.equal(ajuda.acharNaMemoria('Preciso mudar o e-mail das guias do cliente', MEMORIA).id, 'm1', 'segunda forma de perguntar');
  assert.equal(ajuda.acharNaMemoria('quem aprova as ferias?', MEMORIA).id, 'm2');
  assert.equal(ajuda.acharNaMemoria('como mando as guias', MEMORIA), null, 'parecida demais por pouco: não usa');
  assert.equal(ajuda.acharNaMemoria('férias', MEMORIA), null, 'uma palavra só não basta');
  assert.equal(ajuda.acharNaMemoria('', MEMORIA), null);
});

test('memória: responde com a resposta ensinada sem chamar a IA; sem achar, a IA recebe a memória', async (t) => {
  const pedidos = iaFalsa(t, () => resposta({ resposta: 'ok', secoes: [] }));
  const r = await ajuda.responder({ publico: 'equipe', pergunta: 'Como troco o e-mail que recebe as guias?', memoria: MEMORIA });
  assert.equal(r.modo, 'memoria');
  assert.equal(r.memoriaId, 'm1');
  assert.match(r.resposta, /\*\*E-mail\*\*/);
  assert.equal(pedidos.length, 0, 'não gastou IA');

  await ajuda.responder({ publico: 'equipe', pergunta: 'Como crio uma tarefa?', memoria: MEMORIA });
  assert.equal(pedidos.length, 1);
  assert.equal(pedidos[0].system[0].cache_control.type, 'ephemeral', 'manual continua no cache');
  assert.ok(pedidos[0].system[1].text.includes('Quem aprova as férias?'), 'memória vai depois do manual');
});

test('sem a chave da IA, responde pela busca', async () => {
  const antes = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  ajuda._definirClienteIa(null);
  try {
    assert.equal(ajuda.iaConfigurada(), false);
    const r = await ajuda.responder({ publico: 'equipe', pergunta: 'como libero a área do cliente' });
    assert.equal(r.modo, 'busca');
    assert.equal(r.secoes[0].id, 'liberar-area-cliente');
  } finally {
    if (antes !== undefined) process.env.ANTHROPIC_API_KEY = antes;
  }
});
