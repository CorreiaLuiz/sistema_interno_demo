exigirLogin();
inicializarShell();

const RÓTULOS_STATUS = {
  valida: 'Válida',
  a_vencer: 'A vencer',
  vencida: 'Vencida',
  emissao_pendente: 'Emissão pendente'
};

const RÓTULOS_TIPO = {
  vigilancia_sanitaria: 'Vigilância Sanitária',
  bombeiros: 'Bombeiros',
  ambiental: 'Ambiental',
  funcionamento: 'Funcionamento',
  outra: 'Outra'
};

function badgeStatus(status) {
  return `<span class="badge badge-${status}">${RÓTULOS_STATUS[status] || status}</span>`;
}

function formatarData(dataIso) {
  if (!dataIso) return '—';
  const [ano, mes, dia] = dataIso.substring(0, 10).split('-');
  return `${dia}/${mes}/${ano}`;
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
  const resumo = await apiFetch('/licencas/resumo/status');
  const container = document.getElementById('resumo-status');
  if (!resumo) return;

  const ordem = ['vencida', 'a_vencer', 'valida', 'emissao_pendente'];
  container.innerHTML = ordem.map((status) => `
    <div class="resumo-card ${status}">
      <span class="numero">${resumo[status] || 0}</span>
      <span class="rotulo">${RÓTULOS_STATUS[status]}</span>
    </div>
  `).join('');
}

const modal = document.getElementById('modal-licenca');
const form = document.getElementById('form-licenca');
const erroLicenca = document.getElementById('erro-licenca');

function abrirModal(licenca = null) {
  erroLicenca.textContent = '';
  form.reset();
  document.getElementById('licenca-id').value = '';
  document.getElementById('titulo-modal').textContent = licenca ? 'Editar Licença' : 'Nova Licença';

  if (licenca) {
    document.getElementById('licenca-id').value = licenca.id;
    document.getElementById('empresa_id').value = licenca.empresa_id;
    document.getElementById('tipo').value = licenca.tipo;
    document.getElementById('orgao_emissor').value = licenca.orgao_emissor || '';
    document.getElementById('numero_licenca').value = licenca.numero_licenca || '';
    document.getElementById('data_emissao').value = licenca.data_emissao ? licenca.data_emissao.substring(0, 10) : '';
    document.getElementById('data_validade').value = licenca.data_validade ? licenca.data_validade.substring(0, 10) : '';
    document.getElementById('observacoes').value = licenca.observacoes || '';
  }

  modal.classList.add('aberto');
}

function fecharModal() {
  modal.classList.remove('aberto');
}

document.getElementById('btn-nova-licenca').addEventListener('click', () => abrirModal());
document.getElementById('btn-cancelar').addEventListener('click', fecharModal);

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  erroLicenca.textContent = '';

  const id = document.getElementById('licenca-id').value;
  const corpo = {
    empresa_id: document.getElementById('empresa_id').value,
    tipo: document.getElementById('tipo').value,
    orgao_emissor: document.getElementById('orgao_emissor').value,
    numero_licenca: document.getElementById('numero_licenca').value,
    data_emissao: document.getElementById('data_emissao').value || null,
    data_validade: document.getElementById('data_validade').value || null,
    observacoes: document.getElementById('observacoes').value
  };

  try {
    if (id) {
      await apiFetch(`/licencas/${id}`, { method: 'PUT', body: corpo });
    } else {
      await apiFetch('/licencas', { method: 'POST', body: corpo });
    }
    fecharModal();
    carregarLicencas();
    carregarResumo();
  } catch (err) {
    erroLicenca.textContent = err.message;
  }
});

const modalRenovar = document.getElementById('modal-renovar');
const formRenovar = document.getElementById('form-renovar');
const erroRenovar = document.getElementById('erro-renovar');

function abrirModalRenovar(licencaId) {
  erroRenovar.textContent = '';
  formRenovar.reset();
  document.getElementById('renovar-licenca-id').value = licencaId;
  modalRenovar.classList.add('aberto');
}

document.getElementById('btn-cancelar-renovar').addEventListener('click', () => {
  modalRenovar.classList.remove('aberto');
});

formRenovar.addEventListener('submit', async (e) => {
  e.preventDefault();
  erroRenovar.textContent = '';

  const id = document.getElementById('renovar-licenca-id').value;
  const corpo = {
    data_emissao: document.getElementById('renovar_data_emissao').value || null,
    data_validade: document.getElementById('renovar_data_validade').value,
    observacoes: document.getElementById('renovar_observacoes').value
  };

  try {
    await apiFetch(`/licencas/${id}/renovar`, { method: 'POST', body: corpo });
    modalRenovar.classList.remove('aberto');
    carregarLicencas();
    carregarResumo();
  } catch (err) {
    erroRenovar.textContent = err.message;
  }
});

let paginaAtual = 1;
const LIMITE = 20;

