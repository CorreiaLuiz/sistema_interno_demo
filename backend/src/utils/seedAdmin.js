/**
 * Script utilitário para criar o primeiro usuário administrador do sistema.
 * Execute com: npm run seed:admin
 * Lê as credenciais padrão do .env (ADMIN_EMAIL, ADMIN_SENHA, ADMIN_NOME).
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { query, pool } = require('../config/db');

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const senha = process.env.ADMIN_SENHA;
  const nome = process.env.ADMIN_NOME || 'Administrador';

  if (!email || !senha) {
    console.error('Defina ADMIN_EMAIL e ADMIN_SENHA no arquivo .env antes de rodar este script.');
    process.exit(1);
  }

  const { rows: existentes } = await query('SELECT id FROM usuarios WHERE email = $1', [email]);
  if (existentes[0]) {
    console.log(`Usuário administrador "${email}" já existe. Nada foi feito.`);
    await pool.end();
    return;
  }

  const { rows: roles } = await query("SELECT id FROM roles WHERE nome = 'administrador'");
  if (!roles[0]) {
    console.error('Role "administrador" não encontrada. Rode o schema.sql primeiro.');
    process.exit(1);
  }

  const senhaHash = await bcrypt.hash(senha, 10);

  await query(
    'INSERT INTO usuarios (nome, email, senha_hash, role_id) VALUES ($1, $2, $3, $4)',
    [nome, email, senhaHash, roles[0].id]
  );

  console.log(`Usuário administrador criado com sucesso: ${email}`);
  console.log('IMPORTANTE: altere a senha padrão assim que possível.');
  await pool.end();
}

main().catch((err) => {
  console.error('Erro ao criar usuário administrador:', err);
  process.exit(1);
});
