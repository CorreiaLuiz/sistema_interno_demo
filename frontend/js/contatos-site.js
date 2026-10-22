exigirLogin();
inicializarShell();

const usuarioLogado = getUsuario();
if (usuarioLogado && !pode('contatos_site.gerenciar')) {
  window.location.href = '/pages/dashboard.html';
}

const SITUACOES = {
  novo: { rotulo: 'Novo', badge: 'badge-a_vencer' },
  em_contato: { rotulo: 'Em contato', badge: 'badge-em_andamento' },
  cliente: { rotulo: 'Virou cliente', badge: 'badge-valida' },
  descartado: { rotulo: 'Descartado', badge: 'badge-pendente' }
};

let contatos = [];

function linha(c) {
  const opcoes = Object.entries(SITUACOES).map(([v, s]) => `<option value="${v}"${c.status === v ? ' selected' : ''}>${s.rotulo}</option>`).join('');
  const whats = (c.whatsapp || '').replace(/\D/g, '');
  return `<tr>
    <td data-label="Recebido em">${new Date(c.criado_em).toLocaleString('pt-BR')}</td>
    <td data-label="Nome"><strong>${esc(c.nome)}</strong></td>
    <td data-label="Contato">
      <a href="mailto:${esc(c.email)}">${esc(c.email)}</a>
      ${whats ? `<br><a href="https://wa.me/${whats.length <= 11 ? '55' + whats : whats}" target="_blank" rel="noopener">${esc(c.whatsapp)}</a>` : ''}
    </td>
    <td data-label="Faturamento">${esc(c.faturamento || '—')}</td>
    <td data-label="Precisa de">${esc(c.objetivo || '—')}</td>
    <td data-label="Situação">
      <span class="badge ${SITUACOES[c.status].badge}">${SITUACOES[c.status].rotulo}</span>
      <div class="campo" style="margin:6px 0 0;"><select data-status="${c.id}" aria-label="Mudar a situação de ${esc(c.nome)}">${opcoes}</select></div>
    </td>
    <td data-label="Anotação">
      <div class="campo" style="margin:0; min-width:200px;"><textarea data-obs="${c.id}" rows="2" maxlength="1000" placeholder="Ex: liguei dia 20, retornar semana que vem" aria-label="Anotação sobre ${esc(c.nome)}">${esc(c.observacao || '')}</textarea></div>
      ${c.atualizado_por_nome ? `<div style="font-size:var(--text-xs); color:var(--color-text-muted);">por ${esc(c.atualizado_por_nome)} em ${new Date(c.atualizado_em).toLocaleDateString('pt-BR')}</div>` : ''}
    </td>
  </tr>`;
}

function renderizar() {
  const filtro = document.getElementById('filtro-status').value;
  const lista = filtro ? contatos.filter((c) => c.status === filtro) : contatos;
  document.getElementById('tabela-contatos').innerHTML = lista.length
    ? lista.map(linha).join('')
    : `<tr><td colspan="7" class="estado-vazio">${contatos.length ? 'Nenhum contato com essa situação.' : 'Nenhum pedido de diagnóstico ainda.'}</td></tr>`;
  const novos = contatos.filter((c) => c.status === 'novo').length;
  document.getElementById('contagem').textContent = `${lista.length} de ${contatos.length} contato(s)${novos ? ` · ${novos} novo(s) aguardando` : ''}.`;
}

async function salvar(id, corpo) {
  try {
    await apiFetch(`/contatos-site/${id}`, { method: 'PATCH', body: corpo });
    const c = contatos.find((x) => x.id === id);
    Object.assign(c, corpo, { atualizado_por_nome: usuarioLogado && usuarioLogado.nome, atualizado_em: new Date().toISOString() });
    notificar('Salvo.', 'sucesso');
    if (corpo.status) renderizar();
  } catch (err) {
    notificar(err.message, 'erro');
  }
}

document.getElementById('tabela-contatos').addEventListener('change', (e) => {
  if (e.target.dataset.status) salvar(e.target.dataset.status, { status: e.target.value });
  if (e.target.dataset.obs) salvar(e.target.dataset.obs, { observacao: e.target.value });
});
document.getElementById('filtro-status').addEventListener('change', renderizar);
document.getElementById('btn-exportar').addEventListener('click', () => {
  exportarExcel('contatos-site', [
    { titulo: 'Recebido em', valor: (c) => new Date(c.criado_em).toLocaleString('pt-BR') },
    { titulo: 'Nome', valor: (c) => c.nome },
    { titulo: 'E-mail', valor: (c) => c.email },
    { titulo: 'WhatsApp', valor: (c) => c.whatsapp },
    { titulo: 'Faturamento', valor: (c) => c.faturamento },
    { titulo: 'Precisa de', valor: (c) => c.objetivo },
    { titulo: 'Situação', valor: (c) => SITUACOES[c.status].rotulo },
    { titulo: 'Anotação', valor: (c) => c.observacao }
  ], contatos);
});

(async () => {
  try {
    contatos = await apiFetch('/contatos-site');
    renderizar();
  } catch (err) {
    notificar(err.message, 'erro');
  }
})();
