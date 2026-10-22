const fs = require('fs');
const path = require('path');
const { Documento, CAMPOS_ASSOCIACAO } = require('../models/Documento');
const { UPLOAD_DIR } = require('../middlewares/upload');
const { query } = require('../config/db');
const LogAuditoria = require('../models/LogAuditoria');
const { AppError } = require('../middlewares/errorHandler');
const { enviarParaTodos } = require('../services/rastreioEmail');
const { montarEmail } = require('../services/emailLayout');
const { emailsDaEmpresa } = require('../services/emailsCliente');
const { urlBaseSistema } = require('../utils/urlSistema');

const CATEGORIAS_SUGERIDAS = [
  'cartao_cnpj', 'contrato_social', 'certidao', 'alvara', 'certificado_digital', 'guia',
  'comprovante', 'documento_pessoal', 'outro'
];

/**
 * Descobre a qual entidade o documento enviado deve ser associado,
 * a partir dos campos empresa_id / processo_id / certidao_id / licenca_id
 * no corpo da requisição. Exige exatamente um deles preenchido.
 */
function identificarAssociacao(body) {
  const presentes = CAMPOS_ASSOCIACAO.filter((campo) => body[campo]);
  if (presentes.length !== 1) {
    throw new AppError(
      'Informe exatamente um vínculo: empresa_id, processo_id, certidao_id ou licenca_id.',
      400
    );
  }
  return { campo: presentes[0], valor: body[presentes[0]] };
}

const TABELAS_POR_CAMPO = {
  empresa_id: 'empresas',
  processo_id: 'processos_legalizacao',
  certidao_id: 'certidoes',
  licenca_id: 'licencas'
};

async function verificarEntidadeExiste(campo, valor) {
  const tabela = TABELAS_POR_CAMPO[campo];
  const { rows } = await query(`SELECT id FROM ${tabela} WHERE id = $1`, [valor]);
  return rows.length > 0;
}

const ROTULO_CATEGORIA = {
  cartao_cnpj: 'Cartão CNPJ', contrato_social: 'Contrato social', certidao: 'Certidão', alvara: 'Alvará',
  certificado_digital: 'Certificado digital', guia: 'Guia', comprovante: 'Comprovante',
  documento_pessoal: 'Documento pessoal', outro: 'Documento'
};

/**
 * Manda um documento recém-enviado para o cliente, no layout do escritório,
 * com o arquivo em anexo (menos o certificado digital, que só se baixa pelo
 * portal). Registra o envio no histórico de comunicação da empresa.
 */
async function enviarDocumentoPorEmail({ documento, destinatarios, usuarioId }) {
  const { rows: [empresa] } = await query('SELECT id, razao_social, cnpj FROM empresas WHERE id = $1', [documento.empresa_id]);
  const rotulo = ROTULO_CATEGORIA[documento.categoria] || 'Documento';
  const ehGuia = documento.categoria === 'guia';
  const anexar = !/\.(pfx|p12)$/i.test(documento.nome_original);
  const urlPortal = `${urlBaseSistema()}/pages/cliente-login.html`;

  // Um e-mail para cada destinatário — assim dá para saber quem abriu e quem baixou
  await enviarParaTodos({
    destinatarios, pausaMs: 1200, empresaId: empresa.id, assunto: `${rotulo} — ${empresa.razao_social}`,
    tipo: ehGuia ? 'guias' : 'documento', documentos: [documento], enviadoPor: usuarioId,
    anexos: anexar ? [{ nome: documento.nome_original, caminho: path.join(UPLOAD_DIR, documento.nome_armazenado), tipo: documento.tipo_mime }] : [],
    montar: ({ pixel, linkDocumento }) => montarEmail({
      chamada: ehGuia ? 'Guia para pagamento' : 'Novo documento',
      titulo: ehGuia ? 'Sua guia chegou' : `${rotulo} disponível`,
      resumo: `${documento.descricao || rotulo} — ${empresa.razao_social}`,
      saudacao: 'Olá!',
      paragrafos: [
        `${ehGuia ? 'Enviamos a guia' : 'Enviamos um novo documento'} da empresa ${empresa.razao_social} (CNPJ ${empresa.cnpj}).` +
        (anexar ? '' : ' Por segurança, ele fica disponível só para baixar na sua Área do Cliente.')
      ],
      itens: [{ etiqueta: rotulo, rotulo: documento.descricao || rotulo, detalhe: documento.nome_original }],
      avisoAnexo: anexar ? 'O arquivo também está em anexo neste e-mail.' : null,
      // Certificado digital: só pela Área do Cliente (com login), nunca por link
      botao: anexar ? { texto: ehGuia ? 'Baixar a guia' : 'Baixar o arquivo', url: linkDocumento(documento.id) } : { texto: 'Acessar a Área do Cliente', url: urlPortal },
      linkSecundario: anexar ? { texto: 'ou acesse a Área do Cliente', url: urlPortal } : null,
      observacao: 'O arquivo fica guardado na sua Área do Cliente, caso precise de novo.',
      pixel
    })
  });
}

async function listar(req, res, next) {
  try {
    const { campo, valor } = identificarAssociacao(req.query);
    const documentos = await Documento.listarPorAssociacao(campo, valor);
    res.json(documentos);
  } catch (err) {
    next(err);
  }
}

