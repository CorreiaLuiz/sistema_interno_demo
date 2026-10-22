---
id: usuarios-auditoria
titulo: Usuários, perfis e auditoria (administrador)
resumo: Cadastrar a equipe, definir o que cada um pode fazer e ver o histórico de ações.
grupo: Administração
palavras: usuario, usuarios, colaborador, novo usuario, perfil, funcao, permissao, acesso, redefinir senha, inativo, desativar, auditoria, log, quem fez
---
## Cadastrar um usuário da equipe

Quem pode: administrador.

1. No menu, clique em **"Usuários"** e em **"+ Novo Usuário"**.
2. Preencha **Nome**, **E-mail**, **Senha** (mínimo 8 caracteres), a **Função** e o **Status** (Ativo).
3. Clique em **"Salvar"**.

![Tela de usuários](e-usuarios.png)

## Qual função escolher

- **Administrador** — tudo, inclusive usuários, auditoria e exclusões.
- **Analista de Legalização** — empresas, legalização, Área do Cliente, CND Federal.
- **Analista de Certidões** — certidões e CND Federal.
- **Analista de Licenças** — licenças e alvarás.
- **Supervisor Fiscal / de Contabilidade / de Folha de Pagamento** — todas as tarefas do próprio setor; cria tarefas; Área do Cliente.
- **Colaborador — Fiscal / Contabilidade / Folha** — só as próprias tarefas do setor, e só muda o status.
- **Visualizador** — só consulta.

Isso é o padrão. Para mudar o que cada perfil pode fazer, veja abaixo.

## Mudar o que cada perfil pode fazer

Quem pode: administrador.

1. No menu, clique em **"Usuários"** e desça até **"Permissões dos perfis"**.
2. Cada linha é uma coisa que dá para fazer no sistema; cada coluna é um perfil. **Marque** para liberar e **desmarque** para tirar.
3. A célula que você mexeu fica destacada. Clique em **"Salvar permissões"** e confirme. Para voltar atrás antes de salvar, use **"Desfazer"**.
4. Vale **na hora** para todos daquele perfil: na próxima tela que a pessoa abrir, os botões já aparecem (ou somem).

![Permissões dos perfis](e-permissoes.png)

- O **Administrador** pode tudo, sempre — não dá para desmarcar.
- **"Cadastrar usuários e mudar permissões"** é só do administrador.
- A bolinha **●** ao lado de uma linha mostra que ela está diferente do padrão do sistema. Marcar de novo igual ao padrão tira a bolinha.
- As **tarefas dos setores** (Fiscal, Contabilidade, Folha) seguem o setor da pessoa e não mudam nesta tela.
- Cada mudança fica gravada na **Auditoria** (quem mudou, o que era e como ficou).

## Redefinir a senha de alguém

Na linha do usuário, use a opção de redefinir senha, digite a nova senha (mínimo 8 caracteres) e clique em **"Redefinir"**. Passe a senha à pessoa e peça para ela trocar em **"Alterar minha senha"**.

## Desligar um usuário

Clique em **"Editar"** e mude o **Status** para **Inativo**. A pessoa não entra mais; o histórico dela continua guardado.

## Auditoria

A tela **Auditoria** mostra quem fez o quê e quando (ex.: "Enviou cartão CNPJ ... — visível para o cliente"). Filtre pelo tipo (empresa, certidão, licença, processo, documento, usuário) e clique em **"Filtrar"**.
