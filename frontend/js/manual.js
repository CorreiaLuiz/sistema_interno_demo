/**
 * Mostra um manual (equipe ou cliente): uma tela inicial com os assuntos em cartões e as
 * perguntas frequentes, e cada assunto na sua própria página (com "Neste assunto",
 * anterior/próximo e imagens ampliáveis). A busca procura em todo o manual.
 * Usado por pages/ajuda.html (equipe) e pages/cliente-ajuda.html (cliente).
 *
 *   montarManual({ endpoint, token, indice, conteudo, busca })
 *
 * Endereços: ajuda.html (início) e ajuda.html#<id do assunto>.
 */
function montarManual({ endpoint, token, indice, conteudo, busca }) {
  const escapar = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  let secoes = [];
  let frequentes = [];

  /** Assuntos agrupados, na ordem em que aparecem no manual. */
  function agrupar(lista) {
    const grupos = [];
    for (const s of lista) {
      let g = grupos.find((x) => x.nome === s.grupo);
      if (!g) { g = { nome: s.grupo, itens: [] }; grupos.push(g); }
      g.itens.push(s);
    }
    return grupos;
  }

  const idAtual = () => decodeURIComponent(window.location.hash.slice(1));

  function desenharIndice() {
    const atual = idAtual();
    indice.querySelector('.aj-lista').innerHTML = `<a href="#" data-id="" class="aj-inicio${atual ? '' : ' ativo'}">Início do manual</a>`
      + agrupar(secoes).map((g) => `${g.nome ? `<h4>${escapar(g.nome)}</h4>` : ''}${g.itens.map((s) =>
        `<a href="#${encodeURIComponent(s.id)}" data-id="${escapar(s.id)}"${s.id === atual ? ' class="ativo" aria-current="page"' : ''}>${escapar(s.titulo)}</a>`).join('')}`).join('');
  }

  /** Respostas curtas (texto simples → HTML seguro: **negrito**, listas e parágrafos). */
  function formatarCurto(texto) {
    const html = [];
    let lista = null;
    const inline = (t) => escapar(t).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    for (const l of String(texto || '').split(/\r?\n/)) {
      const item = /^\s*(\d+[.)]|[-•*])\s+(.*)$/.exec(l);
      if (item) {
        const tipo = /\d/.test(item[1]) ? 'ol' : 'ul';
        if (lista !== tipo) { if (lista) html.push(`</${lista}>`); html.push(`<${tipo}>`); lista = tipo; }
        html.push(`<li>${inline(item[2])}</li>`);
      } else {
        if (lista) { html.push(`</${lista}>`); lista = null; }
        if (l.trim()) html.push(`<p>${inline(l.trim())}</p>`);
      }
    }
    if (lista) html.push(`</${lista}>`);
    return html.join('');
  }

  function telaInicio() {
    const cartoes = agrupar(secoes).map((g) => `
      <section class="aj-grupo">
        ${g.nome ? `<h3>${escapar(g.nome)}</h3>` : ''}
        <div class="aj-cartoes">${g.itens.map((s) => `
          <a class="aj-cartao" href="#${encodeURIComponent(s.id)}">
            <strong>${escapar(s.titulo)}</strong>
            ${s.resumo ? `<span>${escapar(s.resumo)}</span>` : ''}
          </a>`).join('')}
        </div>
      </section>`).join('');
    const faq = frequentes.length ? `
      <section class="aj-grupo">
        <h3>Perguntas frequentes</h3>
        <div class="aj-faq">${frequentes.map((f) => `
          <details>
            <summary>${escapar(f.pergunta)}</summary>
            <div class="aj-faq-resposta">${formatarCurto(f.resposta)}
              ${(f.secoes || []).filter((id) => secoes.some((s) => s.id === id)).map((id) => `<a class="link-acao" href="#${encodeURIComponent(id)}">Ver o passo a passo →</a>`).join('')}
            </div>
          </details>`).join('')}
        </div>
      </section>` : '';
    conteudo.innerHTML = `
      <div class="aj-capa">
        <h2>Como podemos ajudar?</h2>
        <p>Escolha um assunto abaixo, procure uma palavra no campo <strong>Buscar no manual</strong> ou clique em <strong>Dúvidas?</strong>, no canto da tela, e pergunte com as suas palavras.</p>
      </div>
      ${faq}
      ${cartoes}`;
  }

  function telaSecao(s) {
    const i = secoes.indexOf(s);
    const anterior = secoes[i - 1];
    const proximo = secoes[i + 1];
    conteudo.innerHTML = `
      <article class="aj-secao" id="secao-${escapar(s.id)}">
        <nav class="aj-trilha" aria-label="Você está em"><a href="#">Manual</a>${s.grupo ? ` <span>›</span> ${escapar(s.grupo)}` : ''}</nav>
        <h2>${escapar(s.titulo)}</h2>
        ${s.resumo ? `<p class="aj-lead">${escapar(s.resumo)}</p>` : ''}
        <div class="aj-topicos"></div>
        <div class="aj-corpo">${s.html}</div>
      </article>
      <nav class="aj-navegar" aria-label="Outros assuntos">
        ${anterior ? `<a href="#${encodeURIComponent(anterior.id)}" class="aj-ant"><span>← Anterior</span>${escapar(anterior.titulo)}</a>` : '<span></span>'}
        ${proximo ? `<a href="#${encodeURIComponent(proximo.id)}" class="aj-prox"><span>Próximo →</span>${escapar(proximo.titulo)}</a>` : '<span></span>'}
      </nav>`;
    // "Neste assunto": atalhos para os subtítulos (sem mudar o endereço)
    const subtitulos = [...conteudo.querySelectorAll('.aj-corpo h3')];
    subtitulos.forEach((h, n) => { h.id = `${s.id}--${n}`; });
    if (subtitulos.length >= 2) {
      const caixa = conteudo.querySelector('.aj-topicos');
      caixa.innerHTML = `<strong>Neste assunto:</strong> ${subtitulos.map((h) => `<button type="button" data-ir="${escapar(h.id)}">${escapar(h.textContent)}</button>`).join('')}`;
      caixa.querySelectorAll('[data-ir]').forEach((b) => b.addEventListener('click', () => document.getElementById(b.dataset.ir).scrollIntoView({ behavior: 'smooth', block: 'start' })));
    }
  }

  function telaBusca(texto) {
    const termos = normalizar(texto).split(/\s+/).filter((t) => t.length > 1);
    const achados = secoes.filter((s) => termos.every((t) => s._texto.includes(t)));
    const trecho = (s) => {
      const limpo = s._limpo;
      const pos = normalizar(limpo).indexOf(termos[0]);
      if (pos < 0) return s.resumo || '';
      const ini = Math.max(0, pos - 70);
      return `${ini ? '…' : ''}${limpo.slice(ini, pos + 130).trim()}…`;
    };
    conteudo.innerHTML = `
      <div class="aj-capa"><h2>Resultado da busca</h2><p>${achados.length ? `${achados.length} assunto(s) com “${escapar(texto)}”.` : `Nada encontrado com “${escapar(texto)}”. Tente outra palavra ou pergunte no botão <strong>Dúvidas?</strong>.`}</p></div>
      <div class="aj-cartoes aj-resultados">${achados.map((s) => `
        <a class="aj-cartao" href="#${encodeURIComponent(s.id)}"><strong>${escapar(s.titulo)}</strong><span>${escapar(trecho(s))}</span></a>`).join('')}
      </div>`;
  }

  function mostrar() {
    const texto = busca ? busca.value.trim() : '';
    if (texto.length > 1) { telaBusca(texto); return; }
    const s = secoes.find((x) => x.id === idAtual());
    if (s) telaSecao(s); else telaInicio();
    desenharIndice();
  }

  // Clicar na imagem amplia
  conteudo.addEventListener('click', (e) => {
    const img = e.target.closest('figure img');
    if (!img) return;
    const zoom = document.createElement('div');
    zoom.className = 'aj-zoom';
    zoom.innerHTML = `<img src="${escapar(img.src)}" alt="${escapar(img.alt)}">`;
    zoom.addEventListener('click', () => zoom.remove());
    document.addEventListener('keydown', function sair(ev) { if (ev.key === 'Escape') { zoom.remove(); document.removeEventListener('keydown', sair); } });
    document.body.appendChild(zoom);
  });

  if (busca) busca.addEventListener('input', mostrar);
  window.addEventListener('hashchange', () => {
    if (busca) busca.value = '';
    mostrar();
    window.scrollTo({ top: 0 });
  });
  // "Início do manual" com o endereço já sem assunto: o hashchange não dispara
  indice.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-id=""]');
    if (a && !idAtual()) { e.preventDefault(); if (busca) busca.value = ''; mostrar(); }
  });

  return fetch(endpoint, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    .then((r) => {
      if (r.status === 401) throw Object.assign(new Error('Sua sessão expirou. Entre de novo.'), { sessao: true });
      if (!r.ok) throw new Error('Não foi possível carregar o manual.');
      return r.json();
    })
    .then((dados) => {
      frequentes = dados.frequentes || [];
      secoes = (dados.secoes || []).map((s) => {
        const limpo = s.html.replace(/<figcaption>[\s\S]*?<\/figcaption>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ');
        return { ...s, _limpo: limpo, _texto: normalizar(`${s.titulo} ${s.resumo || ''} ${s.grupo} ${limpo}`) };
      });
      if (!secoes.length) { conteudo.innerHTML = '<p class="aj-vazio">O manual ainda está vazio.</p>'; return dados; }
      mostrar();
      return dados;
    });
}
