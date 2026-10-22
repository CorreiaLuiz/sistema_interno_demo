/**
 * Redefine o e-mail e a senha de um administrador direto no banco — para
 * quando ninguém consegue mais entrar no sistema.
 *
 * NÃO rode direto: use o database\redefinir-admin.ps1, que pede a senha
 * sem mostrar na tela e a passa por variável de ambiente (nunca pela
 * linha de comando, que fica no histórico).
 *
 * Variáveis: ADMIN_EMAIL_ATUAL, ADMIN_EMAIL_NOVO, ADMIN_SENHA_NOVA
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const bcrypt = require('bcryptjs');
const { query, pool } = require('../config/db');
const LogAuditoria = require('../models/LogAuditoria');

const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function main() {
  const atual = String(process.env.ADMIN_EMAIL_ATUAL || '').trim().toLowerCase();
  const novo = String(process.env.ADMIN_EMAIL_NOVO || '').trim().toLowerCase() || atual;
  const senha = process.env.ADMIN_SENHA_NOVA || '';

  if (!REGEX_EMAIL.test(atual) || !REGEX_EMAIL.test(novo)) throw new Error('E-mail inválido.');
  if (senha.length < 8) throw new Error('A senha precisa ter pelo menos 8 caracteres.');

  const { rows: [usuario] } = await query(
    `SELECT u.id, u.email FROM usuarios u JOIN roles r ON r.id = u.role_id
     WHERE LOWER(u.email) = $1 AND r.nome = 'administrador'`,
    [atual]
  );
  if (!usuario) throw new Error(`Não existe administrador com o e-mail ${atual}.`);

  if (novo !== atual) {
    const { rows: [outro] } = await query('SELECT id FROM usuarios WHERE LOWER(email) = $1 AND id <> $2', [novo, usuario.id]);
    if (outro) throw new Error(`O e-mail ${novo} já é usado por outro usuário do sistema.`);
  }

  const hash = await bcrypt.hash(senha, 10);
  await query('UPDATE usuarios SET email = $2, senha_hash = $3, ativo = TRUE WHERE id = $1', [usuario.id, novo, hash]);
  await LogAuditoria.registrar({
    usuarioId: usuario.id, acao: 'UPDATE', entidade: 'usuario', entidadeId: usuario.id,
    detalhes: { acao_especifica: 'admin_redefinido_pelo_servidor', email_anterior: atual, email_novo: novo }
  });

  // Confere que a senha nova entra
  const { rows: [conferido] } = await query('SELECT senha_hash FROM usuarios WHERE id = $1', [usuario.id]);
  if (!(await bcrypt.compare(senha, conferido.senha_hash))) throw new Error('A conferência da senha falhou.');

  console.log(`OK: administrador agora entra com ${novo}`);
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('ERRO: ' + err.message);
    await pool.end().catch(() => {});
    process.exit(1);
  });
