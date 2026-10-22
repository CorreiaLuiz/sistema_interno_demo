const Empresa = require('../models/Empresa');
const ProcessoLegalizacao = require('../models/ProcessoLegalizacao');
const Certidao = require('../models/Certidao');
const Licenca = require('../models/Licenca');
const CertificadoDigital = require('../models/CertificadoDigital');
const TarefaSetor = require('../models/TarefaSetor');
const OnboardingEmpresa = require('../models/OnboardingEmpresa');
const HistoricoComunicacao = require('../models/HistoricoComunicacao');
const ClientePortal = require('../models/ClientePortal');
const Usuario = require('../models/Usuario');
const { Documento } = require('../models/Documento');
const EtapaProcesso = require('../models/EtapaProcesso');
const ChecklistProcesso = require('../models/ChecklistProcesso');
const { setoresVisiveis, ehColaboradorDoSetor } = require('../config/setores');
const { responsaveisDoEstagio } = require('../config/onboardingResponsaveis');
const { AppError } = require('../middlewares/errorHandler');

// Mesmos papéis que liberam acesso à Área do Cliente (ver empresaRoutes.js)
const VEEM_ACESSOS_CLIENTE = [
  'administrador', 'analista_legalizacao',
  'supervisor_fiscal', 'supervisor_contabilidade', 'supervisor_folha_pagamento'
];

/**
 * Ficha completa da empresa: tudo o que o escritório tem sobre ela numa
 * resposta só. Tarefas dos setores seguem as mesmas regras das telas de
 * setor (cada papel vê só os setores dele; colaborador só as próprias).
 */
async function ficha(req, res, next) {
  try {
    const empresa = await Empresa.buscarPorId(req.params.id);
    if (!empresa) throw new AppError('Empresa não encontrada.', 404);

    const role = req.usuario.role;
    const setores = setoresVisiveis(role);
    const emailPorSetor = Object.fromEntries(
      setores.filter((s) => ehColaboradorDoSetor(role, s)).map((s) => [s, req.usuario.email])
    );

    const [processos, certidoes, licencas, certificados, documentos, tarefas, onboarding, historicoEsteira,
      comunicacoes, acessosCliente, responsavelInterno] = await Promise.all([
      ProcessoLegalizacao.listar({ empresaId: empresa.id, pagina: 1, limite: 100 }),
      Certidao.listar({ empresaId: empresa.id, pagina: 1, limite: 100 }),
      Licenca.listar({ empresaId: empresa.id, pagina: 1, limite: 100 }),
      CertificadoDigital.listarPorEmpresa(empresa.id),
      Documento.listarPorAssociacao('empresa_id', empresa.id),
      TarefaSetor.listarPorEmpresa(empresa.id, setores, emailPorSetor),
      OnboardingEmpresa.buscarPorEmpresa(empresa.id),
      OnboardingEmpresa.historico(empresa.id),
      HistoricoComunicacao.listarPorEmpresa(empresa.id),
      VEEM_ACESSOS_CLIENTE.includes(role) ? ClientePortal.listarPorEmpresa(empresa.id) : Promise.resolve(null),
      empresa.responsavel_interno ? Usuario.buscarPorId(empresa.responsavel_interno) : Promise.resolve(null)
    ]);

    // Etapa atual e documentos recebidos de cada processo (mesma regra do quadro)
    const idsProcessos = processos.dados.map((p) => p.id);
    const [etapas, docs] = await Promise.all([
      EtapaProcesso.listarPorProcessos(idsProcessos),
      ChecklistProcesso.contagens(idsProcessos)
    ]);
    processos.dados.forEach((p) => {
      const atual = etapas.find((e) => e.processo_id === p.id && e.status !== 'concluido');
      p.etapa_atual = p.status === 'concluido' ? null : (atual ? atual.nome : null);
      p.documentos = docs[p.id] || null;
    });

    res.json({
      empresa: { ...empresa, responsavel_interno_nome: responsavelInterno ? responsavelInterno.nome : null },
      esteira: onboarding
        ? { ...onboarding, responsaveis_estagio_atual: responsaveisDoEstagio(onboarding.estagio), historico: historicoEsteira }
        : null,
      processos: processos.dados,
      certidoes: certidoes.dados,
      licencas: licencas.dados,
      certificados,
      documentos,
      tarefas,
      setores_visiveis: setores,
      comunicacoes: comunicacoes.slice(0, 50),
      acessos_cliente: acessosCliente
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { ficha };
