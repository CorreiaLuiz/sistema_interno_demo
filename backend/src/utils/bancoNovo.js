/**
 * Monta o banco de dados do zero num computador novo: cria o banco (se faltar),
 * roda o schema.sql e todas as migrações da 009 em diante, em ordem.
 * Execute com: npm run banco:novo
 *
 * Só funciona num banco VAZIO — se já existirem tabelas, para sem mexer em nada
 * (num banco em uso, rode só a migração nova com o psql).
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const PASTA_BANCO = path.join(__dirname, '..', '..', '..', 'database');
const nomeBanco = process.env.DB_NAME;
const conexao = (database) => new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database
});

async function main() {
  if (!nomeBanco || !/^[a-z_][a-z0-9_]*$/i.test(nomeBanco)) throw new Error('Preencha DB_NAME no .env (só letras, números e _).');

  const admin = conexao('postgres');
  const { rows } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [nomeBanco]);
  if (!rows.length) {
    await admin.query(`CREATE DATABASE ${nomeBanco}`);
    console.log(`Banco "${nomeBanco}" criado.`);
  }
  await admin.end();

  const db = conexao(nomeBanco);
  try {
    const { rows: [{ total }] } = await db.query(`SELECT COUNT(*)::int AS total FROM information_schema.tables WHERE table_schema = 'public'`);
    if (total > 0) {
      console.error(`O banco "${nomeBanco}" já tem ${total} tabela(s). Nada foi feito.`);
      console.error('Para atualizar um banco em uso, rode só a migração nova (veja INSTALACAO-NOTEBOOK.md).');
      process.exitCode = 1;
      return;
    }
    const ler = (arq) => fs.readFileSync(arq, 'utf8').replace(/^﻿/, '');
    await db.query(ler(path.join(PASTA_BANCO, 'schema.sql')));
    console.log('ok  schema.sql');
    // O schema.sql já inclui até a 008
    const pasta = path.join(PASTA_BANCO, 'migrations');
    for (const m of fs.readdirSync(pasta).filter((f) => /^\d{3}_.*\.sql$/.test(f) && Number(f.slice(0, 3)) >= 9).sort()) {
      await db.query(ler(path.join(pasta, m)));
      console.log(`ok  ${m}`);
    }
    console.log('\nBanco pronto. Agora rode: npm run seed:admin');
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error('Falhou:', err.message);
  process.exitCode = 1;
});
