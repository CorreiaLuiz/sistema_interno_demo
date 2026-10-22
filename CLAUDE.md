# CLAUDE.md — SISTEMA PRIVILEGE (Privilege Contabilidade)

Regras para qualquer pessoa ou IA que mexa neste repositório. **Leia antes de escrever código.**
Várias regras são testes: `npm test` (pasta `backend`) falha se forem quebradas
(`backend/tests/regras-do-sistema.test.js`).

## O que é

Sistema interno do escritório (Node/Express + PostgreSQL, telas em HTML/JS puro em `frontend/`)
e a Área do Cliente. Quem usa não é técnico: **tudo em português simples**, nas telas, nos
erros, no manual e nos commits.

## Regras de ouro

1. **Domínio é só leitura.** O sistema nunca grava no banco do Domínio (`dominioService.js`,
   `dominio-consulta.ps1` só fazem SELECT; na demonstração, `dominioDemo.js` simula). Lançar no Domínio
   é feito pela tela do Domínio, por uma pessoa. *(teste)*
2. **Toda rota da API pede login**, menos a lista `PUBLICAS` do teste de regras. Rota pública
   nova = revisão + entrar na lista. Permissão com `permitir('chave')` (nunca lista de perfis
   fixa): a chave mora em `backend/src/config/permissoes.js` e aparece na tela Usuários →
   "Permissões dos perfis". Nas telas, `pode('chave')` / `data-permissao`. *(teste)*
   O conector do Claude (`/api/mcp`, `conectorService.js`) só CONSULTA e respeita essas permissões.
3. **Segredo nunca vai para o GitHub**: `.env`, `.pfx`, chaves e senhas ficam fora do git.
   Senha de certificado de cliente não é guardada. A pessoa cola as chaves no `.env`; a IA
   não pede nem mostra segredos. *(teste)*
4. **Dados reais não saem do escritório**: testes, prints do manual e a demo usam só dados
   fictícios (banco temporário, apagado no fim). Não copiar o banco real.
5. **Nada que custa ou avisa o cliente roda sozinho**: SERPRO (cobrado por consulta),
   e-mail e WhatsApp só com clique de alguém. Nunca abrir mensagem da Caixa Postal do e-CAC
   (abrir = dar ciência).
6. **Banco muda só por migração** numerada em `database/migrations/` (idempotente:
   `IF NOT EXISTS`). Antes de aplicar no banco real: backup (`database/backup.ps1`).
7. **Ação importante fica na auditoria** (`LogAuditoria.registrar`).
8. **Toda mudança com teste**: unitário em `backend/tests/*.test.js` (sem banco, sem
   internet; IA e serviços externos simulados) e, quando passa por rotas, em
   `backend/tests/integracao/` (banco temporário). `npm test` e `npm run test:integracao`
   verdes antes do commit.
9. **Tela nova ou mudada = manual atualizado** (`backend/manuais/<publico>/*.md`, com
   `resumo:` no cabeçalho) e prints refeitos com `npm run manual:prints`. *(teste das imagens)*
10. **Honestidade**: não dizer que está pronto sem testar; o que ficou faltando vai escrito.

## Onde fica cada coisa

```
backend/src/routes        rotas (finas) → controllers → services (regra) / models (SQL)
backend/src/middlewares   auth (autenticar, autorizar, autenticarCliente), upload, erros
backend/manuais           manual da equipe e do cliente (Markdown) + gerar-prints.js
backend/tests             testes (unitários, regras do sistema, integracao/)
database                  schema.sql, migrations/, backup e restauração
frontend/pages, js, css   telas (api.js = chamadas e utilidades comuns)
```

## Como sobe para o sistema de verdade

1. Trabalhar num worktree/branch, com `backend/.env` de teste (porta e banco próprios).
2. Testes verdes → commit (português, dizendo o que mudou para quem usa).
3. Na pasta principal: `git merge --ff-only <branch>` e `git push origin main`.
4. Migração nova: backup primeiro, depois aplicar.
