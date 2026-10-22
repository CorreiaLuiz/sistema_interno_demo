exigirLogin();
inicializarShell();

const RÓTULOS_STATUS = {
  em_andamento: 'Em andamento',
  exigencia: 'Exigência',
  concluido: 'Concluído',
  cancelado: 'Cancelado'
};

const RÓTULOS_TIPO = {
  abertura: 'Abertura',
  alteracao: 'Alteração',
  baixa: 'Baixa'
};

// Reaproveita as cores de badge já existentes no CSS (ativa/suspensa/baixada/em_legalizacao)
// mapeando os status do processo para uma cor equivalente.
const CLASSE_BADGE = {
  em_andamento: 'badge-em_legalizacao',
  exigencia: 'badge-suspensa',
  concluido: 'badge-ativa',
  cancelado: 'badge-baixada'
};

function badgeStatus(status) {
  return `<span class="badge ${CLASSE_BADGE[status] || ''}">${RÓTULOS_STATUS[status] || status}</span>`;
}

function formatarData(dataIso) {
  if (!dataIso) return '—';
  const [ano, mes, dia] = dataIso.substring(0, 10).split('-');
  return `${dia}/${mes}/${ano}`;
}

function formatarDataHora(dataIso) {
  if (!dataIso) return '—';
  const d = new Date(dataIso);
  return d.toLocaleString('pt-BR');
}

let listaEmpresas = [];

async function carregarEmpresasNoSelect() {
  const resultado = await apiFetch('/empresas?limite=500');
  listaEmpresas = resultado ? resultado.dados : [];
  const select = document.getElementById('empresa_id');
  select.innerHTML = listaEmpresas
    .map((emp) => `<option value="${emp.id}">${esc(emp.razao_social)} — ${esc(emp.cnpj)}</option>`)
    .join('');
}

async function carregarResumo() {
  const resumo = await apiFetch('/processos-legalizacao/resumo/status');
  const container = document.getElementById('resumo-status');
  if (!resumo) return;

  const ordem = ['exigencia', 'em_andamento', 'concluido', 'cancelado'];
  const coresResumo = { exigencia: 'a_vencer', em_andamento: 'emissao_pendente', concluido: 'valida', cancelado: 'vencida' };

  container.innerHTML = ordem.map((status) => `
    <div class="resumo-card ${coresResumo[status]}">
      <span class="numero">${resumo[status] || 0}</span>
      <span class="rotulo">${RÓTULOS_STATUS[status]}</span>
    </div>
  `).join('');
}

const modal = document.getElementById('modal-processo');
const form = document.getElementById('form-processo');
const erroProcesso = document.getElementById('erro-processo');
let statusOriginalEmEdicao = null;

document.getElementById('status').addEventListener('change', (e) => {
  const campoComentario = document.getElementById('campo-comentario-status');
  const mudouStatus = document.getElementById('processo-id').value && e.target.value !== statusOriginalEmEdicao;
  campoComentario.style.display = mudouStatus ? 'block' : 'none';

  // Campos de handoff automático só fazem sentido quando o processo
  // está sendo marcado como concluído agora (não em qualquer edição)
  const campoHandoff = document.getElementById('campo-handoff-setores');
  campoHandoff.style.display = (mudouStatus && e.target.value === 'concluido') ? 'block' : 'none';
});

function abrirModal(processo = null) {
  erroProcesso.textContent = '';
  form.reset();
  document.getElementById('processo-id').value = '';
  document.getElementById('campo-comentario-status').style.display = 'none';
  document.getElementById('campo-handoff-setores').style.display = 'none';
  document.getElementById('titulo-modal').textContent = processo ? 'Editar Processo' : 'Novo Processo';
  statusOriginalEmEdicao = processo ? processo.status : null;

  if (processo) {
    document.getElementById('processo-id').value = processo.id;
    document.getElementById('empresa_id').value = processo.empresa_id;
    document.getElementById('tipo').value = processo.tipo;
    document.getElementById('status').value = processo.status;
    document.getElementById('orgao').value = processo.orgao || '';
    document.getElementById('protocolo').value = processo.protocolo || '';
    document.getElementById('data_prevista_conclusao').value = processo.data_prevista_conclusao
      ? processo.data_prevista_conclusao.substring(0, 10) : '';
    document.getElementById('descricao').value = processo.descricao || '';
    document.getElementById('observacoes').value = processo.observacoes || '';
  }

  modal.classList.add('aberto');
}

function fecharModal() {
  modal.classList.remove('aberto');
}

document.getElementById('btn-novo-processo').addEventListener('click', () => abrirModal());
document.getElementById('btn-cancelar').addEventListener('click', fecharModal);

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  erroProcesso.textContent = '';

  const id = document.getElementById('processo-id').value;
  const corpo = {
    empresa_id: document.getElementById('empresa_id').value,
    tipo: document.getElementById('tipo').value,
    status: document.getElementById('status').value,
    orgao: document.getElementById('orgao').value,
    protocolo: document.getElementById('protocolo').value,
    data_prevista_conclusao: document.getElementById('data_prevista_conclusao').value || null,
    descricao: document.getElementById('descricao').value,
    observacoes: document.getElementById('observacoes').value,
    comentario_status: document.getElementById('comentario_status').value
  };

  // Handoff automático: só envia se o campo estiver visível (ou seja,
  // o processo está mesmo sendo marcado como concluído agora) e pelo
  // menos um e-mail de setor foi preenchido.
  if (document.getElementById('campo-handoff-setores').style.display !== 'none') {
    const setores = {};
    ['fiscal', 'contabilidade', 'folha_pagamento'].forEach((setor) => {
      const email = document.getElementById(`handoff-${setor}`).value.trim();
      if (email) setores[setor] = email;
    });
    if (Object.keys(setores).length > 0) {
      corpo.notificar_setores = setores;
    }
  }

  try {
    if (id) {
      await apiFetch(`/processos-legalizacao/${id}`, { method: 'PUT', body: corpo });
    } else {
      await apiFetch('/processos-legalizacao', { method: 'POST', body: corpo });
    }
    fecharModal();
    notificar(corpo.notificar_setores ? 'Processo salvo — tarefas de handoff criadas nos setores indicados.' : 'Processo salvo.', 'sucesso');
    carregarProcessos();
    carregarResumo();
    if (visaoAtual === 'quadro') carregarQuadro();
  } catch (err) {
    erroProcesso.textContent = err.message;
  }
});

