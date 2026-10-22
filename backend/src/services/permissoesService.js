// @ts-check
/**
 * Permissões por perfil: padrão do código (config/permissoes.js) + o que o
 * administrador mudou na tela (tabela permissoes_perfil). Guardado em memória
 * por 1 minuto; salvar limpa na hora.
 */

const { query } = require('../config/db');
const { PERMISSOES, PERFIS } = require('../config/permissoes');

const PAPEIS_VALIDOS = new Set(PERFIS.map((p) => p.papel));
const POR_CHAVE = new Map(PERMISSOES.map((p) => [p.chave, p]));
const VALIDADE_MS = 60 * 1000;

/** @type {{ mapa: Map<string, string[]> | null, em: number }} */
let cache = { mapa: null, em: 0 };

/** Papéis (além do administrador) que têm cada permissão. */
async function mapaAtual() {
  if (cache.mapa && Date.now() - cache.em < VALIDADE_MS) return cache.mapa;
  const { rows } = await query('SELECT chave, papeis FROM permissoes_perfil');
  const mudadas = new Map(rows.map((r) => [r.chave, r.papeis || []]));
  const mapa = new Map(PERMISSOES.map((p) => [p.chave, p.soAdmin ? [] : (mudadas.get(p.chave) || p.padrao)]));
  cache = { mapa, em: Date.now() };
  return mapa;
}

function limparCache() { cache = { mapa: null, em: 0 }; }

async function pode(papel, chave) {
  if (!POR_CHAVE.has(chave)) throw new Error(`Permissão desconhecida: ${chave}`);
  if (papel === 'administrador') return true;
  return ((await mapaAtual()).get(chave) || []).includes(papel);
}

/** Chaves que um perfil tem (para as telas esconderem o que a pessoa não pode usar). */
async function permissoesDoPapel(papel) {
  if (papel === 'administrador') return PERMISSOES.map((p) => p.chave);
  const mapa = await mapaAtual();
  return PERMISSOES.filter((p) => (mapa.get(p.chave) || []).includes(papel)).map((p) => p.chave);
}

/** Tudo para a tela: catálogo, perfis e quem tem o quê (marcando o que difere do padrão). */
async function matriz() {
  const mapa = await mapaAtual();
  return {
    perfis: PERFIS,
    permissoes: PERMISSOES.map((p) => ({
      chave: p.chave, grupo: p.grupo, rotulo: p.rotulo, soAdmin: Boolean(p.soAdmin),
      papeis: mapa.get(p.chave) || [],
      padrao: p.padrao,
      mudada: !p.soAdmin && [...(mapa.get(p.chave) || [])].sort().join() !== [...p.padrao].sort().join()
    }))
  };
}

/**
 * Grava as mudanças: { chave: [papeis] }. Igual ao padrão = apaga a linha (volta a
 * seguir o código). Devolve a lista do que mudou, para a auditoria.
 */
async function salvar(mudancas, usuarioId) {
  const atual = await mapaAtual();
  const feitas = [];
  for (const [chave, lista] of Object.entries(mudancas || {})) {
    const p = POR_CHAVE.get(chave);
    if (!p) throw Object.assign(new Error(`Permissão desconhecida: ${chave}`), { status: 400 });
    if (p.soAdmin) continue;
    const papeis = [...new Set([].concat(lista || []).map(String))].filter((x) => PAPEIS_VALIDOS.has(x)).sort();
    const antes = [...(atual.get(chave) || [])].sort();
    if (papeis.join() === antes.join()) continue;
    if (papeis.join() === [...p.padrao].sort().join()) {
      await query('DELETE FROM permissoes_perfil WHERE chave = $1', [chave]);
    } else {
      await query(
        `INSERT INTO permissoes_perfil (chave, papeis, atualizado_por, atualizado_em) VALUES ($1, $2, $3, NOW())
         ON CONFLICT (chave) DO UPDATE SET papeis = EXCLUDED.papeis, atualizado_por = EXCLUDED.atualizado_por, atualizado_em = NOW()`,
        [chave, papeis, usuarioId]
      );
    }
    feitas.push({ chave, antes, depois: papeis });
  }
  limparCache();
  return feitas;
}

module.exports = { pode, permissoesDoPapel, matriz, salvar, limparCache, PERMISSOES };
