// Regras do sistema que viram teste (ideia do template Laravel modular: "a regra é um
// teste, não uma promessa"). Se alguém (pessoa ou IA) quebrar uma delas, o npm test falha.
// Não liga o sistema nem acessa banco. Rodar: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { autenticar, autenticarCliente } = require('../src/middlewares/auth');

const BACKEND = path.join(__dirname, '..');
const RAIZ = path.join(BACKEND, '..');

/** Todas as rotas da API: { metodo, caminho, comLogin } — lidas dos arquivos de rotas como o server.js monta. */
function rotasDaApi() {
  const server = fs.readFileSync(path.join(BACKEND, 'src', 'server.js'), 'utf8');
  const modulos = Object.fromEntries([...server.matchAll(/const (\w+) = require\('(\.\/routes\/\w+)'\);/g)].map((m) => [m[1], m[2]]));
  const rotas = [];
  for (const [, prefixo, alvo] of server.matchAll(/app\.use\('(\/api[^']*)', (\w+(?:\.\w+)?)\);/g)) {
    const [variavel, parte] = alvo.split('.');
    if (!modulos[variavel]) continue;
    const modulo = require(path.join(BACKEND, 'src', modulos[variavel]));
    const router = parte ? modulo[parte] : modulo;
    let protegido = false; // router.use(autenticar) vale para as rotas que vêm depois
    for (const camada of router.stack) {
      if (!camada.route) {
        if (camada.handle === autenticar || camada.handle === autenticarCliente) protegido = true;
        continue;
      }
      const proprio = camada.route.stack.some((s) => s.handle === autenticar || s.handle === autenticarCliente);
      for (const metodo of Object.keys(camada.route.methods)) {
        rotas.push({ metodo: metodo.toUpperCase(), caminho: `${prefixo}${camada.route.path === '/' ? '' : camada.route.path}`, comLogin: protegido || proprio });
      }
    }
  }
  return rotas;
}

// Rotas que de propósito NÃO pedem login. Rota nova sem login precisa entrar aqui (e ser revisada).
const PUBLICAS = [
  'POST /api/auth/login', 'POST /api/auth/esqueci-senha', 'POST /api/auth/redefinir-senha',
  'POST /api/cliente/login', 'POST /api/cliente/esqueci-senha', 'GET /api/cliente/link-senha/:token', 'POST /api/cliente/definir-senha',
  'GET /api/ajuda/cliente/manual', 'POST /api/ajuda/cliente/buscar',
  'POST /api/contatos-site'
];
const PREFIXOS_PUBLICOS = ['/api/rastreio', '/api/planejamento/publico', '/api/mcp']; // links com código (e-mail aberto, questionário) e o conector do Claude (chave própria)

test('toda rota da API pede login, menos as públicas da lista', () => {
  const rotas = rotasDaApi();
  assert.ok(rotas.length > 100, `achei só ${rotas.length} rotas — a leitura do server.js mudou?`);
  const abertas = rotas.filter((r) => !r.comLogin).map((r) => `${r.metodo} ${r.caminho}`)
    .filter((r) => !PUBLICAS.includes(r) && !PREFIXOS_PUBLICOS.some((p) => r.split(' ')[1].startsWith(p)));
  assert.deepEqual(abertas, [], 'rota sem login — se for de propósito, ponha na lista PUBLICAS deste teste');
  for (const p of PUBLICAS) assert.ok(rotas.some((r) => `${r.metodo} ${r.caminho}` === p), `rota pública "${p}" não existe mais: tire da lista`);
});

test('o sistema só LÊ o banco do Domínio (nunca grava)', () => {
  const arquivos = ['src/services/dominioService.js', 'src/services/dominio-consulta.ps1', 'src/services/dominioDemo.js'];
  for (const a of arquivos) {
    const texto = fs.readFileSync(path.join(BACKEND, a), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(\/\/|#).*$/gm, ''); // comentários podem citar as palavras
    const proibido = /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|DROP\s+(TABLE|VIEW)|ALTER\s+TABLE|TRUNCATE|CREATE\s+TABLE)\b/i.exec(texto);
    assert.equal(proibido, null, `${a} tem um comando que grava no Domínio: "${proibido && proibido[0]}"`);
  }
});

test('nenhum segredo vai para o GitHub (.env, certificados, chaves)', (t) => {
  let arquivos;
  try { arquivos = execFileSync('git', ['ls-files'], { cwd: RAIZ, encoding: 'utf8' }).split('\n'); } catch (e) { t.skip('git não disponível'); return; }
  const perigosos = arquivos.filter((a) => /(^|\/)\.env$|\.(pfx|p12|pem|key)$/i.test(a));
  assert.deepEqual(perigosos, []);
});

test('manuais: todo assunto tem resumo e toda imagem citada existe', () => {
  for (const publico of ['equipe', 'cliente']) {
    const pasta = path.join(BACKEND, 'manuais', publico);
    for (const arq of fs.readdirSync(pasta).filter((a) => a.endsWith('.md'))) {
      const texto = fs.readFileSync(path.join(pasta, arq), 'utf8');
      assert.match(texto, /^resumo: .{10,}$/m, `${publico}/${arq} sem "resumo:" no cabeçalho`);
      for (const [, img] of texto.matchAll(/^!\[[^\]]*\]\(([^)]+)\)\s*$/gm)) {
        assert.ok(fs.existsSync(path.join(RAIZ, 'frontend', 'ajuda', 'prints', publico, img)), `${publico}/${arq}: imagem ${img} não existe`);
      }
    }
  }
});

test('permissões: toda permissão usada existe na lista da tela, e toda da lista é usada', () => {
  const { PERMISSOES } = require('../src/config/permissoes');
  const chaves = new Set(PERMISSOES.map((p) => p.chave));
  const textos = [];
  const ler = (pasta, ext) => {
    for (const a of fs.readdirSync(pasta, { withFileTypes: true })) {
      const f = path.join(pasta, a.name);
      if (a.isDirectory()) ler(f, ext); else if (a.name.endsWith(ext)) textos.push([f, fs.readFileSync(f, 'utf8')]);
    }
  };
  ler(path.join(BACKEND, 'src', 'routes'), '.js');
  ler(path.join(RAIZ, 'frontend', 'js'), '.js');
  ler(path.join(RAIZ, 'frontend', 'pages'), '.html');
  const usadas = new Set();
  for (const [f, s] of textos) {
    // chaves têm ponto (ex: empresas.editar); "pode('chave')" de comentário não conta
    for (const [, a, b] of s.matchAll(/(?:permitir|pode)\('(\w+\.\w+)'\)|permissao: '(\w+\.\w+)'/g)) usadas.add(a || b);
    for (const [, lista] of s.matchAll(/data-permissao="([a-z_]+\.[a-z_.,]+)"/g)) lista.split(',').forEach((c) => usadas.add(c.trim()));
    if (f.includes(`${path.sep}routes${path.sep}`)) assert.ok(!/autorizar\(/.test(s), `${path.basename(f)}: use permitir('chave') em vez de autorizar(...) — assim aparece na tela de permissões`);
  }
  for (const c of usadas) assert.ok(chaves.has(c), `permissão "${c}" não existe em config/permissoes.js`);
  for (const c of chaves) assert.ok(usadas.has(c), `permissão "${c}" da lista não é usada em lugar nenhum`);
});