// --- Modal de histórico ---
const modalHistorico = document.getElementById('modal-historico');

async function abrirHistorico(processoId) {
  const processo = await apiFetch(`/processos-legalizacao/${processoId}`);
  const lista = document.getElementById('lista-historico');

  if (!processo || !processo.historico || processo.historico.length === 0) {
    lista.innerHTML = '<p>Nenhum histórico registrado.</p>';
  } else {
    lista.innerHTML = processo.historico.map((h) => `
      <div class="item-historico">
        <strong>${RÓTULOS_STATUS[h.status_novo] || h.status_novo}</strong>
        ${h.status_anterior ? `<span style="color:var(--color-text-faint);"> (antes: ${RÓTULOS_STATUS[h.status_anterior] || h.status_anterior})</span>` : ''}
        <div class="meta">${formatarDataHora(h.criado_em)} ${h.usuario_nome ? '— ' + esc(h.usuario_nome) : ''}</div>
        ${h.comentario ? `<div>${esc(h.comentario)}</div>` : ''}
      </div>
    `).join('');
  }

  modalHistorico.classList.add('aberto');
}

document.getElementById('btn-fechar-historico').addEventListener('click', () => {
  modalHistorico.classList.remove('aberto');
});

let paginaAtual = 1;
const LIMITE = 20;

async function carregarProcessos() {
  const status = document.getElementById('filtro-status').value;
  const tipo = document.getElementById('filtro-tipo').value;

  const params = new URLSearchParams({ pagina: paginaAtual, limite: LIMITE });
  if (status) params.append('status', status);
  if (tipo) params.append('tipo', tipo);

  const resultado = await apiFetch(`/processos-legalizacao?${params.toString()}`);
  const tbody = document.getElementById('tabela-processos');
  tbody.innerHTML = '';

  atualizarControlesPagina(resultado ? resultado.total : 0);

  if (!resultado || resultado.dados.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7">Nenhum processo encontrado.</td></tr>';
    return;
  }

  resultado.dados.forEach((processo) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${linkEmpresa(processo.empresa_id, processo.razao_social)}</td>
      <td>${RÓTULOS_TIPO[processo.tipo] || processo.tipo}</td>
      <td>${processo.protocolo ? `<span class="ledger">${esc(processo.protocolo)}</span>` : '—'}</td>
      <td>${esc(processo.orgao) || '—'}</td>
      <td>${formatarData(processo.data_prevista_conclusao)}</td>
      <td>${badgeStatus(processo.status)}</td>
      <td class="celula-acoes">${celulaAcoes([
        { rotulo: 'Editar', dataset: { editar: processo.id } },
        { rotulo: 'Etapas', dataset: { etapas: processo.id } },
        { rotulo: 'Histórico', dataset: { historico: processo.id } },
        { rotulo: 'Documentos', dataset: { documentos: processo.id } },
        'separador',
        { rotulo: 'Excluir', dataset: { excluir: processo.id }, perigo: true, permissao: 'legalizacao.excluir' }
      ])}</td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('[data-editar]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const processo = await apiFetch(`/processos-legalizacao/${btn.dataset.editar}`);
      abrirModal(processo);
    });
  });

  tbody.querySelectorAll('[data-etapas]').forEach((btn) => {
    btn.addEventListener('click', () => abrirModalEtapas(btn.dataset.etapas));
  });

  tbody.querySelectorAll('[data-historico]').forEach((btn) => {
    btn.addEventListener('click', () => abrirHistorico(btn.dataset.historico));
  });

  tbody.querySelectorAll('[data-documentos]').forEach((btn) => {
    btn.addEventListener('click', () => abrirModalDocumentos(btn.dataset.documentos));
  });

  tbody.querySelectorAll('[data-excluir]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!(await confirmarAcao('Tem certeza que deseja excluir este processo? Esta ação não pode ser desfeita.'))) return;
      try {
        await apiFetch(`/processos-legalizacao/${btn.dataset.excluir}`, { method: 'DELETE' });
        carregarProcessos();
        carregarResumo();
      } catch (err) {
        notificar(err.message, 'erro');
      }
    });
  });
}

function atualizarControlesPagina(total) {
  const totalPaginas = Math.max(1, Math.ceil(total / LIMITE));
  document.getElementById('info-pagina').textContent = `Página ${paginaAtual} de ${totalPaginas} (${total} ao todo)`;
  document.getElementById('btn-pagina-anterior').disabled = paginaAtual <= 1;
  document.getElementById('btn-proxima-pagina').disabled = paginaAtual >= totalPaginas;
}

