---
id: contatos-site
titulo: Contatos do site (pedidos de diagnóstico)
resumo: Responder quem pediu diagnóstico pelo site do escritório.
grupo: Administração
palavras: contatos do site, diagnostico, formulario, pagina sobre, site, novo cliente, lead, interessado, orcamento
---
Quando alguém preenche o formulário **"Agende o seu diagnóstico"** na página **Sobre** do escritório, o pedido aparece na tela **Contatos do site** (menu **Administração**).

Quem pode: administrador.

## Quando chega um pedido

- Os administradores recebem um **aviso no sininho**.
- Um **e-mail interno** vai para o endereço de `CONTATO_SITE_EMAIL` no `.env` (se estiver vazio, vai para o e-mail do administrador). Responder esse e-mail responde direto para a pessoa.

## Acompanhar

1. Abra **Contatos do site**.
2. Veja o nome, o e-mail, o WhatsApp (clique para abrir a conversa), a faixa de faturamento e do que a pessoa precisa.
3. Mude a **Situação** conforme o atendimento: **Novo**, **Em contato**, **Virou cliente** ou **Descartado**.
4. Escreva uma **Anotação** (por exemplo, "liguei dia 20, retornar semana que vem"). Ela é salva quando você clica fora do campo.

Use o filtro de situação para ver só os novos. **"Exportar Excel"** baixa a lista.

> O formulário tem proteção contra robôs: poucos envios por hora do mesmo endereço e um campo escondido que só robôs preenchem.
