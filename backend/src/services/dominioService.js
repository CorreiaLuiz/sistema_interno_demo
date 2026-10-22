const { spawn } = require('child_process');
const path = require('path');

/**
 * Leitura do banco do Domínio (Sybase SQL Anywhere, via ODBC do Windows).
 * Não há driver ODBC nativo no Node sem compilar, então cada chamada abre
 * um PowerShell que usa o System.Data.Odbc do .NET — o mesmo caminho das
 * consultas que já rodam no escritório. SOMENTE LEITURA: o script recusa
 * qualquer coisa que não seja um único SELECT.
 */
const { MODO_DEMO } = require('../config/demo');

const SCRIPT = path.join(__dirname, 'dominio-consulta.ps1');
const TEMPO_LIMITE_MS = 180000;

function dominioConfigurado() {
  if (MODO_DEMO) return true;
  return !!(process.env.DOMINIO_DSN && process.env.DOMINIO_USUARIO && process.env.DOMINIO_SENHA);
}

/**
 * Executa várias consultas de uma vez (uma só conexão).
 * consultas: { nome: 'select ...' }  →  { nome: [[...linha], ...] }
 */
function consultarDominio(consultas) {
  // Demonstração: responde com os dados fictícios (src/demo/dados.js)
  if (MODO_DEMO) return require('./dominioDemo').consultarDominioDemo(consultas);
  if (!dominioConfigurado()) {
    return Promise.reject(new Error('Acesso ao Domínio não configurado (DOMINIO_DSN, DOMINIO_USUARIO e DOMINIO_SENHA no .env).'));
  }
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT], {
      env: process.env,
      windowsHide: true
    });
    let saida = '';
    let erros = '';
    const timer = setTimeout(() => {
      ps.kill();
      reject(new Error('O Domínio demorou demais para responder.'));
    }, TEMPO_LIMITE_MS);

    ps.stdout.on('data', (d) => { saida += d.toString('utf8'); });
    ps.stderr.on('data', (d) => { erros += d.toString('utf8'); });
    ps.on('error', (err) => { clearTimeout(timer); reject(err); });
    ps.on('close', () => {
      clearTimeout(timer);
      let json;
      try {
        json = JSON.parse(saida.replace(/^﻿/, '').trim());
      } catch (e) {
        return reject(new Error(`Resposta inválida do Domínio. ${erros.split('\n')[0] || ''}`.trim()));
      }
      if (json._erro) return reject(new Error(`Erro ao consultar o Domínio: ${json._erro}`));
      resolve(json);
    });
    ps.stdin.end(JSON.stringify(consultas), 'utf8');
  });
}

/** Garante que o valor vai para o SQL como número inteiro (evita injeção). */
function inteiro(valor) {
  const n = Number(valor);
  if (!Number.isInteger(n)) throw new Error(`Valor inválido para consulta: ${valor}`);
  return n;
}

module.exports = { consultarDominio, dominioConfigurado, inteiro };