document.getElementById('btn-pagina-anterior').addEventListener('click', () => {
  if (paginaAtual > 1) { paginaAtual--; carregarProcessos(); }
});
document.getElementById('btn-proxima-pagina').addEventListener('click', () => {
  paginaAtual++; carregarProcessos();
});

document.getElementById('btn-filtrar').addEventListener('click', () => {
  paginaAtual = 1;
  carregarProcessos();
});

(async function iniciar() {
  await carregarEmpresasNoSelect();
  await carregarResumo();
  await carregarProcessos();
})();

// --- Documentos vinculados ao processo ---
const modalDocumentos = document.getElementById('modal-documentos');
const formUpload = document.getElementById('form-upload-documento');
const erroUpload = document.getElementById('erro-upload');
let processoIdDocumentosAberta = null;

const RÓTULOS_CATEGORIA = {
  contrato_social: 'Contrato Social',
  certidao: 'Certidão',
  alvara: 'Alvará',
  comprovante: 'Comprovante',
  documento_pessoal: 'Documento Pessoal',
  outro: 'Outro'
};

function formatarTamanho(bytes) {
  if (!bytes) return '';
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

async function carregarDocumentos(processoId) {
  const documentos = await apiFetch(`/documentos?processo_id=${processoId}`);
  const lista = document.getElementById('lista-documentos');

  if (!documentos || documentos.length === 0) {
    lista.innerHTML = '<p style="color:var(--color-text-muted);">Nenhum documento enviado ainda.</p>';
    return;
  }

  lista.innerHTML = documentos.map((doc) => `
    <div class="item-documento">
      <div>
        <strong>${esc(doc.nome_original)}</strong>
        <div class="meta">
          ${RÓTULOS_CATEGORIA[doc.categoria] || doc.categoria} • ${formatarTamanho(doc.tamanho_bytes)}
          ${doc.enviado_por_nome ? '• enviado por ' + esc(doc.enviado_por_nome) : ''}
        </div>
        ${doc.descricao ? `<div class="meta">${esc(doc.descricao)}</div>` : ''}
      </div>
      <div>
        <button class="link-acao" data-baixar="${doc.id}">Baixar</button>
        <button class="link-acao" data-excluir-doc="${doc.id}">Excluir</button>
      </div>
    </div>
  `).join('');

  lista.querySelectorAll('[data-baixar]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const token = getToken();
      fetch(`/api/documentos/${btn.dataset.baixar}/download`, {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then((r) => r.blob())
        .then((blob) => {
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = '';
          a.click();
          window.URL.revokeObjectURL(url);
        });
    });
  });

  lista.querySelectorAll('[data-excluir-doc]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!(await confirmarAcao('Excluir este documento? Esta ação não pode ser desfeita.'))) return;
      try {
        await apiFetch(`/documentos/${btn.dataset.excluirDoc}`, { method: 'DELETE' });
        carregarDocumentos(processoIdDocumentosAberta);
      } catch (err) {
        notificar(err.message, 'erro');
      }
    });
  });
}

function abrirModalDocumentos(processoId) {
  processoIdDocumentosAberta = processoId;
  erroUpload.textContent = '';
  formUpload.reset();
  document.getElementById('campo-descricao-documento').style.display = 'none';
  carregarDocumentos(processoId);
  modalDocumentos.classList.add('aberto');
}

document.getElementById('btn-fechar-documentos').addEventListener('click', () => {
  modalDocumentos.classList.remove('aberto');
});

document.getElementById('categoria-documento').addEventListener('change', (e) => {
  document.getElementById('campo-descricao-documento').style.display =
    e.target.value === 'outro' ? 'block' : 'none';
});

formUpload.addEventListener('submit', async (e) => {
  e.preventDefault();
  erroUpload.textContent = '';

  const arquivo = document.getElementById('arquivo-documento').files[0];
  if (!arquivo) {
    erroUpload.textContent = 'Selecione um arquivo.';
    return;
  }

  const categoria = document.getElementById('categoria-documento').value;
  const descricao = document.getElementById('descricao-documento').value;

  if (categoria === 'outro' && !descricao.trim()) {
    erroUpload.textContent = 'Descreva do que se trata o documento.';
    return;
  }

  const formData = new FormData();
  formData.append('arquivo', arquivo);
  formData.append('processo_id', processoIdDocumentosAberta);
  formData.append('categoria', categoria);
  if (categoria === 'outro') formData.append('descricao', descricao);

  try {
    await apiFetch('/documentos', { method: 'POST', body: formData });
    formUpload.reset();
    document.getElementById('campo-descricao-documento').style.display = 'none';
    carregarDocumentos(processoIdDocumentosAberta);
  } catch (err) {
    erroUpload.textContent = err.message;
  }
});

// --- Checklist de etapas do processo ---
const modalEtapas = document.getElementById('modal-etapas');
const formNovaEtapa = document.getElementById('form-nova-etapa');
const erroEtapas = document.getElementById('erro-etapas');
let processoIdEtapasAberta = null;

const RÓTULOS_STATUS_ETAPA = {
  pendente: 'Pendente',
  em_andamento: 'Em Andamento',
  exigencia: 'Exigência',
  concluido: 'Concluído'
};

let usuariosElegiveisEtapa = [];

async function carregarUsuariosElegiveis() {
  const usuarios = await apiFetch('/processos-legalizacao/responsaveis-elegiveis');
  usuariosElegiveisEtapa = usuarios || [];
}