async function carregarLicencas() {
  const status = document.getElementById('filtro-status').value;
  const tipo = document.getElementById('filtro-tipo').value;

  const params = new URLSearchParams({ pagina: paginaAtual, limite: LIMITE });
  if (status) params.append('status', status);
  if (tipo) params.append('tipo', tipo);

  const resultado = await apiFetch(`/licencas?${params.toString()}`);
  const tbody = document.getElementById('tabela-licencas');
  tbody.innerHTML = '';

  atualizarControlesPagina(resultado ? resultado.total : 0);

  if (!resultado || resultado.dados.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7">Nenhuma licença encontrada.</td></tr>';
    return;
  }

  resultado.dados.forEach((licenca) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${linkEmpresa(licenca.empresa_id, licenca.razao_social)}</td>
      <td>${RÓTULOS_TIPO[licenca.tipo] || licenca.tipo}</td>
      <td>${licenca.numero_licenca ? `<span class="ledger">${esc(licenca.numero_licenca)}</span>` : '—'}</td>
      <td>${esc(licenca.orgao_emissor) || '—'}</td>
      <td>${formatarData(licenca.data_validade)}</td>
      <td>${badgeStatus(licenca.status)}</td>
      <td class="celula-acoes">${celulaAcoes([
        { rotulo: 'Editar', dataset: { editar: licenca.id }, permissao: 'licencas.editar' },
        { rotulo: 'Renovar', dataset: { renovar: licenca.id }, permissao: 'licencas.editar' },
        { rotulo: 'Documentos', dataset: { documentos: licenca.id } },
        'separador',
        { rotulo: 'Excluir', dataset: { excluir: licenca.id }, perigo: true, permissao: 'licencas.excluir' }
      ])}</td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('[data-editar]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const licenca = await apiFetch(`/licencas/${btn.dataset.editar}`);
      abrirModal(licenca);
    });
  });

  tbody.querySelectorAll('[data-renovar]').forEach((btn) => {
    btn.addEventListener('click', () => abrirModalRenovar(btn.dataset.renovar));
  });

  tbody.querySelectorAll('[data-documentos]').forEach((btn) => {
    btn.addEventListener('click', () => abrirModalDocumentos(btn.dataset.documentos));
  });

  tbody.querySelectorAll('[data-excluir]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!(await confirmarAcao('Tem certeza que deseja excluir esta licença? Esta ação não pode ser desfeita.'))) return;
      try {
        await apiFetch(`/licencas/${btn.dataset.excluir}`, { method: 'DELETE' });
        carregarLicencas();
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
  if (paginaAtual > 1) { paginaAtual--; carregarLicencas(); }
});
document.getElementById('btn-proxima-pagina').addEventListener('click', () => {
  paginaAtual++; carregarLicencas();
});

document.getElementById('btn-filtrar').addEventListener('click', () => {
  paginaAtual = 1;
  carregarLicencas();
});

(async function iniciar() {
  await carregarEmpresasNoSelect();
  await carregarResumo();
  await carregarLicencas();
})();

// --- Documentos vinculados à licença ---
const modalDocumentos = document.getElementById('modal-documentos');
const formUpload = document.getElementById('form-upload-documento');
const erroUpload = document.getElementById('erro-upload');
let licencaIdDocumentosAberta = null;

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

async function carregarDocumentos(licencaId) {
  const documentos = await apiFetch(`/documentos?licenca_id=${licencaId}`);
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
        carregarDocumentos(licencaIdDocumentosAberta);
      } catch (err) {
        notificar(err.message, 'erro');
      }
    });
  });
}

function abrirModalDocumentos(licencaId) {
  licencaIdDocumentosAberta = licencaId;
  erroUpload.textContent = '';
  formUpload.reset();
  document.getElementById('campo-descricao-documento').style.display = 'none';
  carregarDocumentos(licencaId);
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
  formData.append('licenca_id', licencaIdDocumentosAberta);
  formData.append('categoria', categoria);
  if (categoria === 'outro') formData.append('descricao', descricao);

  try {
    await apiFetch('/documentos', { method: 'POST', body: formData });
    formUpload.reset();
    document.getElementById('campo-descricao-documento').style.display = 'none';
    carregarDocumentos(licencaIdDocumentosAberta);
  } catch (err) {
    erroUpload.textContent = err.message;
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
    const r = await apiFetch(`/licencas?${params.toString()}`);
    const linhas = r ? r.dados : [];
    if (!linhas.length) { notificar('Nenhuma licença para exportar com esse filtro.', 'info'); return; }
    exportarExcel('licencas', [
      { titulo: 'Empresa', valor: (l) => l.razao_social },
      { titulo: 'CNPJ', valor: (l) => l.cnpj },
      { titulo: 'Tipo', valor: (l) => RÓTULOS_TIPO[l.tipo] || l.tipo },
      { titulo: 'Número', valor: (l) => l.numero_licenca },
      { titulo: 'Órgão emissor', valor: (l) => l.orgao_emissor },
      { titulo: 'Emissão', valor: (l) => formatarDataBR(l.data_emissao) },
      { titulo: 'Validade', valor: (l) => formatarDataBR(l.data_validade) },
      { titulo: 'Status', valor: (l) => RÓTULOS_STATUS[l.status] || l.status }
    ], linhas);
  } catch (err) {
    notificar(err.message, 'erro');
  }
});
