const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const ClientePortal = require('../models/ClientePortal');
const Empresa = require('../models/Empresa');
const ProcessoLegalizacao = require('../models/ProcessoLegalizacao');
const Certidao = require('../models/Certidao');
const Licenca = require('../models/Licenca');
const CertificadoDigital = require('../models/CertificadoDigital');
const TarefaSetor = require('../models/TarefaSetor');
const HistoricoComunicacao = require('../models/HistoricoComunicacao');
const { Documento } = require('../models/Documento');
const { UPLOAD_DIR } = require('../middlewares/upload');
const { SETORES_SOLICITACAO, buscarTipo, responsavelDoSetor } = require('../config/solicitacoesCliente');
const { enviarEmail, notificarCliente } = require('../services/notificacaoService');
const { urlBaseSistema } = require('../utils/urlSistema');
const Notificacao = require('../models/Notificacao');
const { SETORES, linkPedidosCliente } = require('../config/setores');
const { AppError } = require('../middlewares/errorHandler');

/**
 * Área do Cliente — tudo o que o cliente faz depois de entrar com e-mail
 * e senha. Toda rota com :empresaId confere se aquele login tem acesso à
 * empresa (verificarAcessoEmpresa) — trocar o ID na URL não abre dados
 * de outra empresa.
 */

const SALT_ROUNDS = 10;
const HASH_FICTICIO = bcrypt.hashSync('senha-ficticia-para-tempo-constante', SALT_ROUNDS);

function normalizarEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function validarNovaSenha(senha) {
  if (!senha || typeof senha !== 'string' || senha.length < 8) {
    throw new AppError('A senha deve ter no mínimo 8 caracteres.', 400);
  }
  if (senha.length > 200) throw new AppError('Senha longa demais.', 400);
}

async function verificarAcessoEmpresa(req, res, next) {
  try {
    const permitido = await ClientePortal.temAcesso(req.cliente.id, req.params.empresaId);
    if (!permitido) throw new AppError('Empresa não encontrada.', 404);
    next();
  } catch (err) {
    next(err);
  }
}

// ================= Login e senha (rotas públicas) =================

async function login(req, res, next) {
  try {
    const email = normalizarEmail(req.body.email);
    const { senha } = req.body;
    if (!email || !senha || typeof senha !== 'string') {
      throw new AppError('Informe e-mail e senha.', 400);
    }

    const cliente = await ClientePortal.buscarParaLogin(email);
    const senhaValida = await bcrypt.compare(senha, (cliente && cliente.senha_hash) || HASH_FICTICIO);
    if (!cliente || !cliente.ativo || !cliente.senha_hash || !senhaValida) {
      throw new AppError('E-mail ou senha incorretos.', 401);
    }

    const empresas = await ClientePortal.listarEmpresas(cliente.id);
    if (!empresas.length) {
      throw new AppError('Seu acesso ainda não tem nenhuma empresa liberada. Fale com o escritório.', 403);
    }

    const token = jwt.sign({ id: cliente.id, tipo: 'cliente' }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_CLIENTE_EXPIRES_IN || '12h'
    });
    await ClientePortal.registrarLogin(cliente.id);

    res.json({ token, cliente: { id: cliente.id, nome: cliente.nome, email: cliente.email }, empresas });
  } catch (err) {
    next(err);
  }
}

/**
 * "Esqueci minha senha": manda o link por e-mail e WhatsApp. Responde
 * sempre a mesma coisa, exista ou não o e-mail, para ninguém descobrir
 * quais e-mails têm acesso.
 */