function optionsResponsavel(responsavelIdAtual) {
  const opcoes = ['<option value="">— Sem responsável —</option>'];
  usuariosElegiveisEtapa.forEach((u) => {
    const selecionado = u.id === responsavelIdAtual ? 'selected' : '';
    opcoes.push(`<option value="${u.id}" ${selecionado}>${esc(u.nome)}</option>`);
  });
  return opcoes.join('');
}

function optionsStatusEtapa(statusAtual) {
  return Object.entries(RÓTULOS_STATUS_ETAPA).map(([valor, rotulo]) => `
    <option value="${valor}" ${valor === statusAtual ? 'selected' : ''}>${rotulo}</option>
  `).join('');
}

async function carregarEtapas() {
  const lista = document.getElementById('lista-etapas');
  const etapas = await apiFetch(`/processos-legalizacao/${processoIdEtapasAberta}/etapas`);

  if (!etapas || etapas.length === 0) {
    lista.innerHTML = '<p style="color:var(--color-text-muted); font-size:var(--text-sm);">Nenhuma etapa cadastrada ainda.</p>';
    return;
  }

  lista.innerHTML = etapas.map((etapa) => `
    <div class="item-etapa ${etapa.concluida ? 'concluida' : ''}" style="flex-wrap:wrap; align-items:center; gap:var(--space-2) var(--space-3);">
      <span class="nome-etapa" style="flex-basis:100%;">
        <span class="badge badge-${(etapa.status || 'pendente').replace(/_/g, '-')}">${RÓTULOS_STATUS_ETAPA[etapa.status] || etapa.status}</span>
        &nbsp;${esc(etapa.nome)}
      </span>
      <select data-status-etapa="${etapa.id}" style="flex:1; min-width:150px; padding:0.35rem 0.5rem; border:1.5px solid var(--color-border); border-radius:var(--radius-sm); background:var(--color-surface); color:var(--color-text); font-size:var(--text-xs);">
        ${optionsStatusEtapa(etapa.status || 'pendente')}
      </select>
      <select data-responsavel-etapa="${etapa.id}" style="flex:1; min-width:170px; padding:0.35rem 0.5rem; border:1.5px solid var(--color-border); border-radius:var(--radius-sm); background:var(--color-surface); color:var(--color-text); font-size:var(--text-xs);">
        ${optionsResponsavel(etapa.responsavel_id)}
      </select>
      <button type="button" class="remover-etapa" data-remover-etapa="${etapa.id}">Remover</button>
    </div>
  `).join('');

  lista.querySelectorAll('[data-status-etapa]').forEach((sel) => {
    sel.addEventListener('change', async () => {
      try {
        await apiFetch(`/processos-legalizacao/${processoIdEtapasAberta}/etapas/${sel.dataset.statusEtapa}`, {
          method: 'PATCH',
          body: { status: sel.value }
        });
        carregarEtapas();
      } catch (err) {
        notificar(err.message, 'erro');
        carregarEtapas();
      }
    });
  });

  lista.querySelectorAll('[data-responsavel-etapa]').forEach((sel) => {
    sel.addEventListener('change', async () => {
      try {
        await apiFetch(`/processos-legalizacao/${processoIdEtapasAberta}/etapas/${sel.dataset.responsavelEtapa}`, {
          method: 'PATCH',
          body: { responsavel_id: sel.value || null }
        });
        notificar('Responsável atualizado — o novo responsável será avisado por e-mail.', 'sucesso');
        carregarEtapas();
      } catch (err) {
        notificar(err.message, 'erro');
        carregarEtapas();
      }
    });
  });

  lista.querySelectorAll('[data-remover-etapa]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!(await confirmarAcao('Remover esta etapa do checklist?', 'Remover'))) return;
      try {
        await apiFetch(`/processos-legalizacao/${processoIdEtapasAberta}/etapas/${btn.dataset.removerEtapa}`, { method: 'DELETE' });
        carregarEtapas();
      } catch (err) {
        notificar(err.message, 'erro');
      }
    });
  });
}

function abrirModalEtapas(processoId) {
  processoIdEtapasAberta = processoId;
  erroEtapas.textContent = '';
  formNovaEtapa.reset();
  document.getElementById('form-novo-documento-checklist').reset();
  document.getElementById('lista-checklist').innerHTML = '<p class="estado-vazio" style="padding:var(--space-3) 0;">Carregando…</p>';
  document.getElementById('subtitulo-etapas').textContent = '';
  apiFetch(`/processos-legalizacao/${processoId}`).then((p) => {
    if (p) document.getElementById('subtitulo-etapas').textContent = `${p.razao_social} — ${RÓTULOS_TIPO[p.tipo] || p.tipo}`;
  }).catch(() => {});
  carregarUsuariosElegiveis().then(carregarEtapas).then(carregarChecklist);
  modalEtapas.classList.add('aberto');
}

document.getElementById('btn-fechar-etapas').addEventListener('click', () => {
  modalEtapas.classList.remove('aberto');
  // Etapas e documentos mudam o que aparece no quadro
  if (visaoAtual === 'quadro') carregarQuadro();
});

// --- Checklist de documentos do processo ---
const PODE_EDITAR_LEGALIZACAO = pode('legalizacao.editar');
let itensChecklist = [];
let itemAguardandoArquivo = null;

