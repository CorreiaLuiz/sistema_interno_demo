// @ts-check
const { query } = require('../config/db');

const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Para quem vão os e-mails de uma empresa cliente: o e-mail do cadastro
 * da empresa + os logins ativos da Área do Cliente (sem repetir).
 */
async function emailsDaEmpresa(empresaId) {
  const { rows } = await query(
    `SELECT e.email FROM empresas e WHERE e.id = $1
     UNION
     SELECT c.email FROM clientes_portal_empresas ce JOIN clientes_portal c ON c.id = ce.cliente_id
     WHERE ce.empresa_id = $1 AND c.ativo`,
    [empresaId]
  );
  return [...new Set(rows.map((r) => String(r.email || '').trim().toLowerCase()).filter((e) => REGEX_EMAIL.test(e)))];
}

module.exports = { emailsDaEmpresa, REGEX_EMAIL };
