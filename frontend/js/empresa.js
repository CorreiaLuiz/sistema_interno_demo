exigirLogin();
inicializarShell();

// A ficha faz parte da seção "Empresas" do menu
document.querySelectorAll('.sidebar-nav a[href="/pages/empresas.html"]').forEach((a) => a.classList.add('ativo'));

const empresaId = new URLSearchParams(window.location.search).get('id');
const usuario = getUsuario() || {};

const ROTULOS_REGIME = { simples_nacional: 'Simples Nacional', lucro_presumido: 'Lucro Presumido', lucro_real: 'Lucro Real', mei: 'MEI' };
const ROTULOS_SITUACAO = { ativa: 'Ativa', suspensa: 'Suspensa', baixada: 'Baixada', em_legalizacao: 'Em legalização', saiu_escritorio: 'Saiu do escritório' };
const ROTULOS_VALIDADE = { valida: 'Válida', a_vencer: 'A vencer', vencida: 'Vencida', emissao_pendente: 'Emissão pendente' };
const ROTULOS_TIPO_CERTIDAO = { federal: 'CND Federal', estadual: 'CND Estadual', municipal: 'CND Municipal', trabalhista: 'CND Trabalhista', fgts: 'CRF (FGTS)', outra: 'Outra certidão' };
const ROTULOS_TIPO_LICENCA = { vigilancia_sanitaria: 'Vigilância Sanitária', bombeiros: 'Bombeiros', ambiental: 'Ambiental', funcionamento: 'Alvará de Funcionamento', outra: 'Outra licença' };
const ROTULOS_TIPO_CERTIFICADO = { 'e-cnpj': 'e-CNPJ', 'e-cpf': 'e-CPF', outro: 'Outro' };
const ROTULOS_TIPO_PROCESSO = { abertura: 'Abertura', alteracao: 'Alteração', baixa: 'Baixa' };
const ROTULOS_STATUS_PROCESSO = { em_andamento: 'Em andamento', exigencia: 'Em exigência', concluido: 'Concluído', cancelado: 'Cancelado' };
const CLASSE_STATUS_PROCESSO = { em_andamento: 'badge-em_andamento', exigencia: 'badge-exigencia', concluido: 'badge-concluido', cancelado: 'badge-baixada' };
const ROTULOS_STATUS_TAREFA = { pendente: 'Pendente', em_andamento: 'Em andamento', concluido: 'Concluído' };
const CLASSE_STATUS_TAREFA = { pendente: 'badge-pendente', em_andamento: 'badge-em_andamento', concluido: 'badge-concluido' };
const ROTULOS_SETOR = { fiscal: 'Fiscal', contabilidade: 'Contabilidade', folha_pagamento: 'Folha de Pagamento', legalizacao: 'Legalização' };
const PAGINA_SETOR = { fiscal: '/pages/fiscal.html', contabilidade: '/pages/contabilidade.html', folha_pagamento: '/pages/folha-pagamento.html', legalizacao: '/pages/processos.html#pedidos' };
const ROTULOS_CATEGORIA = {
  cartao_cnpj: 'Cartão CNPJ', contrato_social: 'Contrato Social', certidao: 'Certidão', alvara: 'Alvará',
  certificado_digital: 'Certificado Digital', guia: 'Guia', comprovante: 'Comprovante', documento_pessoal: 'Documento Pessoal', outro: 'Outro'
};
const ETAPAS_ESTEIRA = [['legalizacao', 'Legalização'], ['cadastro_dominio', 'Cadastro no Domínio'], ['fechamento_setorial', 'Fechamento setorial']];

const ABAS = [
  ['resumo', 'Resumo'], ['legalizacao', 'Legalização'], ['vencimentos', 'Vencimentos'],
  ['documentos', 'Documentos'], ['setores', 'Setores e pedidos'], ['cliente', 'Cliente e comunicação']
];

let ficha = null;