async function esqueciSenha(req, res, next) {
  try {
    const email = normalizarEmail(req.body.email);
    if (!email) throw new AppError('Informe o e-mail.', 400);

    const cliente = await ClientePortal.buscarPorEmail(email);
    if (cliente && cliente.ativo) {
      (async () => {
        const empresas = await ClientePortal.listarEmpresas(cliente.id);
        if (!empresas.length) return;
        const token = await ClientePortal.gerarTokenSenha(cliente.id, 'recuperacao');
        const link = `${urlBaseSistema()}/pages/cliente-senha.html?token=${token}`;
        await notificarCliente({
          cliente,
          empresaId: empresas[0].id,
          assunto: 'Nova senha — Área do Cliente Privilege',
          mensagem: `Olá${cliente.nome ? ', ' + cliente.nome : ''}! Recebemos um pedido para criar uma nova senha ` +
            `da sua Área do Cliente. Use o link abaixo (válido por 2 horas):\n\n${link}\n\n` +
            'Se não foi você, pode ignorar esta mensagem.'
        });
      })().catch((err) => console.error('Falha ao enviar link de nova senha do cliente:', err.message));
    }

    res.json({ mensagem: 'Se o e-mail tiver acesso, enviamos um link para criar uma nova senha (por e-mail e WhatsApp).' });
  } catch (err) {
    next(err);
  }
}

/** Mostra de quem é o link antes de o cliente digitar a senha. */
async function verificarLinkSenha(req, res, next) {
  try {
    const registro = await ClientePortal.buscarTokenSenhaValido(String(req.params.token || ''));
    if (!registro || !registro.ativo) {
      throw new AppError('Este link expirou ou já foi usado. Peça um novo ao escritório ou use "Esqueci minha senha".', 400);
    }
    res.json({ nome: registro.nome, email: registro.email, tipo: registro.tipo });
  } catch (err) {
    next(err);
  }
}

async function definirSenha(req, res, next) {
  try {
    const { token, novaSenha } = req.body;
    validarNovaSenha(novaSenha);

    const registro = await ClientePortal.buscarTokenSenhaValido(String(token || ''));
    if (!registro || !registro.ativo) {
      throw new AppError('Este link expirou ou já foi usado. Peça um novo ao escritório ou use "Esqueci minha senha".', 400);
    }

    await ClientePortal.definirSenha(registro.cliente_id, await bcrypt.hash(novaSenha, SALT_ROUNDS));
    await ClientePortal.marcarTokenUsado(registro.id);

    res.json({ mensagem: 'Senha criada! Agora é só entrar com seu e-mail e a nova senha.', email: registro.email });
  } catch (err) {
    next(err);
  }
}

// ================= Conta (logado) =================

async function me(req, res, next) {
  try {
    const empresas = await ClientePortal.listarEmpresas(req.cliente.id);
    const { id, nome, email, telefone } = req.cliente;
    res.json({ cliente: { id, nome, email, telefone }, empresas });
  } catch (err) {
    next(err);
  }
}

async function trocarSenha(req, res, next) {
  try {
    const { senhaAtual, novaSenha } = req.body;
    if (!senhaAtual) throw new AppError('Informe a senha atual.', 400);
    validarNovaSenha(novaSenha);

    const hashAtual = await ClientePortal.buscarSenhaHash(req.cliente.id);
    if (!hashAtual || !(await bcrypt.compare(senhaAtual, hashAtual))) {
      throw new AppError('Senha atual incorreta.', 401);
    }
    await ClientePortal.definirSenha(req.cliente.id, await bcrypt.hash(novaSenha, SALT_ROUNDS));
    res.json({ mensagem: 'Senha alterada com sucesso.' });
  } catch (err) {
    next(err);
  }
}

function tiposSolicitacao(req, res) {
  res.json(SETORES_SOLICITACAO);
}

// ================= Dados da empresa (logado + acesso à empresa) =================

