exigirLogin();
inicializarShell();

const usuarioLogado = getUsuario();
if (usuarioLogado && !pode('guias.importar')) {
  window.location.href = '/pages/dashboard.html';
}

const POR_ENVIO = 20; // PDFs por requisição (o servidor aceita até 25)
const ROTULO_TIPO = { DAS: 'DAS', DARF: 'DARF', FGTS: 'FGTS', Estadual: 'Estadual', Municipal: 'Municipal', Guia: 'Guia' };

let arquivosEscolhidos = [];
let loteId = null;
let itens = [];
let empresas = [];
const escolhas = new Map(); // id do item → { marcado, empresa_id }
let filtroAtual = 'todas';

const $ = (id) => document.getElementById(id);
const reais = (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const competenciaBR = (c) => (c ? `${c.slice(5, 7)}/${c.slice(0, 4)}` : '—');
const cnpjFormatado = (d) => (d && d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : d || '');

function mostrarEtapa(n) {
  $('etapa-envio').style.display = n === 1 ? '' : 'none';
  // O quadro da Receita só existe quando o Integra Contador está configurado (o mês vem preenchido)
  $('painel-receita').style.display = n === 1 && $('periodo-receita').value ? '' : 'none';
  $('etapa-conferencia').style.display = n === 2 ? '' : 'none';
  $('etapa-resultado').style.display = n === 3 ? '' : 'none';
  document.querySelectorAll('.ig-passo').forEach((p) => {
    const passo = Number(p.dataset.passo);
    p.classList.toggle('ativo', passo === n);
    p.classList.toggle('feito', passo < n);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------------- 1. Escolher e enviar ----------------
function escolherArquivos(lista) {
  const pdfs = [...lista].filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  const ignorados = lista.length - pdfs.length;
  arquivosEscolhidos = pdfs;
  $('selecionados').textContent = pdfs.length
    ? `${pdfs.length} PDF${pdfs.length > 1 ? 's' : ''} selecionado${pdfs.length > 1 ? 's' : ''}${ignorados ? ` (${ignorados} arquivo(s) que não são PDF foram ignorados)` : ''}.`
    : 'Nenhum PDF selecionado.';
  $('btn-ler').disabled = !pdfs.length;
}

const areaSoltar = $('area-soltar');
areaSoltar.addEventListener('click', () => $('arquivos').click());
areaSoltar.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('arquivos').click(); } });
$('arquivos').addEventListener('change', (e) => escolherArquivos(e.target.files));
['dragenter', 'dragover'].forEach((ev) => areaSoltar.addEventListener(ev, (e) => { e.preventDefault(); areaSoltar.classList.add('arrastando'); }));
['dragleave', 'drop'].forEach((ev) => areaSoltar.addEventListener(ev, (e) => { e.preventDefault(); areaSoltar.classList.remove('arrastando'); }));
areaSoltar.addEventListener('drop', (e) => escolherArquivos(e.dataTransfer.files));

$('btn-ler').addEventListener('click', async () => {
  if (!arquivosEscolhidos.length) return;
  $('btn-ler').disabled = true;
  areaSoltar.style.pointerEvents = 'none';
  $('area-progresso').style.display = '';
  const recusados = [];
  try {
    loteId = (await apiFetch('/guias/lotes', { method: 'POST' })).lote_id;
    for (let i = 0; i < arquivosEscolhidos.length; i += POR_ENVIO) {
      const parte = arquivosEscolhidos.slice(i, i + POR_ENVIO);
      $('texto-progresso').textContent = `Lendo guias… ${Math.min(i + parte.length, arquivosEscolhidos.length)} de ${arquivosEscolhidos.length}`;
      const formData = new FormData();
      parte.forEach((f) => formData.append('arquivos', f));
      const r = await apiFetch(`/guias/lotes/${loteId}/arquivos`, { method: 'POST', body: formData });
      if (r && r.recusados) recusados.push(...r.recusados);
      $('barra-progresso').style.width = `${Math.round(((i + parte.length) / arquivosEscolhidos.length) * 100)}%`;
    }
    if (recusados.length) notificar(`${recusados.length} arquivo(s) não eram PDFs válidos e foram ignorados.`, 'erro');
    await carregarConferencia();
  } catch (err) {
    notificar(err.message, 'erro');
    $('btn-ler').disabled = false;
  } finally {
    areaSoltar.style.pointerEvents = '';
    $('area-progresso').style.display = 'none';
    $('barra-progresso').style.width = '0';
  }
});

// ---------------- 1b. Buscar DAS direto na Receita (Integra Contador) ----------------
let empresasReceita = [];
const marcadasReceita = new Set();
let falhasReceita = [];

function mesAnterior() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function renderizarListaReceita() {
  const filtro = $('busca-receita').value.trim().toLowerCase();
  const digitos = filtro.replace(/\D/g, '');
  const visiveis = empresasReceita.filter((e) => !filtro || e.razao_social.toLowerCase().includes(filtro) || (digitos.length >= 3 && e.cnpj.replace(/\D/g, '').includes(digitos)));
  const todasMarcadas = visiveis.length > 0 && visiveis.every((e) => marcadasReceita.has(e.id));
  $('lista-receita').innerHTML = visiveis.length
    ? `<label class="todas"><input type="checkbox" id="receita-todas" ${todasMarcadas ? 'checked' : ''}> Marcar ${filtro ? 'as filtradas' : 'todas'} (${visiveis.length})</label>` +
      visiveis.map((e) => `
        <label><input type="checkbox" data-receita="${e.id}" ${marcadasReceita.has(e.id) ? 'checked' : ''}>
          <span>${esc(e.razao_social)}${e.regime_tributario === 'mei' ? ' <span class="badge badge-pendente">MEI</span>' : ''}</span>
          <span class="cnpj">${esc(e.cnpj)}</span></label>`).join('')
    : `<div class="vazio">${empresasReceita.length ? 'Nenhuma empresa com esse filtro.' : 'Nenhuma empresa ativa do Simples Nacional ou MEI cadastrada.'}</div>`;
  const todas = $('receita-todas');
  if (todas) todas.addEventListener('change', () => { visiveis.forEach((e) => (todas.checked ? marcadasReceita.add(e.id) : marcadasReceita.delete(e.id))); renderizarListaReceita(); });
  $('lista-receita').querySelectorAll('[data-receita]').forEach((c) => c.addEventListener('change', () => {
    if (c.checked) marcadasReceita.add(c.dataset.receita); else marcadasReceita.delete(c.dataset.receita);
    atualizarBotaoReceita();
    renderizarListaReceita();
  }));
  atualizarBotaoReceita();
}

function atualizarBotaoReceita() {
  const n = marcadasReceita.size;
  $('btn-receita').disabled = !n || !$('periodo-receita').value;
  $('btn-receita').textContent = n ? `Buscar ${n} guia${n > 1 ? 's' : ''} na Receita` : 'Buscar na Receita';
}

function mostrarFalhasReceita(onde) {
  const caixa = $(onde);
  if (!falhasReceita.length) { caixa.style.display = 'none'; return; }
  caixa.innerHTML = `<strong>${falhasReceita.length} empresa${falhasReceita.length > 1 ? 's' : ''} sem guia da Receita:</strong>
    <ul>${falhasReceita.map((f) => `<li>${esc(f.empresa)} — <span>${esc(f.motivo)}</span></li>`).join('')}</ul>`;
  caixa.style.display = '';
}

async function carregarReceita() {
  try {
    const r = await apiFetch('/guias/receita');
    if (!r || !r.configurado) return; // Integra Contador não configurado: o quadro fica escondido
    empresasReceita = r.empresas || [];
    $('periodo-receita').value = mesAnterior();
    $('painel-receita').style.display = '';
    renderizarListaReceita();
  } catch (err) { /* sem permissão ou sem Integra: segue só com os PDFs */ }
}

$('busca-receita').addEventListener('input', renderizarListaReceita);
$('periodo-receita').addEventListener('change', atualizarBotaoReceita);

$('btn-receita').addEventListener('click', async () => {
  const periodo = $('periodo-receita').value;
  const escolhidas = empresasReceita.filter((e) => marcadasReceita.has(e.id));
  if (!periodo || !escolhidas.length) return;
  const mesBR = `${periodo.slice(5, 7)}/${periodo.slice(0, 4)}`;
  if (!(await confirmarAcao(`Gerar o DAS de ${mesBR} de ${escolhidas.length} empresa(s) na Receita? Cada guia é cobrada pelo SERPRO.`, 'Buscar na Receita'))) return;

  $('btn-receita').disabled = true;
  $('btn-ler').disabled = true;
  $('area-progresso-receita').style.display = '';
  $('falhas-receita').style.display = 'none';
  falhasReceita = [];
  let geradas = 0;
  try {
    if (!loteId) loteId = (await apiFetch('/guias/lotes', { method: 'POST' })).lote_id;
    for (let i = 0; i < escolhidas.length; i++) {
      const e = escolhidas[i];
      $('texto-progresso-receita').textContent = `Buscando na Receita… ${i + 1} de ${escolhidas.length} — ${e.razao_social}`;
      try {
        const r = await apiFetch(`/guias/lotes/${loteId}/receita`, { method: 'POST', body: { empresa_id: e.id, periodo } });
        if (r && r.ok) geradas++;
        else falhasReceita.push({ empresa: e.razao_social, motivo: (r && r.motivo) || 'A Receita não devolveu a guia.' });
      } catch (err) {
        falhasReceita.push({ empresa: e.razao_social, motivo: err.message });
      }
      $('barra-progresso-receita').style.width = `${Math.round(((i + 1) / escolhidas.length) * 100)}%`;
    }
    if (geradas) {
      await carregarConferencia();
      mostrarFalhasReceita('falhas-conferencia');
    } else {
      mostrarFalhasReceita('falhas-receita');
      notificar('Nenhuma guia veio da Receita. Veja os motivos na lista.', 'erro');
    }
  } catch (err) {
    notificar(err.message, 'erro');
  } finally {
    $('area-progresso-receita').style.display = 'none';
    $('barra-progresso-receita').style.width = '0';
    $('btn-ler').disabled = !arquivosEscolhidos.length;
    atualizarBotaoReceita();
  }
});

carregarReceita();

// ---------------- 2. Conferência ----------------
async function carregarConferencia() {
  const [lista, resultadoEmpresas] = await Promise.all([
    apiFetch(`/guias/lotes/${loteId}`),
    empresas.length ? Promise.resolve(null) : apiFetch('/empresas?limite=5000')
  ]);
  itens = lista || [];
  if (resultadoEmpresas) {
    empresas = resultadoEmpresas.dados;
    $('lista-empresas').innerHTML = empresas
      .map((e) => `<option value="${esc(e.razao_social)} — ${esc(e.cnpj)}"></option>`).join('');
  }
  escolhas.clear();
  itens.forEach((i) => {
    // Marcadas por padrão: as que acharam empresa e não são repetidas (nem do mesmo mês já enviado)
    escolhas.set(i.id, { marcado: !!i.empresa_id && !i.duplicado && !i.mesmo_mes_importado_em && i.empresa_situacao !== 'saiu_escritorio', empresa_id: i.empresa_id });
  });
  filtroAtual = itens.some((i) => !i.empresa_id) ? 'sem_empresa' : 'todas';
  mostrarEtapa(2);
  renderizarConferencia();
}

function categoria(item) {
  if (item.erro_leitura) return 'erro';
  if (item.duplicado || item.mesmo_mes_importado_em) return 'duplicada';
  if (!escolhas.get(item.id).empresa_id) return 'sem_empresa';
  return 'encontrada';
}

function renderizarFiltros() {
  const contagem = { todas: itens.length, encontrada: 0, sem_empresa: 0, duplicada: 0, erro: 0 };
  itens.forEach((i) => { contagem[categoria(i)]++; });
  const filtros = [
    ['todas', 'Todas'], ['encontrada', 'Empresa encontrada'], ['sem_empresa', 'Sem empresa'],
    ['duplicada', 'Já importadas antes'], ['erro', 'Não deu para ler']
  ].filter(([chave]) => chave === 'todas' || contagem[chave]);
  $('filtros').innerHTML = filtros.map(([chave, rotulo]) => `
    <button type="button" class="ig-filtro" data-filtro="${chave}" aria-pressed="${chave === filtroAtual}">${rotulo}<span class="qtd">(${contagem[chave]})</span></button>`).join('');
  $('filtros').querySelectorAll('[data-filtro]').forEach((b) => b.addEventListener('click', () => { filtroAtual = b.dataset.filtro; renderizarConferencia(); }));
}

function empresaPorTexto(texto) {
  const t = String(texto || '').trim().toLowerCase();
  if (!t) return null;
  return empresas.find((e) => `${e.razao_social} — ${e.cnpj}`.toLowerCase() === t)
    || empresas.find((e) => e.cnpj.replace(/\D/g, '') === t.replace(/\D/g, '') && t.replace(/\D/g, '').length >= 14)
    || null;
}

function renderizarConferencia() {
  renderizarFiltros();
  const visiveis = itens.filter((i) => filtroAtual === 'todas' || categoria(i) === filtroAtual);
  const tbody = $('tabela-itens');
  if (!visiveis.length) {
    tbody.innerHTML = '<tr><td colspan="6">Nenhuma guia neste filtro.</td></tr>';
  } else {
    tbody.innerHTML = visiveis.map((i) => {
      const escolha = escolhas.get(i.id);
      const empresa = escolha.empresa_id ? empresas.find((e) => e.id === escolha.empresa_id) : null;
      const nomeEmpresa = empresa ? empresa.razao_social : i.empresa_nome;
      const selos = [
        i.tipo_guia && `<span class="badge badge-pendente">${esc(ROTULO_TIPO[i.tipo_guia] || i.tipo_guia)}</span>`,
        i.duplicado && '<span class="badge badge-a_vencer">Já importada antes</span>',
        !i.duplicado && i.mesmo_mes_importado_em && `<span class="badge badge-a_vencer">Guia deste mês já enviada em ${formatarDataBR(i.mesmo_mes_importado_em)} — marque só se for 2ª via</span>`,
        i.empresa_situacao === 'saiu_escritorio' && '<span class="badge badge-vencida">Empresa saiu do escritório</span>',
        i.erro_leitura && `<span class="badge badge-vencida">${esc(i.erro_leitura)}</span>`
      ].filter(Boolean).join(' ');
      const celulaEmpresa = nomeEmpresa && !i._editando
        ? `<strong>${esc(nomeEmpresa)}</strong>
           ${!i.empresa_id || escolha.empresa_id !== i.empresa_id ? '<div class="ig-lido">escolhida por você</div>' : '<div class="ig-lido">pelo CNPJ do PDF</div>'}
           <button type="button" class="link-acao ig-trocar" data-trocar="${i.id}">Trocar empresa</button>`
        : `<input class="ig-empresa-input" list="lista-empresas" data-empresa-de="${i.id}" placeholder="Digite o nome ou CNPJ da empresa…" aria-label="Empresa desta guia">`;
      return `
        <tr class="${escolha.marcado ? '' : 'ig-ignorada'}">
          <td><input type="checkbox" data-marcar="${i.id}" ${escolha.marcado ? 'checked' : ''} ${escolha.empresa_id ? '' : 'disabled'} aria-label="Importar ${esc(i.nome_original)}"></td>
          <td>
            <div style="overflow-wrap:anywhere;"><strong>${esc(i.nome_original)}</strong></div>
            <div style="margin-top:4px; display:flex; gap:4px; flex-wrap:wrap;">${selos}</div>
            ${i.cnpj_lido ? `<div class="ig-lido">No PDF: ${esc(cnpjFormatado(i.cnpj_lido))}${i.razao_social_lida ? ' · ' + esc(i.razao_social_lida) : ''}</div>` : '<div class="ig-lido">CNPJ não encontrado no PDF</div>'}
          </td>
          <td>${celulaEmpresa}</td>
          <td>${competenciaBR(i.competencia)}</td>
          <td>${i.vencimento ? formatarDataBR(i.vencimento) : '—'}${i.pagar_ate && i.pagar_ate !== i.vencimento ? `<div class="ig-lido">pagar até ${formatarDataBR(i.pagar_ate)}</div>` : ''}</td>
          <td style="white-space:nowrap;">${reais(i.valor)}</td>
        </tr>`;
    }).join('');
  }

  tbody.querySelectorAll('[data-marcar]').forEach((c) => c.addEventListener('change', () => {
    escolhas.get(c.dataset.marcar).marcado = c.checked;
    renderizarConferencia();
  }));
  tbody.querySelectorAll('[data-trocar]').forEach((b) => b.addEventListener('click', () => {
    const item = itens.find((x) => x.id === b.dataset.trocar);
    item._editando = true;
    renderizarConferencia();
    const campo = tbody.querySelector(`[data-empresa-de="${item.id}"]`);
    if (campo) campo.focus();
  }));
  tbody.querySelectorAll('[data-empresa-de]').forEach((campo) => campo.addEventListener('change', () => {
    const empresa = empresaPorTexto(campo.value);
    if (!empresa) { campo.classList.remove('ok'); notificar('Escolha uma empresa da lista.', 'erro'); return; }
    const item = itens.find((x) => x.id === campo.dataset.empresaDe);
    item._editando = false;
    escolhas.set(item.id, { marcado: !item.duplicado, empresa_id: empresa.id });
    renderizarConferencia();
  }));

  const marcadas = [...escolhas.values()].filter((e) => e.marcado && e.empresa_id).length;
  $('btn-importar').textContent = marcadas ? `Importar ${marcadas} guia${marcadas > 1 ? 's' : ''}` : 'Importar';
  $('btn-importar').disabled = !marcadas;
  const marcaveis = itens.filter((i) => escolhas.get(i.id).empresa_id);
  $('marcar-todas').checked = marcaveis.length > 0 && marcaveis.every((i) => escolhas.get(i.id).marcado);
}

$('marcar-todas').addEventListener('change', (e) => {
  itens.forEach((i) => {
    const escolha = escolhas.get(i.id);
    if (escolha.empresa_id) escolha.marcado = e.target.checked;
  });
  renderizarConferencia();
});

$('btn-cancelar').addEventListener('click', async () => {
  if (!(await confirmarAcao('Cancelar esta importação? Os PDFs enviados serão descartados.', 'Cancelar importação'))) return;
  try { await apiFetch(`/guias/lotes/${loteId}`, { method: 'DELETE' }); } catch (err) { /* segue */ }
  reiniciar();
});

$('btn-importar').addEventListener('click', async () => {
  const selecionadas = [...escolhas.entries()].filter(([, e]) => e.marcado && e.empresa_id).map(([id, e]) => ({ id, empresa_id: e.empresa_id }));
  if (!selecionadas.length) return;
  const naoMarcadas = itens.length - selecionadas.length;
  const enviarEmail = $('enviar-email').checked;
  const aviso = `Importar ${selecionadas.length} guia(s)${enviarEmail ? ' e enviar por e-mail aos clientes' : ''}?` +
    (naoMarcadas ? ` As ${naoMarcadas} não marcada(s) serão descartadas.` : '');
  if (!(await confirmarAcao(aviso, 'Importar'))) return;

  $('btn-importar').disabled = true;
  try {
    const r = await apiFetch(`/guias/lotes/${loteId}/confirmar`, { method: 'POST', body: { itens: selecionadas, enviar_email: enviarEmail } });
    $('titulo-resultado').textContent = `${r.importadas} guia${r.importadas !== 1 ? 's' : ''} importada${r.importadas !== 1 ? 's' : ''}`;
    $('texto-resultado').innerHTML = `As guias foram colocadas em <strong>${r.empresas} empresa${r.empresas !== 1 ? 's' : ''}</strong> e já aparecem na Área do Cliente (categoria Guias).` +
      (r.descartadas ? ` ${r.descartadas} guia(s) não marcada(s) foram descartadas.` : '') +
      (r.emails_em_envio ? '<br>Os e-mails estão sendo enviados agora:' : '');
    mostrarEtapa(3);
    if (r.emails_em_envio) acompanharEmails();
  } catch (err) {
    notificar(err.message, 'erro');
    $('btn-importar').disabled = false;
  }
});

// ---------------- 3. Resultado: andamento dos e-mails ----------------
async function acompanharEmails() {
  const rotulos = {
    na_fila: ['badge-pendente', 'na fila'], enviado: ['badge-valida', 'enviados'], simulado: ['badge-emissao_pendente', 'simulados (e-mail não configurado)'],
    falhou: ['badge-vencida', 'falharam'], sem_email: ['badge-a_vencer', 'sem e-mail cadastrado']
  };
  for (let tentativa = 0; tentativa < 120; tentativa++) {
    let status;
    try { status = await apiFetch(`/guias/lotes/${loteId}/emails`); } catch (e) { return; }
    $('status-emails').innerHTML = Object.entries(status || {})
      .filter(([chave]) => rotulos[chave])
      .map(([chave, n]) => `<span class="badge ${rotulos[chave][0]}">${n} empresa${n !== 1 ? 's' : ''}: ${rotulos[chave][1]}</span>`).join('');
    if (!status || !status.na_fila) {
      if (status && (status.falhou || status.sem_email)) {
        $('status-emails').insertAdjacentHTML('beforeend', '<p style="width:100%; margin-top:var(--space-3);">As guias dessas empresas estão na Área do Cliente e na ficha da empresa — dá para enviar por outro canal.</p>');
      }
      return;
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
}

function reiniciar() {
  arquivosEscolhidos = [];
  loteId = null;
  itens = [];
  escolhas.clear();
  $('arquivos').value = '';
  $('selecionados').textContent = '';
  $('btn-ler').disabled = true;
  $('status-emails').innerHTML = '';
  falhasReceita = [];
  $('falhas-receita').style.display = 'none';
  $('falhas-conferencia').style.display = 'none';
  mostrarEtapa(1);
}
$('btn-nova').addEventListener('click', reiniciar);