async function carregarChecklist() {
  const id = processoIdEtapasAberta;
  const [itens, etapas] = await Promise.all([
    apiFetch(`/processos-legalizacao/${id}/checklist`),
    apiFetch(`/processos-legalizacao/${id}/etapas`)
  ]);
  itensChecklist = itens || [];

  // Etapas do processo no seletor de "novo documento"
  document.getElementById('etapa-documento-checklist').innerHTML = '<option value="">Etapa (opcional)</option>' +
    (etapas || []).map((e) => `<option value="${esc(e.nome)}">${esc(e.nome)}</option>`).join('');

  const obrigatorios = itensChecklist.filter((i) => i.obrigatorio);
  const recebidos = obrigatorios.filter((i) => i.recebido).length;
  document.getElementById('progresso-checklist').textContent = obrigatorios.length
    ? `${recebidos} de ${obrigatorios.length} recebidos${recebidos === obrigatorios.length ? ' ✓' : ''}`
    : '';
  document.getElementById('barra-checklist').style.width = obrigatorios.length ? `${(recebidos / obrigatorios.length) * 100}%` : '0';

  const lista = document.getElementById('lista-checklist');
  if (!itensChecklist.length) {
    lista.innerHTML = '<p style="color:var(--color-text-muted); font-size:var(--text-sm);">Nenhum documento na lista. Adicione abaixo o que este processo precisa.</p>';
    return;
  }
  lista.innerHTML = itensChecklist.map((i) => `
    <div class="item-checklist ${i.recebido ? 'recebido' : ''}">
      <input type="checkbox" data-recebido="${i.id}" ${i.recebido ? 'checked' : ''} ${PODE_EDITAR_LEGALIZACAO ? '' : 'disabled'} aria-label="Recebido: ${esc(i.nome)}">
      <div>
        <div class="nome">${esc(i.nome)}${i.obrigatorio ? '' : ' <span style="font-weight:400; color:var(--color-text-faint);">(se aplicável)</span>'}</div>
        <div class="meta">
          ${i.etapa_nome ? `Usado em: ${esc(i.etapa_nome)}` : 'Sem etapa definida'}
          ${i.recebido ? ` · recebido${i.recebido_em ? ' em ' + new Date(i.recebido_em).toLocaleDateString('pt-BR') : ''}${i.recebido_por_nome ? ' por ' + esc(i.recebido_por_nome) : ''}` : ' · <strong style="color:var(--color-amber);">falta</strong>'}
          ${i.documento_nome ? ` · 📎 ${esc(i.documento_nome)}` : ''}
        </div>
      </div>
      <div class="acoes">
        ${i.documento_id ? `<button type="button" class="link-acao" data-baixar-checklist="${i.documento_id}" data-nome="${esc(i.documento_nome || '')}">Baixar</button>` : ''}
        ${PODE_EDITAR_LEGALIZACAO ? `<button type="button" class="link-acao" data-anexar="${i.id}">${i.documento_id ? 'Trocar arquivo' : 'Anexar'}</button>
        <button type="button" class="link-acao" data-remover-item="${i.id}">Remover</button>` : ''}
      </div>
    </div>`).join('');

  lista.querySelectorAll('[data-recebido]').forEach((caixa) => caixa.addEventListener('change', async () => {
    try {
      await apiFetch(`/processos-legalizacao/${id}/checklist/${caixa.dataset.recebido}`, { method: 'PATCH', body: { recebido: caixa.checked } });
      carregarChecklist();
    } catch (err) { notificar(err.message, 'erro'); carregarChecklist(); }
  }));
  lista.querySelectorAll('[data-anexar]').forEach((btn) => btn.addEventListener('click', () => {
    itemAguardandoArquivo = btn.dataset.anexar;
    document.getElementById('arquivo-checklist').click();
  }));
  lista.querySelectorAll('[data-remover-item]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!(await confirmarAcao('Tirar este documento da lista do processo?', 'Remover'))) return;
    try {
      await apiFetch(`/processos-legalizacao/${id}/checklist/${btn.dataset.removerItem}`, { method: 'DELETE' });
      carregarChecklist();
    } catch (err) { notificar(err.message, 'erro'); }
  }));
  lista.querySelectorAll('[data-baixar-checklist]').forEach((btn) => btn.addEventListener('click', async () => {
    try {
      const resp = await fetch(`${API_BASE}/documentos/${encodeURIComponent(btn.dataset.baixarChecklist)}/download`, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!resp.ok) throw new Error('Não foi possível baixar o arquivo.');
      const url = URL.createObjectURL(await resp.blob());
      const a = document.createElement('a');
      a.href = url; a.download = btn.dataset.nome;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { notificar(err.message, 'erro'); }
  }));
}

// Anexar arquivo a um item: envia para os documentos do processo e já marca como recebido
document.getElementById('arquivo-checklist').addEventListener('change', async (e) => {
  const arquivo = e.target.files[0];
  e.target.value = '';
  if (!arquivo || !itemAguardandoArquivo) return;
  const item = itensChecklist.find((i) => i.id === itemAguardandoArquivo);
  try {
    const formData = new FormData();
    formData.append('arquivo', arquivo);
    formData.append('processo_id', processoIdEtapasAberta);
    formData.append('categoria', 'outro');
    formData.append('descricao', item ? item.nome : 'Documento do checklist');
    const documento = await apiFetch('/documentos', { method: 'POST', body: formData });
    await apiFetch(`/processos-legalizacao/${processoIdEtapasAberta}/checklist/${itemAguardandoArquivo}`, {
      method: 'PATCH', body: { documento_id: documento.id, recebido: true }
    });
    notificar('Arquivo anexado e documento marcado como recebido.', 'sucesso');
    carregarChecklist();
  } catch (err) {
    notificar(err.message, 'erro');
  } finally {
    itemAguardandoArquivo = null;
  }
});

