/**
 * Questionário de planejamento tributário — página pública aberta pelo
 * link individual (?t=token) que a equipe manda ao cliente. Sem login: o
 * token identifica a empresa. As respostas são conferidas de novo no servidor.
 */
(function () {
  const API = '/api/planejamento/publico/questionario/';
  const token = new URLSearchParams(location.search).get('t') || '';
  const form = document.getElementById('formulario');
  const $ = (id) => document.getElementById(id);

  function mostrarAviso(titulo, texto) {
    $('carregando').hidden = true;
    form.hidden = true;
    $('aviso-titulo').textContent = titulo;
    $('aviso-texto').textContent = texto;
    $('aviso').hidden = false;
    window.scrollTo(0, 0);
  }

  // ---------- botões de opção a partir de data-opcoes ----------
  document.querySelectorAll('[data-opcoes]').forEach((campo) => {
    const nome = campo.dataset.campo;
    const grupo = document.createElement('div');
    grupo.className = 'opcoes';
    JSON.parse(campo.dataset.opcoes).forEach((texto, i) => {
      const l = document.createElement('label');
      l.className = 'opcao';
      const r = document.createElement('input');
      r.type = 'radio'; r.name = nome; r.value = texto; r.id = nome + i;
      l.append(r, document.createTextNode(texto));
      grupo.appendChild(l);
    });
    const erro = document.createElement('div');
    erro.className = 'msg-erro';
    erro.textContent = 'Escolha uma opção.';
    campo.append(grupo, erro);
    grupo.addEventListener('change', () => campo.classList.remove('invalido'));
  });

  // ---------- dinheiro: 1.250.000,50 enquanto digita ----------
  const fat = $('faturamento');
  function mascaraDinheiro(v) {
    v = v.replace(/[^\d,]/g, '');
    const partes = v.split(',');
    let inteiro = partes[0].replace(/^0+(?=\d)/, '');
    const dec = partes.length > 1 ? partes.slice(1).join('').slice(0, 2) : null;
    inteiro = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return dec === null ? inteiro : (inteiro || '0') + ',' + dec;
  }
  const numeroDinheiro = (v) => { const n = Number(v.replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
  fat.addEventListener('input', () => {
    const antes = fat.value.length, pos = fat.selectionStart;
    fat.value = mascaraDinheiro(fat.value);
    const p = Math.max(0, pos + fat.value.length - antes);
    fat.setSelectionRange(p, p);
    fat.closest('.campo').classList.remove('invalido');
  });

  // ---------- percentual ----------
  const margem = $('margem');
  margem.addEventListener('input', () => {
    margem.value = margem.value.replace(/[^\d,]/g, '').replace(/,(?=.*,)/g, '');
    margem.closest('.campo').classList.remove('invalido');
  });
  ['nome', 'email'].forEach((id) => $(id).addEventListener('input', (e) => e.target.closest('.campo').classList.remove('invalido')));

  function marcar(nome, ok) {
    form.querySelector(`[data-campo="${nome}"]`).classList.toggle('invalido', !ok);
    return ok;
  }

  // ---------- envio ----------
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const dados = {};
    let ok = true;
    dados.nome = form.nome.value.trim();
    ok = marcar('nome', dados.nome.length >= 2) && ok;
    dados.email = form.email.value.trim();
    ok = marcar('email', /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dados.email)) && ok;
    document.querySelectorAll('[data-opcoes]').forEach((c) => {
      const marcado = form.querySelector(`input[name="${c.dataset.campo}"]:checked`);
      dados[c.dataset.campo] = marcado ? marcado.value : '';
      ok = marcar(c.dataset.campo, Boolean(marcado)) && ok;
    });
    dados.faturamento_previsto = numeroDinheiro(fat.value);
    ok = marcar('faturamento_previsto', dados.faturamento_previsto > 0) && ok;
    dados.margem_estimada_pct = margem.value === '' ? '' : Number(margem.value.replace(',', '.'));
    ok = marcar('margem_estimada_pct', margem.value !== '' && dados.margem_estimada_pct >= 0 && dados.margem_estimada_pct <= 100) && ok;
    dados.investimentos = form.investimentos.value.trim();
    dados.observacoes = form.observacoes.value.trim();
    dados.site = form.site.value;

    const erroGeral = $('erro-geral');
    erroGeral.style.display = 'none';
    if (!ok) {
      const primeiro = form.querySelector('.invalido');
      if (primeiro) primeiro.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const botao = $('enviar');
    botao.disabled = true;
    botao.textContent = 'Enviando...';
    try {
      const resp = await fetch(API + encodeURIComponent(token), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dados)
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(j.erro || 'Não foi possível enviar.');
      mostrarAviso('Respostas recebidas!', 'Obrigado. Nossa equipe vai analisar suas respostas junto com os dados contábeis da sua empresa e entrará em contato com a recomendação.');
    } catch (err) {
      erroGeral.textContent = `${err.message} Tente novamente em instantes.`;
      erroGeral.style.display = 'block';
      botao.disabled = false;
      botao.textContent = 'Enviar respostas';
    }
  });

  // ---------- abre o questionário pelo token ----------
  (async () => {
    if (!/^[0-9a-f]{48}$/.test(token)) {
      mostrarAviso('Link inválido', 'Confira se o link foi copiado inteiro ou peça um novo ao escritório.');
      return;
    }
    try {
      const resp = await fetch(API + token);
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        mostrarAviso(resp.status === 410 ? 'Link expirado' : 'Link inválido', j.erro || 'Peça um novo link ao escritório.');
        return;
      }
      $('empresa-nome').textContent = j.empresa;
      $('empresa-cnpj').textContent = `CNPJ ${j.cnpj}`;
      $('ja-respondido').hidden = !j.respondido;
      $('carregando').hidden = true;
      form.hidden = false;
    } catch (err) {
      mostrarAviso('Sem conexão', 'Não foi possível abrir o questionário. Tente novamente em instantes.');
    }
  })();
})();