async function resumo(req, res, next) {
  try {
    const empresaId = req.params.empresaId;
    const [empresa, processos, certidoes, licencas, certificados, pedidos] = await Promise.all([
      Empresa.buscarPorId(empresaId),
      ProcessoLegalizacao.listar({ empresaId, pagina: 1, limite: 50 }),
      Certidao.listar({ empresaId, pagina: 1, limite: 50 }),
      Licenca.listar({ empresaId, pagina: 1, limite: 50 }),
      CertificadoDigital.listarPorEmpresa(empresaId),
      TarefaSetor.listarPedidosCliente(empresaId)
    ]);

    const certificadosPublicos = certificados.map((c) => ({
      id: c.id, tipo: c.tipo, data_validade: c.data_validade, status: c.status
    }));

    // O que precisa de atenção: vencido ou vencendo em até 30 dias
    const atencao = [
      ...certidoes.dados.map((c) => ({ grupo: 'certidao', tipo: c.tipo, status: c.status, data_validade: c.data_validade })),
      ...licencas.dados.map((l) => ({ grupo: 'licenca', tipo: l.tipo, status: l.status, data_validade: l.data_validade })),
      ...certificadosPublicos.map((c) => ({ grupo: 'certificado', tipo: c.tipo, status: c.status, data_validade: c.data_validade }))
    ].filter((item) => item.status === 'vencida' || item.status === 'a_vencer');

    res.json({
      empresa: {
        id: empresa.id, razao_social: empresa.razao_social, nome_fantasia: empresa.nome_fantasia,
        cnpj: empresa.cnpj, regime_tributario: empresa.regime_tributario
      },
      atencao,
      processos: processos.dados.map((p) => ({ id: p.id, tipo: p.tipo, status: p.status, descricao: p.descricao, orgao: p.orgao })),
      certidoes: certidoes.dados.map((c) => ({ id: c.id, tipo: c.tipo, status: c.status, data_validade: c.data_validade })),
      licencas: licencas.dados.map((l) => ({ id: l.id, tipo: l.tipo, status: l.status, data_validade: l.data_validade })),
      certificados: certificadosPublicos,
      pedidos_abertos: pedidos.filter((p) => p.status !== 'concluido').length
    });
  } catch (err) {
    next(err);
  }
}

async function listarDocumentos(req, res, next) {
  try {
    res.json(await Documento.listarVisiveisCliente(req.params.empresaId));
  } catch (err) {
    next(err);
  }
}

async function baixarDocumento(req, res, next) {
  try {
    const documento = await Documento.buscarPorId(req.params.documentoId);
    // Só documentos desta empresa e liberados para o cliente
    if (!documento || documento.empresa_id !== req.params.empresaId || !documento.visivel_cliente) {
      throw new AppError('Documento não encontrado.', 404);
    }

    const caminhoAbsoluto = path.join(UPLOAD_DIR, documento.nome_armazenado);
    if (!fs.existsSync(caminhoAbsoluto)) throw new AppError('Arquivo não encontrado no servidor.', 404);

    await ClientePortal.registrarDownload({
      documento, clienteId: req.cliente.id, empresaId: req.params.empresaId, ip: req.ip
    });
    res.download(caminhoAbsoluto, documento.nome_original);
  } catch (err) {
    next(err);
  }
}

async function enviarDocumento(req, res, next) {
  try {
    if (!req.file) throw new AppError('Nenhum arquivo foi enviado.', 400);

    const documento = await Documento.criar({
      empresa_id: req.params.empresaId,
      nome_original: req.file.originalname,
      nome_armazenado: req.file.filename,
      caminho: path.join('uploads', req.file.filename),
      tipo_mime: req.file.mimetype,
      tamanho_bytes: req.file.size,
      categoria: 'outro',
      descricao: req.body.descricao ? String(req.body.descricao).slice(0, 255) : 'Enviado pelo cliente',
      enviado_por: null,
      enviado_por_cliente: req.cliente.id,
      visivel_cliente: true
    });

    // Aviso para o colaborador responsável pela conta da empresa, se houver
    Empresa.buscarPorId(req.params.empresaId).then((empresa) => empresa && empresa.responsavel_interno && Notificacao.avisar({
      usuarioIds: [empresa.responsavel_interno], tipo: 'documento_cliente',
      titulo: `Cliente enviou um documento — ${empresa.razao_social}`,
      mensagem: `${documento.nome_original}${req.body.descricao ? ' — ' + String(req.body.descricao).slice(0, 200) : ''}`,
      link: `/pages/empresa.html?id=${empresa.id}#documentos`
    })).catch((e) => console.error('Falha ao avisar sobre documento do cliente:', e.message));

    res.status(201).json({ id: documento.id, nome_original: documento.nome_original });
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    next(err);
  }
}