document.getElementById('form-novo-documento-checklist').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nome = document.getElementById('nome-documento-checklist').value.trim();
  if (!nome) return;
  try {
    await apiFetch(`/processos-legalizacao/${processoIdEtapasAberta}/checklist`, {
      method: 'POST',
      body: { nome, etapa_nome: document.getElementById('etapa-documento-checklist').value || null }
    });
    e.target.reset();
    carregarChecklist();
  } catch (err) { notificar(err.message, 'erro'); }
});
if (!PODE_EDITAR_LEGALIZACAO) document.getElementById('form-novo-documento-checklist').style.display = 'none';

formNovaEtapa.addEventListener('submit', async (e) => {
  e.preventDefault();
  erroEtapas.textContent = '';

  const nome = document.getElementById('nome-nova-etapa').value.trim();
  if (!nome) return;

  try {
    await apiFetch(`/processos-legalizacao/${processoIdEtapasAberta}/etapas`, {
      method: 'POST',
      body: { nome }
    });
    formNovaEtapa.reset();
    carregarEtapas();
  } catch (err) {
    erroEtapas.textContent = err.message;
  }
});

// --- Exportar para Excel (com os filtros da tela) ---
document.getElementById('btn-exportar').addEventListener('click', async () => {
  try {
    const params = new URLSearchParams({ pagina: 1, limite: 5000 });
    const status = document.getElementById('filtro-status').value;
    const tipo = document.getElementById('filtro-tipo').value;
    if (status) params.append('status', status);
    if (tipo) params.append('tipo', tipo);
    const r = await apiFetch(`/processos-legalizacao?${params.toString()}`);
    const linhas = r ? r.dados : [];
    if (!linhas.length) { notificar('Nenhum processo para exportar com esse filtro.', 'info'); return; }
    exportarExcel('processos_legalizacao', [
      { titulo: 'Empresa', valor: (p) => p.razao_social },
      { titulo: 'CNPJ', valor: (p) => p.cnpj },
      { titulo: 'Tipo', valor: (p) => RÓTULOS_TIPO[p.tipo] || p.tipo },
      { titulo: 'Descrição', valor: (p) => p.descricao },
      { titulo: 'Protocolo', valor: (p) => p.protocolo },
      { titulo: 'Órgão', valor: (p) => p.orgao },
      { titulo: 'Abertura do processo', valor: (p) => formatarDataBR(p.data_abertura_processo) },
      { titulo: 'Prazo previsto', valor: (p) => formatarDataBR(p.data_prevista_conclusao) },
      { titulo: 'Concluído em', valor: (p) => formatarDataBR(p.data_conclusao) },
      { titulo: 'Status', valor: (p) => RÓTULOS_STATUS[p.status] || p.status }
    ], linhas);
  } catch (err) {
    notificar(err.message, 'erro');
  }
});

// --- Pedidos dos clientes à Legalização (Área do Cliente) ---
const PODE_VER_PEDIDOS = ['administrador', 'analista_legalizacao'].includes((getUsuario() || {}).role);

async function carregarPedidosLegalizacao() {
  if (!PODE_VER_PEDIDOS) return;
  const tbody = document.getElementById('tabela-pedidos-legalizacao');
  const params = new URLSearchParams({ pedidos_cliente: '1', limite: 100 });
  const resultado = await apiFetch(`/tarefas-setor/legalizacao?${params.toString()}`);
  let pedidos = resultado ? resultado.dados : [];
  if (document.getElementById('filtro-pedidos').value === 'abertos') pedidos = pedidos.filter((p) => p.status !== 'concluido');

  if (!pedidos.length) {
    tbody.innerHTML = '<tr><td colspan="5">Nenhum pedido aguardando resposta.</td></tr>';
    return;
  }
  const rotulos = { pendente: 'Recebido', em_andamento: 'Em andamento', concluido: 'Concluído' };
  const classes = { pendente: 'badge-pendente', em_andamento: 'badge-em_andamento', concluido: 'badge-concluido' };
  tbody.innerHTML = pedidos.map((p) => `
    <tr>
      <td>${linkEmpresa(p.empresa_id, p.razao_social)}</td>
      <td>${htmlPedidoCliente(p.descricao)}
        ${p.status === 'concluido' ? `<div style="font-size:var(--text-xs); color:var(--color-text-muted); margin-top:4px;">Respondido${p.documento_resposta_nome ? ' com ' + esc(p.documento_resposta_nome) : ''}${p.resposta_cliente ? ': ' + esc(p.resposta_cliente) : ''}</div>` : ''}
      </td>
      <td>${new Date(p.criado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td>
      <td><span class="badge ${classes[p.status] || ''}">${rotulos[p.status] || p.status}</span></td>
      <td><div class="acoes-linha">
        ${p.status === 'pendente' ? `<button class="btn btn-secundario" style="height:32px; padding:0 12px; font-size:var(--text-xs);" data-andamento="${p.id}">Em andamento</button>` : ''}
        ${p.status !== 'concluido' ? `<button class="btn" style="height:32px; padding:0 12px; font-size:var(--text-xs);" data-concluir-pedido="${p.id}">Concluir e responder</button>` : ''}
      </div></td>
    </tr>`).join('');

  tbody.querySelectorAll('[data-andamento]').forEach((btn) => btn.addEventListener('click', async () => {
    try {
      await apiFetch(`/tarefas-setor/legalizacao/${btn.dataset.andamento}`, { method: 'PUT', body: { status: 'em_andamento' } });
      carregarPedidosLegalizacao();
    } catch (err) { notificar(err.message, 'erro'); }
  }));
  tbody.querySelectorAll('[data-concluir-pedido]').forEach((btn) => btn.addEventListener('click', () => {
    const pedido = pedidos.find((p) => p.id === btn.dataset.concluirPedido);
    abrirModalConcluirPedido(pedido, 'legalizacao', carregarPedidosLegalizacao);
  }));
}