async function upload(req, res, next) {
  try {
    if (!req.file) {
      throw new AppError('Nenhum arquivo foi enviado.', 400);
    }

    const { campo, valor } = identificarAssociacao(req.body);

    const existe = await verificarEntidadeExiste(campo, valor);
    if (!existe) {
      // Remove o arquivo já salvo em disco pelo multer, já que a associação é inválida
      fs.unlink(req.file.path, () => {});
      throw new AppError('A entidade associada informada não foi encontrada.', 404);
    }

    if (req.body.categoria && !CATEGORIAS_SUGERIDAS.includes(req.body.categoria)) {
      throw new AppError(`Categoria inválida. Use uma de: ${CATEGORIAS_SUGERIDAS.join(', ')}`, 400);
    }

    const documento = await Documento.criar({
      [campo]: valor,
      nome_original: req.file.originalname,
      nome_armazenado: req.file.filename,
      caminho: path.join('uploads', req.file.filename),
      tipo_mime: req.file.mimetype,
      tamanho_bytes: req.file.size,
      categoria: req.body.categoria || 'outro',
      descricao: req.body.descricao ? String(req.body.descricao).slice(0, 255) : null,
      enviado_por: req.usuario.id,
      // Só vale para documentos da empresa — é o que aparece na Área do Cliente
      visivel_cliente: campo === 'empresa_id' && (req.body.visivel_cliente === 'true' || req.body.visivel_cliente === true)
    });

    LogAuditoria.registrar({
      usuarioId: req.usuario.id, acao: 'CREATE', entidade: 'documento', entidadeId: documento.id,
      detalhes: { nome_original: documento.nome_original, categoria: documento.categoria, visivel_cliente: documento.visivel_cliente }
    });

    // "Enviar também por e-mail": só para o que o cliente pode ver
    let email_status = null;
    let email_destinatarios = [];
    if (documento.visivel_cliente && (req.body.enviar_email === 'true' || req.body.enviar_email === true)) {
      email_destinatarios = await emailsDaEmpresa(valor);
      email_status = email_destinatarios.length ? 'na_fila' : 'sem_email';
      if (email_destinatarios.length) {
        enviarDocumentoPorEmail({ documento, destinatarios: email_destinatarios, usuarioId: req.usuario.id })
          .catch((err) => console.error('Falha ao enviar documento por e-mail:', err.message));
      }
    }

    res.status(201).json({ ...documento, email_status, email_destinatarios });
  } catch (err) {
    // Se algo deu errado depois do multer já ter salvo o arquivo, tenta limpar
    if (req.file) fs.unlink(req.file.path, () => {});
    next(err);
  }
}

async function baixar(req, res, next) {
  try {
    const documento = await Documento.buscarPorId(req.params.id);
    if (!documento) throw new AppError('Documento não encontrado.', 404);

    const caminhoAbsoluto = path.join(UPLOAD_DIR, documento.nome_armazenado);
    if (!fs.existsSync(caminhoAbsoluto)) {
      throw new AppError('Arquivo não encontrado no servidor.', 404);
    }

    res.download(caminhoAbsoluto, documento.nome_original);
  } catch (err) {
    next(err);
  }
}

/** Mostra ou esconde um documento da empresa na Área do Cliente. */
async function alterarVisibilidadeCliente(req, res, next) {
  try {
    if (typeof req.body.visivel_cliente !== 'boolean') {
      throw new AppError('Informe visivel_cliente como true ou false.', 400);
    }
    const existente = await Documento.buscarPorId(req.params.id);
    if (!existente) throw new AppError('Documento não encontrado.', 404);
    if (!existente.empresa_id) {
      throw new AppError('Só documentos da empresa podem aparecer na Área do Cliente.', 400);
    }

    const documento = await Documento.definirVisibilidadeCliente(req.params.id, req.body.visivel_cliente);
    LogAuditoria.registrar({
      usuarioId: req.usuario.id, acao: 'UPDATE', entidade: 'documento', entidadeId: documento.id,
      detalhes: { visivel_cliente: documento.visivel_cliente, nome_original: documento.nome_original }
    });
    res.json(documento);
  } catch (err) {
    next(err);
  }
}

async function remover(req, res, next) {
  try {
    const documento = await Documento.buscarPorId(req.params.id);
    if (!documento) throw new AppError('Documento não encontrado.', 404);

    // Só o administrador ou quem enviou o arquivo pode excluí-lo — evita
    // que qualquer colaborador apague documentos de clientes por engano.
    if (req.usuario.role !== 'administrador' && documento.enviado_por !== req.usuario.id) {
      throw new AppError('Apenas o administrador ou quem enviou o documento pode excluí-lo.', 403);
    }

    const caminhoAbsoluto = path.join(UPLOAD_DIR, documento.nome_armazenado);

    await Documento.remover(req.params.id);
    LogAuditoria.registrar({
      usuarioId: req.usuario.id, acao: 'DELETE', entidade: 'documento', entidadeId: req.params.id,
      detalhes: { nome_original: documento.nome_original }
    });

    // Remove o arquivo físico só depois de confirmar a remoção do registro no banco
    fs.unlink(caminhoAbsoluto, () => {});

    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

module.exports = { listar, upload, baixar, alterarVisibilidadeCliente, remover };