// ================= Pedidos ao escritório =================

async function listarSolicitacoes(req, res, next) {
  try {
    res.json(await TarefaSetor.listarPedidosCliente(req.params.empresaId));
  } catch (err) {
    next(err);
  }
}

async function criarSolicitacao(req, res, next) {
  try {
    const { setor, tipo } = req.body;
    const observacao = String(req.body.observacao || '').trim().slice(0, 2000);
    const competencia = String(req.body.competencia || '').trim();

    const tipoConfig = buscarTipo(setor, tipo);
    if (!tipoConfig) throw new AppError('Escolha o setor e o tipo do pedido.', 400);
    if (tipoConfig.pedeCompetencia && !/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia)) {
      throw new AppError('Informe o mês de referência (competência) da guia.', 400);
    }
    if (tipo.startsWith('outro_') && !observacao) {
      throw new AppError('Conte pra gente do que você precisa no campo de observação.', 400);
    }

    const empresa = await Empresa.buscarPorId(req.params.empresaId);
    const competenciaTexto = tipoConfig.pedeCompetencia ? ` — competência ${competencia.slice(5, 7)}/${competencia.slice(0, 4)}` : '';
    const quem = req.cliente.nome || req.cliente.email;
    const descricao = `[Pedido do cliente] ${tipoConfig.rotulo}${competenciaTexto}` +
      `${observacao ? `\nObservação: ${observacao}` : ''}\nSolicitado por: ${quem} (${req.cliente.email})`;

    const responsavel = responsavelDoSetor(setor);
    const tarefa = await TarefaSetor.criarPedidoCliente({
      empresa_id: empresa.id, setor, descricao, tipo_solicitacao: tipo,
      competencia: tipoConfig.pedeCompetencia ? competencia : null,
      responsavel_nome: responsavel.nome, responsavel_email: responsavel.email, cliente_id: req.cliente.id
    });

    // Aviso no sininho: responsável do setor + gestores do setor
    Notificacao.avisar({
      emails: [responsavel.email], papeis: SETORES[setor].gestores,
      tipo: 'pedido_cliente',
      titulo: `Pedido do cliente: ${tipoConfig.rotulo} — ${empresa.razao_social}`,
      mensagem: `${competenciaTexto ? competenciaTexto.replace(' — ', '') + '. ' : ''}${observacao}`.trim() || null,
      link: linkPedidosCliente(setor)
    });

    // Avisa o responsável do setor por e-mail (sem travar a resposta ao cliente)
    if (responsavel.email) {
      const assunto = `Pedido do cliente (${SETORES_SOLICITACAO[setor].rotulo}) — ${empresa.razao_social}`;
      const mensagem = `Olá${responsavel.nome ? ', ' + responsavel.nome : ''}! O cliente abriu um pedido pela Área do Cliente ` +
        `— empresa ${empresa.razao_social} (CNPJ ${empresa.cnpj}):\n\n${descricao}\n\n` +
        `Veja em ${urlBaseSistema()}/pages/${setor === 'folha_pagamento' ? 'folha-pagamento' : setor}.html`;
      enviarEmail({ destinatario: responsavel.email, assunto, mensagem })
        .then(
          () => ({ status: 'enviado', erro: null }),
          (err) => {
            console.error('Falha ao avisar responsável do pedido do cliente:', err.message);
            return { status: 'falhou', erro: err.message };
          }
        )
        .then(({ status, erro }) => HistoricoComunicacao.registrar({
          empresaId: empresa.id, canal: 'email', destinatario: responsavel.email, assunto, mensagem, status, erro
        }))
        .catch((e) => console.error('Falha ao registrar histórico de comunicação:', e.message));
    }

    res.status(201).json({ id: tarefa.id, status: tarefa.status });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  verificarAcessoEmpresa, login, esqueciSenha, verificarLinkSenha, definirSenha, me, trocarSenha,
  tiposSolicitacao, resumo, listarDocumentos, baixarDocumento, enviarDocumento,
  listarSolicitacoes, criarSolicitacao
};
