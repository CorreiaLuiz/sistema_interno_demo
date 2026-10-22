/**
 * Endereço público do sistema, usado nos links enviados por e-mail e
 * WhatsApp. Vem do .env (APP_URL) e não do cabeçalho Host da requisição —
 * senão alguém poderia forjar o Host e fazer um link de senha apontar
 * para um site dele.
 */
function urlBaseSistema() {
  return (process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, '');
}

module.exports = { urlBaseSistema };
