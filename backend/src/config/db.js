const { Pool } = require('pg');
require('dotenv').config();

// Pool de conexões — reutilizado em toda a aplicação.
// Evita abrir/fechar conexões a cada requisição.
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 10,                      // número máximo de conexões simultâneas
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

pool.on('error', (err) => {
  console.error('Erro inesperado no pool de conexões do PostgreSQL:', err);
});

// Helper simples para queries — permite logar/instrumentar tudo em um único lugar.
async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (process.env.NODE_ENV === 'development') {
    console.log('SQL executado', { text, duration, linhas: res.rowCount });
  }
  return res;
}

module.exports = { pool, query };
