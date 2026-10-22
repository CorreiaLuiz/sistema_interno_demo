---
id: conectar-claude
titulo: Conectar o Claude ao sistema (perguntar sobre o escritório)
resumo: Ligar o Claude para ele consultar o sistema e responder perguntas como "o que vence esta semana?".
grupo: Administração
palavras: claude, ia, inteligencia artificial, conector, mcp, chave, conectar, perguntar ao claude, consultar sistema, claude code, claude.ai
---
Com o conector, você conversa com o **Claude** e ele **consulta o sistema na hora** para responder. Por exemplo:

- "Quais certidões e licenças vencem nos próximos 15 dias?"
- "Como está a empresa Padaria Bom Pão?"
- "Quais empresas têm mensagem nova na Caixa Postal?"
- "Tem pedido de cliente atrasado no Fiscal?"

Quem pode: administrador (ele pode liberar para outros perfis em **Usuários → Permissões dos perfis**, linha "Conectar o Claude").

## O que o Claude pode e não pode

- **Só consulta.** Não cadastra, não apaga, não manda e-mail ou guia e não mexe no Domínio. Para fazer algo, ele diz em qual tela do sistema.
- **Com as suas permissões.** Ele vê só o que você vê. Cada consulta fica na **Auditoria**.
- **Não gasta SERPRO.** A Caixa Postal mostra a última verificação feita no sistema, e nenhuma mensagem é aberta.
- Os dados passam pelo Claude (Anthropic) para ele responder, como quando você cola uma informação numa conversa.

## Criar a chave e ligar

1. No menu, clique em **"Ajuda"** e abra a aba **"Conectar o Claude"**.
2. Dê um nome para a chave (ex.: "Claude do meu computador") e clique em **"Criar chave"**.
3. **Copie na hora**: a chave aparece uma vez só.
4. **Claude neste computador (Claude Code):** clique em **"Copiar"** no comando, cole no terminal e aperte **Enter**. Pronto: na próxima conversa o Claude já consulta o sistema.
5. **Aplicativo do Claude (claude.ai):** só funciona quando o sistema estiver na internet. Aí a tela mostra o endereço para colar em **Configurações → Conectores → Adicionar conector personalizado**.

![Conectar o Claude](e-conectar-claude.png)

> **Não mande a chave para ninguém:** quem tiver a chave consulta o sistema como você. Se ela vazar, clique em **"Desligar"** na lista **Chaves** — para de funcionar na hora — e crie outra.

## Desligar uma chave

Na lista **Chaves**, clique em **"Desligar"** e confirme. A lista mostra quando cada chave foi usada pela última vez e quantas consultas fez. O administrador vê as chaves de todos.