document.getElementById('filtro-pedidos').addEventListener('change', carregarPedidosLegalizacao);
carregarPedidosLegalizacao().then(() => {
  // Vindo do sininho/Dashboard (#pedidos): rola até os pedidos
  if (window.location.hash === '#pedidos' && PODE_VER_PEDIDOS) {
    document.getElementById('pedidos').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}).catch((err) => notificar(err.message, 'erro'));


// ============================================================
// Quadro (pipeline) por etapas
// ============================================================
const COLUNA_CONCLUIDO = '__concluido__';
let visaoAtual = 'lista';
let tipoQuadro = 'abertura';
let dadosQuadro = null;

const ICONE_DOC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';

function lerPreferencia(chave, padrao) {
  try { return localStorage.getItem(chave) || padrao; } catch (e) { return padrao; }
}
function salvarPreferencia(chave, valor) {
  try { localStorage.setItem(chave, valor); } catch (e) { /* sem armazenamento */ }
}

function mostrarVisao(visao) {
  visaoAtual = visao;
  salvarPreferencia('legalizacao_visao', visao);
  document.querySelectorAll('.alternar-visao-btn').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.visao === visao)));
  document.getElementById('painel-quadro').style.display = visao === 'quadro' ? '' : 'none';
  document.getElementById('painel-lista').style.display = visao === 'lista' ? '' : 'none';
  if (visao === 'quadro') carregarQuadro();
}

function textoDias(dias) {
  if (dias === null || dias === undefined) return '';
  if (dias === 0) return 'desde hoje';
  return `há ${dias} dia${dias > 1 ? 's' : ''}`;
}

/** Próxima coluna do cartão: a etapa seguinte do próprio processo, ou "Concluído". */
function proximaColuna(cartao) {
  const i = cartao.etapas.indexOf(cartao.coluna);
  if (i === -1) return null;
  return cartao.etapas[i + 1] || COLUNA_CONCLUIDO;
}

function htmlCartao(c) {
  const docs = c.documentos || { total: 0, recebidos: 0 };
  const completo = docs.total > 0 && docs.recebidos === docs.total;
  const proxima = c.coluna !== COLUNA_CONCLUIDO ? proximaColuna(c) : null;
  const selos = [
    c.exigencia && '<span class="badge badge-exigencia">Exigência</span>',
    c.atrasado && '<span class="badge badge-vencida">Prazo vencido</span>',
    c.status === 'concluido' && '<span class="badge badge-concluido">Concluído</span>'
  ].filter(Boolean).join('');
  return `
    <div class="cartao-processo ${c.exigencia ? 'exigencia' : ''} ${c.atrasado ? 'atrasado' : ''}"
         data-cartao="${esc(c.id)}" ${PODE_EDITAR_LEGALIZACAO && c.status !== 'concluido' ? 'draggable="true"' : ''}
         tabindex="0" role="button" aria-label="${esc(c.razao_social)} — abrir etapas e documentos">
      <div class="empresa">${esc(c.nome_fantasia || c.razao_social)}</div>
      <div class="sub">${c.protocolo ? 'Protocolo ' + esc(c.protocolo) : esc(c.cnpj || '')}</div>
      ${selos ? `<div class="selos">${selos}</div>` : ''}
      ${docs.total ? `<div class="mini-progresso" title="${docs.recebidos} de ${docs.total} documentos recebidos"><span style="width:${(docs.recebidos / docs.total) * 100}%;"></span></div>` : ''}
      <div class="rodape">
        <span class="docs ${completo ? 'completo' : ''}" title="Documentos recebidos">${ICONE_DOC}${docs.total ? `${docs.recebidos}/${docs.total}` : '—'}</span>
        <span class="info" title="${esc(textoDias(c.dias_na_etapa))}${c.responsavel_nome ? ' · ' + esc(c.responsavel_nome) : ''}">${c.status === 'concluido' ? '' : esc(textoDias(c.dias_na_etapa))}${c.responsavel_nome ? ' · ' + esc(c.responsavel_nome.split(' ')[0]) : ''}</span>
        ${PODE_EDITAR_LEGALIZACAO && proxima ? `<button type="button" class="avancar" data-avancar="${esc(c.id)}" title="Avançar para: ${esc(proxima === COLUNA_CONCLUIDO ? 'Concluído' : proxima)}">Avançar</button>` : ''}
      </div>
    </div>`;
}

async function carregarQuadro() {
  const el = document.getElementById('quadro');
  try {
    dadosQuadro = await apiFetch(`/processos-legalizacao/pipeline?tipo=${tipoQuadro}`);
  } catch (err) {
    el.innerHTML = `<div class="estado-vazio">${esc(err.message)}</div>`;
    return;
  }
  if (!dadosQuadro) return;

  el.innerHTML = dadosQuadro.colunas.map((col) => {
    const cartoes = dadosQuadro.cartoes.filter((c) => c.coluna === col.chave);
    return `
      <section class="coluna-quadro ${col.chave === COLUNA_CONCLUIDO ? 'coluna-concluido' : ''}" data-coluna="${esc(col.chave)}" aria-label="${esc(col.rotulo)}">
        <div class="coluna-cabecalho"><strong>${esc(col.rotulo)}</strong><span class="qtd">${cartoes.length}</span></div>
        <div class="coluna-cartoes">
          ${cartoes.length ? cartoes.map(htmlCartao).join('') : `<div class="coluna-vazia">${col.chave === COLUNA_CONCLUIDO ? 'Concluídos nos últimos 30 dias aparecem aqui' : 'Nenhum processo nesta etapa'}</div>`}
        </div>
      </section>`;
  }).join('');

  document.getElementById('dica-quadro').textContent = PODE_EDITAR_LEGALIZACAO
    ? 'Arraste o cartão para a etapa seguinte quando ela for concluída. Clique no cartão para ver etapas e documentos.'
    : 'Clique no cartão para ver etapas e documentos.';
  ligarEventosQuadro();
}

