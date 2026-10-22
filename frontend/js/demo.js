/**
 * Modo demonstração: se o servidor estiver com MODO_DEMO=true, mostra uma
 * faixa avisando que os dados são fictícios e, nas telas de login, botões
 * para entrar com os usuários de exemplo. Fora da demonstração não faz nada.
 */
(function () {
  const ESTILO = `
    .demo-faixa { position: sticky; top: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; gap: 8px;
      padding: 6px 14px; background: linear-gradient(90deg, #430A0D, #660000); color: #F7F1E7; font: 600 12px/1.4 Inter, system-ui, sans-serif;
      letter-spacing: .02em; text-align: center; }
    .demo-faixa b { color: #E9D3AE; letter-spacing: .08em; }
    @media (max-width: 640px) { .demo-faixa .longo { display: none; } }
    .demo-login { margin-top: 22px; padding: 16px; border: 1px dashed rgba(201,155,89,.7); border-radius: 12px; background: rgba(201,155,89,.08); }
    .demo-login p { margin: 0 0 10px; font-size: 13px; color: inherit; opacity: .85; }
    .demo-login .demo-botoes { display: flex; flex-wrap: wrap; gap: 8px; }
    .demo-login button { flex: 1 1 140px; padding: 9px 12px; border-radius: 9px; border: 1px solid rgba(201,155,89,.6); background: transparent;
      color: inherit; font: 600 13px Inter, system-ui, sans-serif; cursor: pointer; }
    .demo-login button:hover { background: rgba(201,155,89,.18); }
    .demo-login small { display: block; margin-top: 10px; font-size: 12px; opacity: .7; }`;

  function entrarCom(email, senha) {
    const campoEmail = document.getElementById('email');
    const campoSenha = document.getElementById('senha');
    const form = document.getElementById('form-login');
    if (!campoEmail || !campoSenha || !form) return;
    campoEmail.value = email;
    campoSenha.value = senha;
    form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true }));
  }

  fetch('/api/demo').then((r) => r.json()).then((info) => {
    if (!info || !info.demo) return;
    const estilo = document.createElement('style');
    estilo.textContent = ESTILO;
    document.head.appendChild(estilo);

    const faixa = document.createElement('div');
    faixa.className = 'demo-faixa';
    faixa.innerHTML = '<b>DEMONSTRAÇÃO</b> Todos os dados são fictícios<span class="longo"> · e-mails, WhatsApp, SERPRO e Domínio são simulados</span>';
    // Telas de login usam a página inteira em duas colunas: a faixa fica por cima
    if (document.getElementById('form-login')) {
      faixa.style.position = 'fixed';
      faixa.style.left = '0';
      faixa.style.right = '0';
      document.body.style.paddingTop = '30px';
    }
    document.body.prepend(faixa);

    const form = document.getElementById('form-login');
    if (!form) return;
    const ehCliente = /cliente-login/.test(location.pathname);
    const contas = ehCliente ? [{ email: info.cliente.email, rotulo: 'Entrar como cliente' }] : info.contas;
    const caixa = document.createElement('div');
    caixa.className = 'demo-login';
    caixa.innerHTML = `<p>${ehCliente ? 'Área do Cliente de demonstração:' : 'Entre com um usuário de exemplo:'}</p>
      <div class="demo-botoes">${contas.map((c, i) => `<button type="button" data-i="${i}">${c.rotulo}</button>`).join('')}</div>
      <small>Senha de todos: <b>${info.senha}</b></small>`;
    caixa.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => entrarCom(contas[b.dataset.i].email, info.senha)));
    form.after(caixa);
  }).catch(() => { /* servidor sem a rota: não é demonstração */ });
})();