const vazio = (texto) => `<p class="fe-vazio">${esc(texto)}</p>`;
const badge = (classe, texto) => `<span class="badge ${classe}">${esc(texto)}</span>`;
const dataHora = (v) => (v ? new Date(v).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

function formatarTamanho(bytes) {
  if (!bytes) return '';
  const kb = bytes / 1024;
  return kb < 1024 ? `${kb.toFixed(0)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

/** Link que abre a janela certa na tela de Empresas (editar, documentos...). */
const linkAcao = (acao) => `/pages/empresas.html?abrir=${acao}&id=${encodeURIComponent(empresaId)}`;

// ---------------- Abas ----------------
function montarAbas(contagens) {
  const nav = document.getElementById('fe-abas');
  nav.innerHTML = ABAS.map(([chave, rotulo]) => `
    <button type="button" class="fe-aba" role="tab" data-aba="${chave}" aria-selected="false">
      ${rotulo}${contagens[chave] ? ` <span class="qtd">${contagens[chave]}</span>` : ''}
    </button>`).join('');
  nav.querySelectorAll('.fe-aba').forEach((b) => b.addEventListener('click', () => abrirAba(b.dataset.aba)));
}

function abrirAba(nome) {
  if (!ABAS.some(([chave]) => chave === nome)) nome = 'resumo';
  document.querySelectorAll('.fe-aba').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.aba === nome)));
  document.querySelectorAll('.fe-painel').forEach((p) => p.classList.toggle('ativo', p.dataset.painel === nome));
  history.replaceState(null, '', `${window.location.pathname}${window.location.search}${nome === 'resumo' ? '' : '#' + nome}`);
}

// ---------------- Cabeçalho ----------------
function renderizarCabecalho() {
  const e = ficha.empresa;
  document.title = `${e.razao_social} — Sistema Privilege Contabilidade`;
  document.getElementById('fe-razao').textContent = e.razao_social;
  document.getElementById('fe-fantasia').textContent = e.nome_fantasia || '';
  document.getElementById('fe-selos').innerHTML = `
    <span class="fe-cnpj">${esc(e.cnpj)}</span>
    ${badge(`badge-${e.situacao}`, ROTULOS_SITUACAO[e.situacao] || e.situacao)}
    <span class="badge badge-pendente">${esc(ROTULOS_REGIME[e.regime_tributario] || e.regime_tributario)}</span>`;

  const podeEditar = pode('empresas.editar');
  const acoes = [
    podeEditar && `<a class="btn btn-secundario" href="${linkAcao('editar')}">Editar dados</a>`,
    `<a class="btn btn-secundario" href="${linkAcao('documentos')}">Enviar documento</a>`,
    ficha.acessos_cliente && `<a class="btn btn-secundario" href="${linkAcao('portal')}">Área do Cliente</a>`,
    `<a class="btn btn-secundario" href="${linkAcao('certificado')}">Certificado digital</a>`
  ].filter(Boolean);
  document.getElementById('fe-acoes').innerHTML = acoes.join('');

  const atencao = (lista) => lista.filter((i) => i.status === 'vencida' || i.status === 'a_vencer').length;
  const vencidos = [...ficha.certidoes, ...ficha.licencas, ...ficha.certificados].filter((i) => i.status === 'vencida').length;
  const vencendo = atencao([...ficha.certidoes, ...ficha.licencas, ...ficha.certificados]) - vencidos;
  const processosAbertos = ficha.processos.filter((p) => p.status === 'em_andamento' || p.status === 'exigencia').length;
  const tarefasAbertas = ficha.tarefas.filter((t) => t.status !== 'concluido');
  const pedidosAbertos = tarefasAbertas.filter((t) => t.solicitado_por_cliente).length;
  const atrasadas = tarefasAbertas.filter((t) => t.atrasada).length;

  const numeros = [
    { aba: 'legalizacao', valor: processosAbertos, rotulo: 'processos em aberto', classe: ficha.processos.some((p) => p.status === 'exigencia') ? 'aviso' : '' },
    { aba: 'vencimentos', valor: vencidos, rotulo: 'vencidos', classe: vencidos ? 'alerta' : '' },
    { aba: 'vencimentos', valor: vencendo, rotulo: 'vencem em 30 dias', classe: vencendo ? 'aviso' : '' },
    { aba: 'setores', valor: tarefasAbertas.length, rotulo: atrasadas ? `tarefas abertas (${atrasadas} atrasada${atrasadas > 1 ? 's' : ''})` : 'tarefas abertas', classe: atrasadas ? 'alerta' : '' },
    { aba: 'setores', valor: pedidosAbertos, rotulo: 'pedidos do cliente', classe: pedidosAbertos ? 'aviso' : '' }
  ];
  const el = document.getElementById('fe-numeros');
  el.innerHTML = numeros.map((n) => `
    <button type="button" class="fe-numero ${n.classe}" data-ir="${n.aba}">
      <strong>${n.valor}</strong><span>${esc(n.rotulo)}</span>
    </button>`).join('');
  el.querySelectorAll('[data-ir]').forEach((b) => b.addEventListener('click', () => abrirAba(b.dataset.ir)));
}

// ---------------- Resumo ----------------
function renderizarResumo() {
  const e = ficha.empresa;
  const endereco = [e.logradouro, e.numero, e.complemento, e.bairro].filter(Boolean).join(', ');
  const cidade = [e.cidade, e.uf].filter(Boolean).join('/');
  const linhas = [
    ['Razão social', e.razao_social],
    ['Nome fantasia', e.nome_fantasia],
    ['CNPJ', e.cnpj],
    ['Regime', ROTULOS_REGIME[e.regime_tributario] || e.regime_tributario],
    ['Inscrição estadual', e.inscricao_estadual],
    ['Inscrição municipal', e.inscricao_municipal],
    ['Abertura', formatarDataBR(e.data_abertura)],
    ['Endereço', [endereco, cidade, e.cep].filter(Boolean).join(' — ')],
    ['Telefone', e.telefone],
    ['E-mail', e.email],
    ['Responsável interno', e.responsavel_interno_nome],
    ['Competência de início', e.competencia_inicio ? String(e.competencia_inicio).slice(5, 7) + '/' + String(e.competencia_inicio).slice(0, 4) : null],
    ['Fator R', e.fator_r === true ? 'Sim' : e.fator_r === false ? 'Não' : null],
    ['Pró-labore', e.pro_labore],
    ['Saída do escritório', e.data_saida ? `${formatarDataBR(e.data_saida)}${e.observacao_saida ? ' — ' + e.observacao_saida : ''}` : null],
    ['Observações', e.observacoes]
  ].filter(([, valor]) => valor);
  document.getElementById('fe-dados').innerHTML = linhas.map(([rotulo, valor]) => `<dt>${esc(rotulo)}</dt><dd>${esc(valor)}</dd>`).join('');

  const socios = e.socios || [];
  document.getElementById('fe-socios').innerHTML = socios.length
    ? socios.map((s) => `
      <div class="fe-linha">
        <div><strong>${esc(s.nome)}</strong>${s.administrador ? ' <span class="badge badge-pendente">Administrador</span>' : ''}
          <div class="meta">${s.cpf ? 'CPF ' + esc(s.cpf) : ''}</div></div>
        ${s.percentual_participacao ? `<span>${esc(s.percentual_participacao)}%</span>` : ''}
      </div>`).join('')
    : vazio('Nenhum sócio cadastrado.');

  const esteira = ficha.esteira;
  const blocoEsteira = document.getElementById('fe-bloco-esteira');
  if (!esteira) { blocoEsteira.style.display = 'none'; return; }
  const indiceAtual = ETAPAS_ESTEIRA.findIndex(([chave]) => chave === esteira.estagio);
  const responsaveis = (esteira.responsaveis_estagio_atual || []).map((r) => r.nome + (r.setor ? ` (${r.setor})` : '')).join(', ');
  document.getElementById('fe-esteira').innerHTML = `
    <div class="fe-esteira">
      ${ETAPAS_ESTEIRA.map(([chave, rotulo], i) => `<span class="fe-etapa ${i < indiceAtual ? 'feita' : i === indiceAtual ? 'atual' : ''}">${i < indiceAtual ? '✓ ' : ''}${rotulo}</span>`).join('')}
    </div>
    ${responsaveis ? `<p class="fe-vazio">Agora com: <strong>${esc(responsaveis)}</strong></p>` : ''}`;
}

// ---------------- Legalização ----------------
function renderizarProcessos() {
  document.getElementById('fe-processos').innerHTML = ficha.processos.length
    ? `<div class="tabela-wrap"><table>
        <thead><tr><th>Tipo</th><th>Etapa atual</th><th>Documentos</th><th>Órgão / protocolo</th><th>Prazo previsto</th><th>Status</th></tr></thead>
        <tbody>${ficha.processos.map((p) => `
          <tr>
            <td><strong>${esc(ROTULOS_TIPO_PROCESSO[p.tipo] || p.tipo)}</strong>${p.descricao ? `<br><span style="font-size:var(--text-xs); color:var(--color-text-muted);">${esc(p.descricao)}</span>` : ''}</td>
            <td>${esc(p.etapa_atual) || (p.status === 'concluido' ? 'Todas concluídas' : '—')}</td>
            <td>${p.documentos && p.documentos.total
              ? `<span style="font-weight:600; color:${p.documentos.recebidos === p.documentos.total ? 'var(--color-emerald)' : 'var(--color-text)'};">${p.documentos.recebidos} de ${p.documentos.total}</span>`
              : '—'}</td>
            <td>${esc(p.orgao) || '—'}${p.protocolo ? `<br><span class="ledger" style="font-size:var(--text-xs);">${esc(p.protocolo)}</span>` : ''}</td>
            <td>${formatarDataBR(p.data_prevista_conclusao) || '—'}</td>
            <td>${badge(CLASSE_STATUS_PROCESSO[p.status] || '', ROTULOS_STATUS_PROCESSO[p.status] || p.status)}</td>
          </tr>`).join('')}</tbody>
      </table></div>
      <p class="fe-vazio"><a class="link-acao" href="/pages/processos.html">Abrir o quadro da Legalização</a> para mover etapas e marcar documentos.</p>`
    : vazio('Nenhum processo de legalização para esta empresa.');
}

// ---------------- Vencimentos ----------------
function linhasValidade(lista, rotulos, textoVazio) {
  return lista.length
    ? lista.map((i) => `
      <div class="fe-linha">
        <div><strong>${esc(rotulos[i.tipo] || i.tipo)}</strong>
          <div class="meta">Validade: ${formatarDataBR(i.data_validade) || '—'}${i.numero_certidao || i.numero_licenca ? ' · nº ' + esc(i.numero_certidao || i.numero_licenca) : ''}</div></div>
        ${badge(`badge-${i.status}`, ROTULOS_VALIDADE[i.status] || i.status)}
      </div>`).join('')
    : vazio(textoVazio);
}

function renderizarVencimentos() {
  document.getElementById('fe-certidoes').innerHTML = linhasValidade(ficha.certidoes, ROTULOS_TIPO_CERTIDAO, 'Nenhuma certidão cadastrada.');
  document.getElementById('fe-licencas').innerHTML = linhasValidade(ficha.licencas, ROTULOS_TIPO_LICENCA, 'Nenhuma licença cadastrada.');
  document.getElementById('fe-certificados').innerHTML = linhasValidade(ficha.certificados, ROTULOS_TIPO_CERTIFICADO, 'Nenhum certificado cadastrado.');
}

// ---------------- Documentos ----------------
function renderizarDocumentos() {
  const el = document.getElementById('fe-documentos');
  if (!ficha.documentos.length) {
    el.innerHTML = vazio('Nenhum documento enviado ainda.') + `<a class="btn btn-secundario" href="${linkAcao('documentos')}">Enviar documento</a>`;
    return;
  }
  el.innerHTML = ficha.documentos.map((d) => `
    <div class="item-documento">
      <div>
        <strong>${esc(d.nome_original)}</strong>
        <div class="meta">
          ${esc(ROTULOS_CATEGORIA[d.categoria] || d.categoria)} • ${formatarTamanho(d.tamanho_bytes)} • ${dataHora(d.criado_em)}
          ${d.enviado_por_nome ? '• enviado por ' + esc(d.enviado_por_nome) : ''}
          ${!d.enviado_por ? '• enviado pelo cliente' + (d.enviado_por_cliente_nome ? ' (' + esc(d.enviado_por_cliente_nome) + ')' : '') : ''}
        </div>
        ${d.descricao ? `<div class="meta">${esc(d.descricao)}</div>` : ''}
        <div class="meta">${d.visivel_cliente ? '<span class="badge badge-valida">Cliente vê</span>' : '<span class="badge badge-emissao_pendente">Só o escritório vê</span>'}</div>
      </div>
      <div><button class="link-acao" data-baixar="${esc(d.id)}" data-nome="${esc(d.nome_original)}">Baixar</button></div>
    </div>`).join('') + `<p class="fe-vazio"><a class="link-acao" href="${linkAcao('documentos')}">Gerenciar documentos</a> (enviar, mostrar ao cliente, excluir).</p>`;

  el.querySelectorAll('[data-baixar]').forEach((btn) => btn.addEventListener('click', async () => {
    try {
      const resp = await fetch(`${API_BASE}/documentos/${encodeURIComponent(btn.dataset.baixar)}/download`, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!resp.ok) throw new Error('Não foi possível baixar o arquivo.');
      const url = URL.createObjectURL(await resp.blob());
      const a = document.createElement('a');
      a.href = url; a.download = btn.dataset.nome;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { notificar(err.message, 'erro'); }
  }));
}

// ---------------- Setores e pedidos ----------------
function renderizarTarefas() {
  const el = document.getElementById('fe-tarefas');
  if (!ficha.setores_visiveis.length) {
    el.innerHTML = vazio('Seu perfil não acompanha tarefas de setor.');
    return;
  }
  if (!ficha.tarefas.length) {
    el.innerHTML = vazio('Nenhuma tarefa ou pedido do cliente para esta empresa nos seus setores.');
    return;
  }
  el.innerHTML = `<div class="tabela-wrap"><table>
    <thead><tr><th>Setor</th><th>Atividade</th><th>Responsável</th><th>Prazo</th><th>Status</th><th></th></tr></thead>
    <tbody>${ficha.tarefas.map((t) => `
      <tr class="${t.atrasada ? 'linha-atrasada' : ''}">
        <td><a class="link-empresa" href="${PAGINA_SETOR[t.setor]}">${esc(ROTULOS_SETOR[t.setor] || t.setor)}</a></td>
        <td>${t.solicitado_por_cliente ? htmlPedidoCliente(t.descricao) : `<span style="white-space:pre-line;">${esc(t.descricao)}</span>`}</td>
        <td>${esc(t.responsavel_nome || t.responsavel_email) || '—'}</td>
        <td>${t.prazo ? `<span class="prazo-tarefa ${t.atrasada ? 'atrasada' : ''}">${new Date(t.prazo).toLocaleDateString('pt-BR')}${t.atrasada ? '<span class="sub">Atrasada</span>' : ''}</span>` : '—'}</td>
        <td>${badge(CLASSE_STATUS_TAREFA[t.status] || '', ROTULOS_STATUS_TAREFA[t.status] || t.status)}</td>
        <td>${t.solicitado_por_cliente && t.status !== 'concluido'
          ? `<button class="btn" style="height:32px; padding:0 12px; font-size:var(--text-xs);" data-concluir="${esc(t.id)}">Concluir e responder</button>` : ''}</td>
      </tr>`).join('')}</tbody>
  </table></div>`;

  el.querySelectorAll('[data-concluir]').forEach((btn) => btn.addEventListener('click', () => {
    const tarefa = ficha.tarefas.find((t) => t.id === btn.dataset.concluir);
    abrirModalConcluirPedido({ ...tarefa, razao_social: ficha.empresa.razao_social }, tarefa.setor, carregar);
  }));
}

// ---------------- Cliente e comunicação ----------------
function renderizarCliente() {
  const acessos = ficha.acessos_cliente;
  document.getElementById('fe-acessos').innerHTML = acessos === null
    ? vazio('Seu perfil não gerencia os acessos da Área do Cliente.')
    : acessos.length
      ? acessos.map((c) => `
        <div class="fe-linha">
          <div><strong>${esc(c.nome || c.email)}</strong>
            <div class="meta">${esc(c.email)}${c.ultimo_login ? ' · último acesso ' + dataHora(c.ultimo_login) : ''}</div></div>
          ${c.senha_definida ? badge('badge-valida', 'Senha criada') : badge('badge-a_vencer', 'Aguardando senha')}
        </div>`).join('') + `<p class="fe-vazio"><a class="link-acao" href="${linkAcao('portal')}">Gerenciar acessos</a></p>`
      : vazio('Ninguém tem acesso ainda.') + `<a class="btn btn-secundario" href="${linkAcao('portal')}">Liberar acesso</a>`;

  const canal = { email: 'E-mail', whatsapp: 'WhatsApp' };
  document.getElementById('fe-comunicacoes').innerHTML = ficha.comunicacoes.length
    ? ficha.comunicacoes.map((m) => `
      <div class="fe-linha">
        <div style="min-width:0; flex:1;"><strong>${esc(m.assunto || canal[m.canal] || m.canal)}</strong>
          <div class="meta">${esc(canal[m.canal] || m.canal)} para ${esc(m.destinatario)} · ${dataHora(m.criado_em)}</div></div>
        ${m.status === 'enviado' ? badge('badge-valida', 'Enviado') : badge('badge-vencida', 'Falhou')}
      </div>`).join('')
    : vazio('Nenhuma mensagem enviada para esta empresa.');
}

// ---------------- Carregamento ----------------
async function carregar() {
  if (!empresaId) {
    document.getElementById('fe-carregando').textContent = 'Empresa não informada.';
    return;
  }
  try {
    ficha = await apiFetch(`/empresas/${encodeURIComponent(empresaId)}/ficha`);
    if (!ficha) return;
    const abertos = (lista) => lista.filter((t) => t.status !== 'concluido').length;
    montarAbas({
      legalizacao: ficha.processos.length,
      vencimentos: [...ficha.certidoes, ...ficha.licencas, ...ficha.certificados].filter((i) => i.status === 'vencida' || i.status === 'a_vencer').length,
      documentos: ficha.documentos.length,
      setores: abertos(ficha.tarefas)
    });
    renderizarCabecalho();
    renderizarResumo();
    renderizarProcessos();
    renderizarVencimentos();
    renderizarDocumentos();
    renderizarTarefas();
    renderizarCliente();
    document.getElementById('fe-carregando').style.display = 'none';
    document.getElementById('fe-conteudo').style.display = 'block';
    abrirAba(window.location.hash.slice(1) || 'resumo');
  } catch (err) {
    document.getElementById('fe-carregando').textContent = err.message;
  }
}

carregar();