async function moverCartao(cartaoId, destino) {
  const cartao = dadosQuadro.cartoes.find((c) => c.id === cartaoId);
  if (!cartao || cartao.coluna === destino) return;
  if (destino !== COLUNA_CONCLUIDO && !cartao.etapas.includes(destino)) {
    notificar('Este processo não tem essa etapa.', 'erro');
    return;
  }
  if (destino === COLUNA_CONCLUIDO) {
    const docs = cartao.documentos || {};
    const faltam = docs.total ? docs.total - docs.recebidos : 0;
    const aviso = faltam ? ` Ainda faltam ${faltam} documento(s) no checklist.` : '';
    if (!(await confirmarAcao(`Concluir o processo de ${esc(cartao.razao_social)}? Todas as etapas serão marcadas como concluídas e o cliente é avisado.${aviso}`, 'Concluir'))) return;
  }
  try {
    await apiFetch(`/processos-legalizacao/${cartaoId}/mover`, { method: 'POST', body: { destino } });
    notificar(destino === COLUNA_CONCLUIDO ? 'Processo concluído.' : `Movido para: ${destino}.`, 'sucesso');
    carregarQuadro();
    carregarResumo();
    carregarProcessos();
  } catch (err) {
    notificar(err.message, 'erro');
  }
}

function ligarEventosQuadro() {
  const el = document.getElementById('quadro');
  let arrastando = null;

  el.querySelectorAll('.cartao-processo').forEach((cartaoEl) => {
    cartaoEl.addEventListener('click', (e) => {
      if (e.target.closest('[data-avancar]')) return;
      abrirModalEtapas(cartaoEl.dataset.cartao);
    });
    cartaoEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirModalEtapas(cartaoEl.dataset.cartao); }
    });
    cartaoEl.addEventListener('dragstart', (e) => {
      arrastando = dadosQuadro.cartoes.find((c) => c.id === cartaoEl.dataset.cartao);
      cartaoEl.classList.add('arrastando');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', cartaoEl.dataset.cartao);
      // Colunas que este processo não tem ficam apagadas
      el.querySelectorAll('.coluna-quadro').forEach((col) => {
        const chave = col.dataset.coluna;
        col.classList.toggle('proibida', chave !== COLUNA_CONCLUIDO && !arrastando.etapas.includes(chave));
      });
    });
    cartaoEl.addEventListener('dragend', () => {
      cartaoEl.classList.remove('arrastando');
      el.querySelectorAll('.coluna-quadro').forEach((col) => col.classList.remove('alvo', 'proibida'));
      arrastando = null;
    });
  });

  el.querySelectorAll('.coluna-quadro').forEach((col) => {
    col.addEventListener('dragover', (e) => {
      if (!arrastando || col.classList.contains('proibida')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      col.classList.add('alvo');
    });
    col.addEventListener('dragleave', (e) => {
      if (!col.contains(e.relatedTarget)) col.classList.remove('alvo');
    });
    col.addEventListener('drop', (e) => {
      e.preventDefault();
      col.classList.remove('alvo');
      const id = e.dataTransfer.getData('text/plain');
      if (id) moverCartao(id, col.dataset.coluna);
    });
  });

  // Botão "Avançar →" (funciona no celular, onde não dá para arrastar)
  el.querySelectorAll('[data-avancar]').forEach((btn) => btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const cartao = dadosQuadro.cartoes.find((c) => c.id === btn.dataset.avancar);
    const proxima = cartao && proximaColuna(cartao);
    if (proxima) moverCartao(cartao.id, proxima);
  }));
}

document.querySelectorAll('.aba-quadro').forEach((aba) => aba.addEventListener('click', () => {
  tipoQuadro = aba.dataset.tipo;
  salvarPreferencia('legalizacao_tipo_quadro', tipoQuadro);
  document.querySelectorAll('.aba-quadro').forEach((a) => a.setAttribute('aria-selected', String(a === aba)));
  carregarQuadro();
}));
document.querySelectorAll('.alternar-visao-btn').forEach((btn) => btn.addEventListener('click', () => mostrarVisao(btn.dataset.visao)));
document.getElementById('btn-novo-processo-quadro').addEventListener('click', () => abrirModal());
if (!PODE_EDITAR_LEGALIZACAO) document.getElementById('btn-novo-processo-quadro').style.display = 'none';

// Começa na última visão usada (padrão: quadro)
tipoQuadro = lerPreferencia('legalizacao_tipo_quadro', 'abertura');
document.querySelectorAll('.aba-quadro').forEach((a) => a.setAttribute('aria-selected', String(a.dataset.tipo === tipoQuadro)));
mostrarVisao(window.location.hash === '#pedidos' ? 'lista' : lerPreferencia('legalizacao_visao', 'quadro'));
