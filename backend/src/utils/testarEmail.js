/**
 * Script utilitário para testar a configuração de e-mail (SMTP) sem
 * precisar rodar o sistema inteiro.
 *
 * Uso:
 *   node src/utils/testarEmail.js                        -> só testa a conexão/autenticação
 *   node src/utils/testarEmail.js seu-email@destino.com   -> testa conexão E envia um e-mail de teste
 */
require('dotenv').config();
const { verificarConexaoEmail, enviarEmail } = require('../services/notificacaoService');

async function main() {
  console.log('Testando configuração de e-mail...');
  console.log(`Host: ${process.env.NOTIF_EMAIL_HOST || '(não configurado — vai usar modo simulado)'}`);

  try {
    await verificarConexaoEmail();
    console.log('✅ Conexão e autenticação com o servidor SMTP funcionaram!');
  } catch (err) {
    console.error('❌ Falha na conexão/autenticação com o SMTP:', err.message);
    process.exit(1);
  }

  const destinatarioTeste = process.argv[2];
  if (destinatarioTeste) {
    console.log(`Enviando e-mail de teste para ${destinatarioTeste}...`);
    await enviarEmail({
      destinatario: destinatarioTeste,
      assunto: 'Teste de configuração — Sistema de Legalização',
      mensagem: 'Se você recebeu este e-mail, a configuração de SMTP do sistema está funcionando corretamente.'
    });
    console.log('✅ E-mail de teste enviado! Confira a caixa de entrada (e o spam) do destinatário.');
  } else {
    console.log('Dica: rode "node src/utils/testarEmail.js seu-email@destino.com" para também enviar um e-mail de teste de verdade.');
  }
}

main().catch((err) => {
  console.error('Erro inesperado:', err);
  process.exit(1);
});
