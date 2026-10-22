const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { AppError } = require('./errorHandler');

// UPLOAD_DIR no ambiente só é usado por ferramentas (ex: gerador dos prints do manual, com dados fictícios)
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// A extensão salva no disco vem do tipo aceito, nunca do nome enviado —
// assim um "virus.exe" ou "pagina.html" disfarçado de PDF não mantém a
// extensão perigosa no servidor.
const EXTENSAO_POR_TIPO = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  // Certificado digital A1 (e-CNPJ/e-CPF). O Windows às vezes manda o
  // .pfx como octet-stream — por isso também olhamos a extensão (abaixo).
  'application/x-pkcs12': '.pfx',
  'application/pkcs12': '.pfx'
};

// Extensões de certificado aceitas quando o navegador não informa o tipo certo
const EXTENSOES_CERTIFICADO = ['.pfx', '.p12'];

/** Extensão segura a usar no disco, ou null se o arquivo não é aceito. */
function extensaoPermitida(file) {
  if (EXTENSAO_POR_TIPO[file.mimetype]) return EXTENSAO_POR_TIPO[file.mimetype];
  const extensaoOriginal = path.extname(file.originalname || '').toLowerCase();
  if (EXTENSOES_CERTIFICADO.includes(extensaoOriginal)) return '.pfx';
  return null;
}

// Primeiros bytes ("assinatura") de cada formato aceito. O tipo informado
// pelo navegador pode ser forjado; o conteúdo real do arquivo não.
const ASSINATURAS = {
  '.pdf': [Buffer.from('%PDF-')],
  '.png': [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  '.jpg': [Buffer.from([0xff, 0xd8, 0xff])],
  // PKCS#12 é uma estrutura ASN.1: começa com SEQUENCE (0x30) + tamanho longo (0x80–0x84)
  '.pfx': [0x80, 0x81, 0x82, 0x83, 0x84].map((b) => Buffer.from([0x30, b]))
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    // Nome único e seguro no servidor — nunca confiamos no nome original para o path.
    const sufixo = crypto.randomBytes(16).toString('hex');
    cb(null, `${Date.now()}-${sufixo}${extensaoPermitida(file)}`);
  }
});

function filtroArquivo(req, file, cb) {
  if (!extensaoPermitida(file)) {
    return cb(new AppError('Tipo de arquivo não permitido. Envie PDF, PNG, JPG ou certificado digital (.pfx).', 400));
  }
  // O nome original é só exibido na tela; ainda assim, limita o tamanho e
  // tira caracteres de controle e separadores de pasta.
  file.originalname = path.basename(file.originalname.replace(/[\u0000-\u001f\\/]/g, '_')).slice(0, 200);
  cb(null, true);
}

const maxSizeMb = Number(process.env.UPLOAD_MAX_SIZE_MB || 15);

const upload = multer({
  storage,
  fileFilter: filtroArquivo,
  limits: { fileSize: maxSizeMb * 1024 * 1024, files: 1, fields: 20 }
});

/**
 * Deve vir logo depois de upload.single(...): confere se o conteúdo do
 * arquivo salvo bate com o formato declarado e apaga o arquivo se não bater.
 */
function validarConteudoArquivo(req, res, next) {
  if (!req.file) return next();

  const extensao = path.extname(req.file.filename);
  const esperadas = ASSINATURAS[extensao] || [];

  fs.open(req.file.path, 'r', (errAbrir, fd) => {
    if (errAbrir) return next(errAbrir);
    const inicio = Buffer.alloc(8);
    fs.read(fd, inicio, 0, 8, 0, (errLer) => {
      fs.close(fd, () => {});
      if (errLer) return next(errLer);

      const valido = esperadas.some((assinatura) => inicio.subarray(0, assinatura.length).equals(assinatura));
      if (!valido) {
        fs.unlink(req.file.path, () => {});
        req.file = undefined;
        return next(new AppError('O conteúdo do arquivo não corresponde a um PDF, PNG, JPG ou certificado (.pfx) válido.', 400));
      }
      next();
    });
  });
}

/**
 * Importação de guias em lote: só PDF, até 25 arquivos por envio (a tela
 * manda os 200 em partes, mostrando o progresso). O conteúdo de cada
 * arquivo é conferido no controller (precisa começar com "%PDF-").
 */
const uploadGuias = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf' && !/\.pdf$/i.test(file.originalname || '')) {
      return cb(new AppError(`"${file.originalname}" não é PDF. Envie só as guias em PDF.`, 400));
    }
    file.mimetype = 'application/pdf';
    file.originalname = path.basename(file.originalname.replace(/[\u0000-\u001f\\/]/g, '_')).slice(0, 200);
    cb(null, true);
  },
  limits: { fileSize: maxSizeMb * 1024 * 1024, files: 25, fields: 10 }
});

module.exports = { upload, uploadGuias, validarConteudoArquivo, UPLOAD_DIR };
