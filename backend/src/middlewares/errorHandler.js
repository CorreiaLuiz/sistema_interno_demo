const multer = require('multer');

/**
 * Middleware global de tratamento de erros.
 * Deve ser o último middleware registrado no app (app.use(errorHandler)).
 *
 * O "detalhe" técnico do PostgreSQL só é devolvido em desenvolvimento —
 * em produção ele pode revelar nomes de colunas e valores de outros
 * registros (ex: o CNPJ que já está cadastrado).
 */
function errorHandler(err, req, res, next) {
  console.error('[ERRO]', err);

  const detalhe = process.env.NODE_ENV === 'development' ? err.detail : undefined;

  // Erros de upload (arquivo grande demais, campo inesperado, etc.)
  if (err instanceof multer.MulterError) {
    const mensagem = err.code === 'LIMIT_FILE_SIZE'
      ? `Arquivo grande demais. O limite é ${process.env.UPLOAD_MAX_SIZE_MB || 15} MB.`
      : 'Falha no envio do arquivo.';
    return res.status(400).json({ erro: mensagem });
  }

  // Erros de violação de restrição única do PostgreSQL (ex: CNPJ duplicado)
  if (err.code === '23505') {
    return res.status(409).json({
      erro: 'Já existe um registro com esse valor único (ex: CNPJ, e-mail).',
      detalhe
    });
  }

  // Erro de chave estrangeira inválida
  if (err.code === '23503') {
    return res.status(400).json({
      erro: 'Referência inválida — verifique se os IDs relacionados existem.',
      detalhe
    });
  }

  // Erro de restrição CHECK (ex: documento sem associação válida)
  if (err.code === '23514') {
    return res.status(400).json({
      erro: 'Dados inválidos: violação de regra de negócio no banco de dados.',
      detalhe
    });
  }

  // Valor em formato inválido para a coluna (ex: ID que não é um UUID, data inválida)
  if (err.code === '22P02' || err.code === '22007' || err.code === '22008') {
    return res.status(400).json({ erro: 'Dados em formato inválido.' });
  }

  // JSON malformado no corpo da requisição
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ erro: 'Corpo da requisição inválido (JSON malformado).' });
  }

  const status = err.status || 500;
  const mensagem = err.expor ? err.message : 'Erro interno no servidor.';

  res.status(status).json({ erro: mensagem });
}

/**
 * Classe de erro customizada para erros de negócio previsíveis,
 * que podem ser expostos com segurança ao usuário final.
 */
class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
    this.expor = true;
  }
}

module.exports = { errorHandler, AppError };
