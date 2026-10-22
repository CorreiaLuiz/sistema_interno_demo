/**
 * Cabeçalhos HTTP de segurança aplicados a todas as respostas.
 * Equivalente ao básico do pacote "helmet", sem adicionar dependência.
 */
function cabecalhosSeguranca(req, res, next) {
  // Impede o navegador de "adivinhar" o tipo de um arquivo (ex: tratar um upload como HTML)
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Impede que o sistema seja embutido em <iframe> de outro site (clickjacking)
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // Respostas da API contêm dados de clientes — nunca guardar em cache
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
}

module.exports = { cabecalhosSeguranca };
