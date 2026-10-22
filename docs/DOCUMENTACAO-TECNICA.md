# Sistema de Gestão de Legalização, CNDs e Licenças

Sistema web interno para escritório de contabilidade, cobrindo:
- Legalização de empresas (abertura, alteração, baixa)
- CNDs (federais, estaduais, municipais, trabalhistas, FGTS)
- Licenças e Alvarás (Vigilância Sanitária, Bombeiros, Ambiental, Funcionamento)
- Upload e organização segura de documentos

Uso exclusivo dos colaboradores do escritório — não há acesso de clientes.

## Estrutura do projeto

```
sistema-legalizacao/
├── database/
│   └── schema.sql              # Script completo de criação do banco (PostgreSQL)
├── backend/
│   ├── src/
│   │   ├── config/db.js        # Conexão com PostgreSQL (pool)
│   │   ├── controllers/        # Regras de negócio das rotas
│   │   ├── middlewares/        # auth (JWT), upload (multer), errorHandler
│   │   ├── models/              # Camada de acesso a dados (SQL)
│   │   ├── routes/              # Definição das rotas REST
│   │   ├── utils/seedAdmin.js  # Cria o primeiro usuário administrador
│   │   └── server.js           # Ponto de entrada da API
│   ├── uploads/                 # Armazenamento de arquivos enviados
│   ├── .env.example
│   └── package.json
└── frontend/
    ├── css/style.css
    ├── js/
    │   ├── api.js                # Cliente HTTP central (fetch + JWT)
    │   ├── empresas.js           # inclui upload/listagem de documentos
    │   ├── processos.js
    │   ├── certidoes.js
    │   └── licencas.js
    └── pages/
        ├── login.html
        ├── empresas.html
        ├── processos.html
        ├── certidoes.html
        └── licencas.html
```

Sistema **completo**: autenticação + os 4 módulos funcionais (Empresas,
Processos de Legalização, Certidões/CNDs, Licenças/Alvarás) + upload e gestão
de Documentos vinculados a qualquer uma dessas entidades.

### Módulo de Empresas

CRUD completo (`/api/empresas`), com sócios (`/api/empresas/:id/socios`).

### Módulo de Processos de Legalização

- `GET /api/processos-legalizacao` — lista com filtros `empresa_id`, `status`, `tipo`
- `GET /api/processos-legalizacao/resumo/status` — contadores por status
- `GET /api/processos-legalizacao/:id` — detalhe + histórico completo de mudanças de status
- `POST /api/processos-legalizacao` — cria um processo (abertura, alteração ou baixa)
- `PUT /api/processos-legalizacao/:id` — atualiza; se o `status` mudar, uma entrada é
  automaticamente registrada no histórico (`processos_legalizacao_historico`), incluindo
  data/hora, usuário responsável e um comentário opcional (`comentario_status`)
- `DELETE /api/processos-legalizacao/:id` — remove (apenas administrador)

Na tela `/pages/processos.html`, o botão "Histórico" mostra a linha do tempo
completa de status de cada processo.

### Módulo de Certidões (CNDs)

- `GET /api/certidoes` — lista com filtros `empresa_id`, `status`, `tipo`, `pagina`, `limite`
- `GET /api/certidoes/resumo/status` — contagem de certidões por status (para dashboard)
- `GET /api/certidoes/:id` — detalhe de uma certidão + histórico de renovações
- `POST /api/certidoes` — cria uma certidão (calcula o status automaticamente a partir da data de validade)
- `PUT /api/certidoes/:id` — atualiza uma certidão
- `DELETE /api/certidoes/:id` — remove uma certidão (apenas administrador)
- `POST /api/certidoes/:id/renovar` — registra uma renovação: salva o histórico com os valores anteriores e atualiza a certidão com a nova validade

O status (`valida`, `a_vencer`, `vencida`, `emissao_pendente`) é recalculado
automaticamente no back-end sempre que uma data de validade é definida ou
alterada — usa a mesma regra de 30 dias da função SQL
`atualizar_status_vencimentos()`.

### Módulo de Licenças e Alvarás

Estrutura idêntica ao módulo de Certidões (mesmo padrão de status, renovação
e resumo), aplicada aos tipos: Vigilância Sanitária, Bombeiros, Ambiental e
Funcionamento.

- `GET /api/licencas`, `GET /api/licencas/resumo/status`, `GET /api/licencas/:id`
- `POST /api/licencas`, `PUT /api/licencas/:id`, `DELETE /api/licencas/:id`
- `POST /api/licencas/:id/renovar`

### CND Federal pelo SERPRO (a partir da tela de Empresas)

No menu de cada empresa, **"CND Federal"** abre a última consulta guardada
(sem custo) e o botão **"Consultar agora"** chama a API **Consulta CND** do
SERPRO (`backend/src/services/serproCndService.js`) — certidão de débitos
federais da Receita e PGFN. Cada consulta é cobrada pelo SERPRO, por isso só
acontece no clique e só administrador, analista de legalização e analista de
certidões podem consultar (fica registrado na auditoria).

- Status 1/2: certidão válida — o PDF vira documento da empresa (categoria
  Certidão, visível na Área do Cliente) e a certidão é atualizada.
- Status 3/4: não emitida (pendências) — a certidão fica "Com pendência".
- Status 5/6 (instabilidade, não cobrados) são repetidos uma vez; status 7
  é repetido com a "Chave" (repetições não são cobradas).

Configuração: `SERPRO_CND_CONSUMER_KEY` e `SERPRO_CND_CONSUMER_SECRET` no
`backend/.env`. Estaduais, municipais, trabalhista e FGTS continuam sendo
cadastradas à mão na tela Certidões.

A certidão também aparece na tela `/pages/certidoes.html`.

### Tarefas por Setor (Fiscal, Contabilidade, Folha de Pagamento)

Depois que a Legalização conclui a abertura de uma empresa, cada setor
operacional cadastra suas próprias tarefas e atribui um responsável —
**por e-mail**, não precisa ser um usuário do sistema (pode ser alguém
que só recebe a notificação, sem login).

**Papéis novos:** `supervisor_fiscal`, `supervisor_contabilidade`,
`supervisor_folha_pagamento` — cada um só enxerga e cadastra tarefas do
próprio setor; `administrador` enxerga os três. Atribua esses papéis na
tela de Usuários (ex: um supervisor para o Fiscal, um para a
Contabilidade e um para a Folha de Pagamento).

Há também um papel de **colaborador, específico por setor** (migração 008):
`colaborador_fiscal`, `colaborador_contabilidade`, `colaborador_folha_pagamento`
— cada um só acessa a tela do próprio setor (o mesmo `403` que bloqueia
supervisores tentando outro setor também vale aqui). Dentro do próprio
setor, a listagem já vem **sempre filtrada só pelas próprias tarefas**
— identificadas comparando o e-mail de login com o `responsavel_email`
cadastrado na tarefa (o filtro é aplicado no backend, em `GET /:setor` e
`GET /:setor/resumo`, não só escondido na tela). Ele só pode **marcar o
status** dessas tarefas — não cria, não exclui, e não vê nem edita
tarefa de mais ninguém.

*(Existia antes um papel genérico `colaborador`, sem setor definido, que
dava acesso de leitura a qualquer um dos três setores — a migração 008
substitui isso e já migra automaticamente quem estava nesse papel antigo
para `colaborador_fiscal`, ajustável depois na tela de Usuários.)*

**Telas:** `/pages/fiscal.html`, `/pages/contabilidade.html`,
`/pages/folha-pagamento.html` — cada uma só aparece no menu lateral para
quem tem o papel correspondente (ou para administrador). Em cada tela:
cards de resumo por status, tabela de tarefas com filtro, botão "+ Nova
Tarefa" (escolhe a empresa, descreve as atividades, informa nome e
e-mail do responsável), e troca de status direto na tabela.

**Rotas** (`/api/tarefas-setor/:setor/...`, onde `:setor` é `fiscal`,
`contabilidade` ou `folha_pagamento`):
- `GET /:setor` — lista tarefas (filtros `empresa_id`, `status`, `pagina`, `limite`)
- `GET /:setor/resumo` — contagem por status
- `POST /:setor` — cria uma tarefa e dispara e-mail ao responsável
- `PUT /:setor/:id` — atualiza status/descrição/responsável
- `DELETE /:setor/:id` — remove

A permissão por setor é verificada no controller (não dá pra expressar
"só o supervisor deste setor específico" numa lista fixa de papéis) —
um supervisor de Contabilidade que tentar acessar `/api/tarefas-setor/fiscal`
recebe `403 Forbidden`, mesmo estando autenticado.

Toda tarefa criada dispara automaticamente um e-mail para
`responsavel_email`, usando a mesma lógica real/simulada do restante do
sistema (ver seção de e-mail logo abaixo), e fica registrada em
`historico_comunicacao` e `logs_auditoria`.

**Certificado digital:** não criamos uma tabela nova para isso — é só
uma categoria a mais no upload de Documentos (`certificado_digital`),
reaproveitando o que já existia. Baixe/salve o certificado da empresa
pela tela de Empresas → Documentos, igual a qualquer outro arquivo.

### Etapas de Processo (checklist, responsável e status)

Cada processo de legalização já nasce com um checklist padrão de etapas
conforme o tipo (ex: abertura → Junta Comercial, Receita Federal/DBE,
Inscrição Estadual, Alvará). Cada etapa tem:

- **Status**: `pendente`, `em_andamento`, `exigencia` ou `concluido`
  (o antigo campo booleano `concluida` continua existindo e é mantido
  em sincronia automaticamente por um trigger no banco — nada que já
  lia esse campo quebra).
- **Responsável**: um usuário do sistema (administrador ou analista de
  legalização) atribuído àquela etapa específica.

Rotas em `/api/processos-legalizacao/:id/etapas`:
`GET` lista, `POST` adiciona uma etapa extra, `PATCH .../etapas/:etapaId`
atualiza status/responsável/observações (aceita qualquer combinação —
campos omitidos não são alterados), `DELETE` remove.
`GET /api/processos-legalizacao/responsaveis-elegiveis` lista os usuários
que podem ser atribuídos (qualquer colaborador autenticado pode consultar,
não só administrador).

Na tela de Legalização, o botão **"Etapas"** em cada processo abre o
checklist com um `<select>` de status e um `<select>` de responsável por
etapa, além do campo no rodapé para adicionar etapas extras.

Sempre que uma etapa **ganha um responsável novo**, o sistema dispara (em segundo plano) uma notificação
por e-mail para esse responsável, registrada em `historico_comunicacao`
— usa a mesma configuração de SMTP do restante do sistema (ver seção de
e-mail logo abaixo): real se `NOTIF_EMAIL_HOST` estiver configurado,
simulado/logado no console se não estiver.

### Comunicação automática (e-mail/WhatsApp) e histórico

Sempre que o **status de um processo muda** (`PUT /api/processos-legalizacao/:id`
com um `status` diferente do atual), o sistema dispara automaticamente uma
notificação por e-mail e/ou WhatsApp para a empresa (usando os campos
`email`/`telefone` já cadastrados) e registra tudo em `historico_comunicacao`
— consultável via `GET /api/empresas/:id/comunicacoes`.

**O envio por e-mail agora tem integração real implementada** via SMTP
(biblioteca `nodemailer`). Para ativar, preencha no `.env`:

```
NOTIF_EMAIL_HOST=smtp.seu-provedor.com
NOTIF_EMAIL_PORT=587
NOTIF_EMAIL_SECURE=false      # true só se a porta for 465
NOTIF_EMAIL_USER=seu-email@dominio.com
NOTIF_EMAIL_PASS=sua-senha-ou-senha-de-app
NOTIF_EMAIL_FROM=seu-email@dominio.com
```

**Se o e-mail do domínio estiver no Microsoft 365 / Outlook**, os valores de `HOST`/`PORT`/`SECURE` são sempre os
mesmos, independente da caixa de e-mail usada:

```
NOTIF_EMAIL_HOST=smtp.office365.com
NOTIF_EMAIL_PORT=587
NOTIF_EMAIL_SECURE=false
NOTIF_EMAIL_USER=avisos@seu-escritorio.com.br
NOTIF_EMAIL_PASS=a-senha-dessa-caixa-de-e-mail
NOTIF_EMAIL_FROM=avisos@seu-escritorio.com.br
```

Dois detalhes que costumam pegar todo mundo de surpresa no Microsoft 365:
1. **Autenticação multifator (MFA) ativada** na conta impede login comum
   por SMTP — nesse caso, é preciso gerar uma **"senha de aplicativo"**
   (App Password) nas configurações de segurança da conta Microsoft, e
   usar essa senha gerada em `NOTIF_EMAIL_PASS` (não a senha normal).
2. **SMTP AUTH pode estar desabilitado por padrão** no tenant — se o
   login falhar mesmo com a senha certa, um administrador do Microsoft
   365 (Painel Admin → Usuários → aquele usuário → Configurações de
   e-mail) precisa habilitar "Autenticação SMTP" para essa caixa
   específica.

Sem `NOTIF_EMAIL_HOST` configurado, o envio continua simulado/logado no
console, como antes. **Antes de usar de verdade**, teste a configuração
isoladamente (sem precisar subir o sistema inteiro):

```bash
cd backend
node src/utils/testarEmail.js                      # só testa login no servidor SMTP
node src/utils/testarEmail.js destino@teste.com     # testa login E envia um e-mail de teste
```

Os valores exatos de `HOST`/`PORT`/`SECURE` dependem de onde o e-mail do
domínio está hospedado (Google Workspace, Microsoft 365, ou o provedor
de hospedagem do site) — cada um tem servidor SMTP próprio.

O envio por **WhatsApp já está com integração real implementada**, no
formato de "API (push)" usado por plataformas de atendimento que expõem
esse padrão (URL autenticada + JSON com `number`/`body`/`externalKey`).
Para ativar, gere a URL autenticada no painel do seu provedor (geralmente
em Configurações → API/Webhook → Adicionar) e cole em
`NOTIF_WHATSAPP_API_URL` no `.env` — nenhum código precisa mudar. Sem essa
variável configurada, o envio continua simulado/logado no console, igual
ao e-mail. Se seu provedor for outro (Z-API, Evolution API, WhatsApp
Business Platform oficial), o formato do corpo da requisição é diferente
— ajuste a função `enviarWhatsapp` nesse mesmo arquivo.

### Quadro da Legalização e checklist de documentos

- **Quadro por etapas** (tela de Legalização → "Quadro por etapas"): uma aba
  por tipo (Abertura, Alteração, Baixa) e uma coluna por etapa real (Junta
  Comercial, Receita Federal, Inscrição Estadual, Alvará...) + "Concluído"
  (últimos 30 dias). Cada cartão mostra a empresa, há quantos dias está na
  etapa, o responsável, exigência / prazo vencido e os documentos recebidos.
- **Arrastar e soltar** (administrador e analista de legalização): leva o
  processo para a etapa escolhida — as anteriores ficam concluídas, as
  seguintes pendentes. Arrastar para "Concluído" conclui o processo (com
  confirmação). No celular, botão "Avançar". Rotas:
  `GET /api/processos-legalizacao/pipeline?tipo=` e `POST .../:id/mover`.
- **Checklist de documentos** (clicar no cartão → "Etapas e documentos"):
  lista padrão por tipo em `backend/src/config/checklistLegalizacao.js`,
  com a etapa em que cada documento é usado. Marcar como recebido, anexar
  o arquivo, acrescentar ou remover itens. Processos antigos ganham a lista
  padrão na primeira vez que são abertos. Rotas: `.../:id/checklist`.
- **Animações sutis** em todo o sistema (entrada das telas, números
  contando, esqueleto de carregamento) — desligadas automaticamente para
  quem ativa "reduzir movimento" no Windows.

### Ficha da empresa, avisos (sininho) e prazos

- **Ficha da empresa** (`/pages/empresa.html?id=...`): clicar no nome de uma
  empresa em qualquer lista abre tudo sobre ela em abas — dados e sócios,
  esteira, processos, certidões/licenças/certificado, documentos, tarefas e
  pedidos do cliente, acessos à Área do Cliente e mensagens enviadas. Cada
  papel vê só os setores dele (`GET /api/empresas/:id/ficha`).
- **Avisos no sistema (sininho no topo)**: nova tarefa/repasse, pedido do
  cliente, documento enviado pelo cliente, processo em exigência, etapa
  designada, esteira de empresa nova e vencimentos. Funcionam mesmo sem
  e-mail configurado (`/api/notificacoes`; lidos somem após 90 dias).
- **Prazos nas tarefas dos setores**: coluna de prazo, atrasadas em vermelho
  e no topo, card "Atrasadas" e filtro **Mostrar** (Minhas tarefas,
  Atrasadas, Pedidos de clientes).
- **Exportar Excel** nas listas de Empresas, Legalização, Certidões,
  Licenças e tarefas dos setores (CSV com acentos, abre direto no Excel).
- **Dashboard**: quadro "Pedidos de clientes" aguardando resposta por setor.
- **Auditoria** em frases ("Enviou cartão CNPJ ... — visível para o cliente").
- **Pedidos de Legalização** na Área do Cliente (alvará, alteração
  contratual, certidão, licença, encerramento): aparecem no quadro "Pedidos
  dos clientes" da tela de Legalização, para administrador e analista de
  legalização. Responsável: `PORTAL_RESPONSAVEL_LEGALIZACAO_EMAIL` ou
  `ONBOARDING_LEGALIZACAO_EMAIL`.

### Área do Cliente (login do cliente)

O cliente entra em `/pages/cliente-login.html` com **e-mail e senha
próprios** — login separado do da equipe (um token de cliente nunca abre
rotas da equipe, e vice-versa). O antigo acesso por link sem senha foi
desativado na migração 010.

**Liberar o acesso (equipe):** tela de Empresas → **"Área do Cliente"** →
informe o e-mail (vira o login), nome e WhatsApp. O cliente recebe por
e-mail e WhatsApp um link para **criar a própria senha** (válido 7 dias);
o link também aparece na tela, para copiar e mandar por outro canal.
Um mesmo e-mail pode ter **várias empresas** — o cliente troca de empresa
dentro do portal. A mesma tela mostra quem tem acesso, reenvia o convite,
remove o acesso e lista os **últimos downloads** feitos pelo cliente.

**O que o cliente vê:**
- **Início** — "Precisa de atenção" (certidões, licenças e certificado
  digital vencidos ou vencendo em até 30 dias), atalhos (cartão CNPJ,
  2ª via de guia, enviar documento) e a situação da empresa.
- **Documentos** — só os documentos marcados como **"visível para o
  cliente"** (no upload há uma caixinha; cartão CNPJ, contrato social,
  certidões, alvarás, certificado digital e guias já vêm marcados).
  Na lista de documentos da empresa, "Mostrar ao cliente / Ocultar do
  cliente" muda isso a qualquer momento. Certificado `.pfx` pode ser
  enviado e baixado; a **senha do certificado nunca fica no sistema**.
- **Pedidos** — o cliente escolhe setor e tipo (ex: Fiscal → "Regerar
  guia do DAS", Folha → "Regerar guia do INSS/FGTS"), a competência e uma
  observação. O pedido vira uma tarefa marcada **"Pedido do cliente"** na
  tela do setor. A equipe usa **"Concluir e responder"**: anexa a guia
  nova e escreve uma mensagem — o arquivo aparece para o cliente e ele é
  avisado por e-mail e WhatsApp. Os tipos de pedido ficam em
  `backend/src/config/solicitacoesCliente.js`.
- **Minha conta** — trocar senha. "Esqueci minha senha" fica no login.

Quem recebe os pedidos de cada setor: `PORTAL_RESPONSAVEL_FISCAL_EMAIL`,
`PORTAL_RESPONSAVEL_CONTABILIDADE_EMAIL`, `PORTAL_RESPONSAVEL_FOLHA_PAGAMENTO_EMAIL`
no `.env`; se vazios, os responsáveis setoriais da esteira; sem nada, o pedido fica sem responsável e o supervisor
do setor vê do mesmo jeito.

Rotas envolvidas:
- `POST /api/cliente/login`, `/esqueci-senha`, `/definir-senha` e `GET /link-senha/:token` — públicas, com limite de tentativas
- `GET /api/cliente/me`, `POST /trocar-senha`, `GET /tipos-solicitacao` — cliente logado
- `GET /api/cliente/empresas/:empresaId/resumo`, `/documentos`, `/documentos/:id/download`, `/solicitacoes` e `POST` de documentos e solicitações — sempre conferindo se o login tem acesso à empresa
- `GET|POST /api/empresas/:id/acessos-cliente`, `POST .../:clienteId/reenviar`, `DELETE .../:clienteId` — equipe
- `PATCH /api/documentos/:id/visibilidade-cliente` e `POST /api/tarefas-setor/:setor/:id/concluir-pedido` — equipe

### Certificados Digitais (controle de vencimento)

Mesmo padrão de status usado em certidões e licenças (`válida`/`a_vencer`/
`vencida`/`emissão_pendente`, recalculado automaticamente pelo job
diário). Na tela de Empresas, botão **"Certificado Digital"** em cada
linha abre um histórico com tipo (e-CNPJ/e-CPF/outro), número de série,
datas de emissão/validade. Aparece também como card de resumo no
Dashboard, ao lado de Certidões e Licenças.

Rotas: `GET /api/certificados-digitais/empresa/:empresaId`,
`GET /api/certificados-digitais/resumo/status`,
`POST /api/certificados-digitais`, `PUT /api/certificados-digitais/:id`,
`DELETE /api/certificados-digitais/:id`.

### Handoff automático da abertura (Empresa cadastrada → Legalização)

Fecha o **primeiro elo** da corrente completa do escritório. No modal
"Nova Empresa" (só ao criar, não ao editar), há um campo opcional
**"Responsável pela Legalização (abertura)"** — um dropdown com os
administradores e analistas de legalização cadastrados. Se você
escolher alguém ali:

1. A empresa é cadastrada normalmente.
2. Um **processo de legalização (tipo abertura, status "Em andamento")**
   é criado sozinho, já atribuído a essa pessoa, com o checklist padrão
   de etapas populado automaticamente.
3. A pessoa recebe um e-mail avisando que a empresa está com ela.

Isso te dá a corrente completa testada de ponta a ponta:
**Admin cadastra a empresa atribuindo à analista de legalização → processo de abertura nasce
sozinho para ela → a analista trabalha o checklist e conclui indicando o
handoff (seção acima) → tarefa nasce sozinha no setor seguinte
(ex: Folha de Pagamento)** — sem trocar de tela em
nenhum momento entre uma etapa e outra.

Isso é enviado via `POST /api/empresas`, no campo opcional
`responsavel_legalizacao_id`.

### Handoff automático entre setores (Legalização → Fiscal/Contabilidade/Folha)

Quando um processo de legalização é marcado como **"Concluído"**, o
modal de edição mostra três campos opcionais de e-mail (um por setor).
Preenchendo qualquer um deles, o sistema já cria automaticamente a
tarefa correspondente naquele setor — com descrição pré-preenchida
referenciando a empresa e o tipo de processo — e dispara a notificação
por e-mail, exatamente como se o supervisor daquele setor tivesse
cadastrado a tarefa manualmente. Não precisa trocar de tela.

Isso é enviado via `PUT /api/processos-legalizacao/:id`, no campo
`notificar_setores` (ex: `{ "folha_pagamento": "folha@..." }`) —
qualquer combinação dos três setores é aceita, inclusive nenhum (nesse
caso o processo só é concluído normalmente, sem gerar tarefas).

### Módulo de Documentos

Upload genérico associável a **exatamente uma** entidade por documento:
empresa, processo de legalização, certidão ou licença.

- `GET /api/documentos?empresa_id=...` (ou `processo_id`, `certidao_id`, `licenca_id`) — lista os documentos daquela entidade
- `POST /api/documentos` — multipart/form-data com o arquivo no campo `arquivo`
  e o id da entidade em um dos campos acima
- `GET /api/documentos/:id/download` — baixa o arquivo original
- `DELETE /api/documentos/:id` — remove o registro e o arquivo físico

Tipos aceitos: PDF, PNG, JPG (configurável em `middlewares/upload.js`).
Tamanho máximo: `UPLOAD_MAX_SIZE_MB` no `.env` (padrão 15MB). Os arquivos são
salvos com nomes aleatórios no servidor (`backend/uploads/`), nunca com o
nome original, para evitar colisões e ataques de path traversal.

A tela `/pages/empresas.html`, `/pages/processos.html`, `/pages/certidoes.html`
e `/pages/licencas.html` já têm o botão "Documentos" em cada linha da tabela,
abrindo um modal de upload e listagem vinculado àquele registro específico
(empresa, processo, certidão ou licença, respectivamente).

## Pré-requisitos

- Node.js 18 ou superior
- PostgreSQL 14 ou superior

## Passo a passo para rodar localmente

### 1. Criar o banco de dados

```bash
createdb legalizacao_db
psql -d legalizacao_db -f database/schema.sql
psql -d legalizacao_db -f database/migrations/009_entrada_saida_escritorio.sql
psql -d legalizacao_db -f database/migrations/010_login_area_cliente.sql
psql -d legalizacao_db -f database/migrations/011_avisos_e_pedidos_legalizacao.sql
psql -d legalizacao_db -f database/migrations/012_checklist_documentos_processo.sql
psql -d legalizacao_db -f database/migrations/013_importacao_guias.sql
psql -d legalizacao_db -f database/migrations/014_rastreio_emails.sql
```

O `schema.sql` já inclui as migrações 001 a 008; numa instalação nova,
rode só as posteriores (hoje 009 a 016). Para só experimentar, use a
demonstração (`npm run demo` — ver o README na raiz do projeto).

**Se você já tinha o banco criado antes** (instalação existente, não do zero),
rode também as migrações abaixo, na ordem, para trazer seu banco até a versão
atual — o `schema.sql` só é usado para instalações novas:

```bash
psql -U postgres -d legalizacao_db -f database/migrations/001_add_descricao_documentos.sql
psql -U postgres -d legalizacao_db -f database/migrations/002_area_cliente_e_comunicacao.sql
psql -U postgres -d legalizacao_db -f database/migrations/003_seguranca_auditoria_alertas.sql
psql -U postgres -d legalizacao_db -f database/migrations/004_responsaveis_e_tarefas.sql
psql -U postgres -d legalizacao_db -f database/migrations/005_tarefas_setor.sql
psql -U postgres -d legalizacao_db -f database/migrations/006_papel_colaborador.sql
psql -U postgres -d legalizacao_db -f database/migrations/007_certificados_digitais_e_handoff.sql
psql -U postgres -d legalizacao_db -f database/migrations/008_colaborador_por_setor.sql
psql -U postgres -d legalizacao_db -f database/migrations/009_entrada_saida_escritorio.sql
psql -U postgres -d legalizacao_db -f database/migrations/010_login_area_cliente.sql
psql -U postgres -d legalizacao_db -f database/migrations/011_avisos_e_pedidos_legalizacao.sql
psql -U postgres -d legalizacao_db -f database/migrations/012_checklist_documentos_processo.sql
psql -U postgres -d legalizacao_db -f database/migrations/013_importacao_guias.sql
psql -U postgres -d legalizacao_db -f database/migrations/014_rastreio_emails.sql
```

### 2. Configurar o backend

```bash
cd backend
cp .env.example .env
```

Edite o `.env` e ajuste `DB_USER`, `DB_PASSWORD`, `JWT_SECRET` (use uma string
longa e aleatória) e as credenciais do administrador inicial
(`ADMIN_EMAIL`, `ADMIN_SENHA`).

### 3. Instalar dependências

```bash
npm install
```

**Se você já tinha o backend instalado antes desta atualização**, rode
`npm install` de novo mesmo assim — foram adicionadas as dependências
`express-rate-limit`, `node-cron` e `nodemailer`, que só chegam rodando esse comando.

### 4. Criar o usuário administrador inicial

```bash
npm run seed:admin
```

Isso cria o primeiro usuário com a role `administrador`, usando as
credenciais definidas no `.env`. **Altere a senha padrão após o primeiro
login** (endpoint de troca de senha pode ser adicionado em
`authController.js` seguindo o mesmo padrão de `login`).

### 5. Iniciar o servidor

```bash
npm run dev   # com reload automático (nodemon)
# ou
npm start     # produção
```

O servidor sobe em `http://localhost:3000` e já serve o front-end estático
junto com a API.

### 6. Testar o sistema

1. Acesse `http://localhost:3000/pages/login.html`
2. Entre com o e-mail/senha definidos em `ADMIN_EMAIL`/`ADMIN_SENHA`
3. Você será redirecionado para a tela de **Empresas**, onde pode:
   - Cadastrar uma nova empresa (Razão Social + CNPJ obrigatórios)
   - Buscar por razão social, nome fantasia ou CNPJ
   - Filtrar por situação (ativa, suspensa, baixada, em legalização)
   - Editar ou excluir uma empresa
   - Abrir "Documentos" para enviar/baixar/excluir arquivos vinculados à empresa
4. Pelo menu no topo, navegue entre **Empresas**, **Legalização**, **Certidões**
   e **Licenças** — cada uma tem cadastro, filtros e (Certidões/Licenças) um
   botão de "Renovar" que preserva o histórico de datas anteriores

### 7. Testar a API diretamente (opcional, via curl)

```bash
# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@demo.com.br","senha":"demo1234"}'

# Use o token retornado para listar empresas
curl http://localhost:3000/api/empresas \
  -H "Authorization: Bearer SEU_TOKEN_AQUI"
```

## Controle de acesso (roles)

| Role                     | Permissões                                                |
|--------------------------|------------------------------------------------------------|
| `administrador`          | Acesso total, incluindo gestão de usuários e exclusões     |
| `analista_legalizacao`   | Cria/edita empresas e processos de legalização              |
| `analista_certidoes`     | Gerencia CNDs                                               |
| `analista_licencas`      | Gerencia licenças e alvarás                                 |
| `visualizador`           | Apenas leitura                                              |

As roles já estão pré-cadastradas no `schema.sql` (tabela `roles`).

## Segurança implementada

- Senhas com hash `bcrypt` (nunca armazenadas em texto puro)
- Autenticação via JWT com expiração configurável
- Controle de acesso por função (middleware `autorizar`)
- Validação de tipo e tamanho de arquivo no upload (`multer`)
- Nomes de arquivo gerados aleatoriamente no servidor (evita path traversal
  e colisão de nomes)
- Tratamento centralizado de erros, sem vazar detalhes internos ao cliente
- CORS habilitado apenas para consumo pela própria aplicação
- **Rate limiting** (`express-rate-limit`) no login (20 tentativas/15min),
  na recuperação de senha (5/15min) e no login / criação de senha da
  Área do Cliente (20 e 10 por 15min) — dificulta ataques de força bruta
- **Troca de senha pelo próprio usuário**: botão "Alterar minha senha" no
  rodapé da sidebar, em qualquer tela (`POST /api/auth/trocar-senha`,
  exige a senha atual)
- **Recuperação de senha por e-mail**: link "Esqueci minha senha" na tela
  de login gera um token de uso único, válido por 2 horas
  (`POST /api/auth/esqueci-senha`, `POST /api/auth/redefinir-senha`,
  tela `/pages/redefinir-senha.html`). Depende do e-mail estar configurado
  (`NOTIF_EMAIL_*`) — sem isso, o link é gerado mas só aparece no console
  do servidor, não chega por e-mail de verdade.
- **Log de auditoria**: toda criação/edição/exclusão de empresa, certidão,
  licença, processo, documento e usuário fica registrada (quem fez, quando,
  o quê). Consultável em `/pages/auditoria.html` (administrador) ou via
  `GET /api/auditoria`.
- **Segredos e documentos fora do Git**: `.gitignore` impede versionar o
  `backend/.env` e os arquivos de `backend/uploads/` (documentos reais de
  clientes). Use `backend/.env.example` como modelo.
- **Sessão sempre conferida no banco**: a cada requisição o usuário precisa
  existir e estar ativo, e a função (role) usada é a atual — desativar ou
  rebaixar alguém vale na hora, sem esperar o token expirar. O servidor não
  sobe sem um `JWT_SECRET` de pelo menos 32 caracteres.
- **Upload conferido pelo conteúdo**: além do tipo declarado, o sistema lê
  os primeiros bytes do arquivo (assinatura de PDF/PNG/JPG) e recusa
  arquivos disfarçados; a extensão salva vem do tipo aceito, não do nome.
- **Proteção contra XSS**: todo texto vindo do servidor (nomes de arquivo,
  descrições, razão social, etc.) é escapado com `esc()` antes de ir para a
  tela — importante porque clientes enviam arquivos pelo portal.
- **Cabeçalhos de segurança** (`nosniff`, `X-Frame-Options`, sem cache nas
  respostas da API) e **CORS restrito** (`CORS_ORIGINS` no `.env`).
- **Links de recuperação de senha** montados a partir de `APP_URL` no `.env`,
  nunca do cabeçalho `Host` da requisição (evita link adulterado).
- **Área do Cliente com senha**: links de criar senha são de uso único
  (7 dias no primeiro acesso, 2 horas na recuperação); o cliente só vê
  documentos marcados como visíveis e só das empresas liberadas para ele.
- Exclusão de documento: só o administrador ou quem enviou o arquivo.

### Envio de e-mail — SMTP ou Microsoft Graph

`node src/utils/testarEmail.js seu-email@destino.com` testa a configuração.

- **SMTP** (`NOTIF_EMAIL_HOST/USER/PASS`): no Microsoft 365, a caixa usada
  precisa ter **"SMTP autenticado"** liberado (Centro de administração do
  Microsoft 365 → Usuários → a conta → Email → Gerenciar aplicativos de
  email). Se aparecer `535 5.7.3 Authentication unsuccessful`, o login está
  sendo recusado — e nenhum e-mail do sistema sai.
- **Microsoft Graph** (recomendado): `NOTIF_EMAIL_VIA=graph` + `AZURE_*`,
  com a permissão de aplicativo **Mail.Send** (consentimento de
  administrador) no app registrado no Azure. Envia pela caixa
  `NOTIF_EMAIL_FROM`, sem depender de senha de e-mail.

Aviso de responsável: o usuário recebe e-mail somente quando uma etapa de
processo ou uma tarefa de setor é **designada para ele** (na criação da
tarefa ou quando ela é repassada de outra pessoa). Mudanças de status não
geram e-mail para o responsável.

### Avisos gerais do escritório (e-mail para todos)

Só três situações mandam e-mail para o escritório inteiro, no mesmo modelo
dos e-mails que já eram enviados manualmente
(`backend/src/services/avisosEscritorioService.js`):

- **Empresa nova** — ao cadastrar a empresa: informativo interno com a
  competência de início, e-mail, telefone, regime, fator R, pró-labore e
  observações (campos do cadastro).
- **Cadastrada no Domínio** — quando o estágio "Cadastro no Domínio" da
  esteira é concluído.
- **Saída do escritório** — botão "Registrar saída do escritório"
  (administrador, `POST /api/empresas/:id/saida`): marca a empresa como
  "Saiu do escritório", remove o acesso dos clientes à Área do Cliente e para os
  alertas de vencimento dela.

Destinatários: `EMAIL_AVISOS_GERAIS` no `.env` (vírgulas). Vazio = todos os
usuários ativos do sistema. As respostas vão para quem fez a ação.
Requer a migração `009_entrada_saida_escritorio.sql`.

## Gestão de usuários

Tela `/pages/usuarios.html` (administrador): criar, editar (nome, e-mail,
função, ativo/inativo) e redefinir a senha de qualquer colaborador
diretamente — útil quando alguém perde acesso ao próprio e-mail e não
consegue usar a recuperação de senha sozinho.

## Dashboard inicial

Após o login, o sistema agora abre em `/pages/dashboard.html`, com um
resumo consolidado: total de empresas, e os cards de status de Processos,
Certidões e Licenças — uma visão geral do escritório sem precisar entrar
em cada módulo separadamente.

## Busca global

Campo de busca no topo de Empresas, Legalização, Certidões e Licenças —
busca por nome ou CNPJ e leva direto para a empresa em `/pages/empresas.html`.

## Paginação

Empresas, Certidões, Licenças e Processos agora têm botões "Anterior" /
"Próxima" nas tabelas, junto com a contagem total de registros — a API já
suportava isso desde o início (`pagina`, `limite`, `total` na resposta),
faltava só a interface.

## Importação de guias em lote (DAS e outras)

Tela **Fiscal / Folha → "Importar guias"** (`pages/importar-guias.html`).
Arraste dezenas (ou centenas) de PDFs de uma vez; o sistema lê cada PDF
(`backend/src/services/leitorGuias.js`, via `pdfjs-dist`) e encontra a
empresa pelo CNPJ (exato ou, se único, pela raiz de 8 dígitos). Na
conferência dá para escolher a empresa das guias não encontradas, ver as
duplicadas (mesmo número de documento já importado) e desmarcar o que não
deve entrar. Ao importar:
- a guia vira um documento da empresa (categoria "Guia"), visível na Área
  do Cliente;
- opcionalmente sai **um e-mail por empresa** com todas as guias dela em
  anexo (para o e-mail da empresa + clientes ativos do portal).

Quem pode usar: administrador e supervisor/colaborador do Fiscal e da Folha.
Rotas em `/api/guias`. Itens não confirmados somem sozinhos após 2 dias
(job diário). Requer a migração `013_importacao_guias.sql` e `npm install`
(dependência `pdfjs-dist`).

Tipos: o DAS (PGDAS-D) foi testado com guia real. DARF/DCTFWeb, FGTS
Digital e guias estaduais/municipais usam regras gerais (CNPJ, datas,
valor) e precisam ser validados com um PDF de exemplo de cada.

## E-mails com o layout do escritório

Todo e-mail do sistema sai no layout da Privilege (logo embutido, bordô e
dourado, rodapé com endereço e telefones) — `backend/src/services/emailLayout.js`.
Quem monta um e-mail próprio usa `montarEmail({ titulo, paragrafos, itens, botao })`
e passa o `html` para `enviarEmail`; os demais têm o texto colocado no layout
automaticamente. E-mails ao cliente com arquivo:
- guias importadas em lote (um e-mail por empresa, PDFs em anexo);
- pedido da Área do Cliente concluído (arquivo em anexo);
- "Enviar Documento" na empresa, com a opção "Enviar também por e-mail"
  (já vem marcada para Guia). Certificado digital (.pfx) nunca vai anexado.

Remetente: `NOTIF_EMAIL_FROM` (contato@privilegecontabilidade.com.br).

### Controle dos e-mails (tela "E-mails enviados")

Cada destinatário recebe o seu próprio e-mail, com um código aleatório
(`emails_enviados`, migração 014). Com ele o sistema registra:
- **abertura** — imagem invisível de 1 pixel (`/api/rastreio/:token/a.gif`);
  é aproximado (Outlook bloqueia imagens; iPhone às vezes carrega sozinho);
- **download pelo e-mail** — botão "Baixar a guia" → página intermediária →
  `/api/rastreio/:token/d/:documento/arquivo` (a página evita que antivírus
  de e-mail contem como download). Links valem 6 meses;
- **download pela Área do Cliente** — `downloads_portal` com `origem='portal'`.

Abrir o anexo direto no programa de e-mail não é rastreável. Abertura e
download pelo e-mail só funcionam com o sistema acessível pela internet
(`APP_URL` público); a tela avisa quando o `APP_URL` é da rede local.

## Automação e alertas de vencimento

Job diário (`node-cron`, `backend/src/jobs/vencimentosJob.js`), agendado
para rodar toda madrugada às 06:00, que:
1. Recalcula o status (`válida`/`a vencer`/`vencida`) de todas as
   certidões e licenças, mesmo as que ninguém edita há semanas.
2. Dispara automaticamente um alerta (e-mail/WhatsApp) para cada empresa
   com uma certidão ou licença que entrou em "a vencer" — e nunca repete
   o mesmo aviso para o mesmo registro na mesma validade (tabela
   `alertas_vencimento_enviados` controla isso).

O job já inicia sozinho junto com o servidor (`iniciarJobVencimentos()`
em `server.js`) — não precisa configurar nada além do e-mail/WhatsApp
para os alertas saírem de verdade.

## Testes automatizados

```bash
cd backend
npm test
```

Cobrem as funções de cálculo de status de vencimento (`Certidao.calcularStatus`,
`Licenca.calcularStatus`) e a formatação de telefone para WhatsApp
(`formatarNumeroWhatsapp`) — funções puras, sem precisar de um banco de
dados rodando para testar. É uma base pequena, pensada para crescer;
não cobre ainda rotas da API nem o front-end.

## Backup (banco + documentos)

`database/backup.ps1` gera um `.zip` com o banco (`pg_dump`) e a pasta
`backend/uploads`, lendo as credenciais do `backend/.env`. O agendamento
diário é criado com `database/agendar-backup.ps1` (tarefa "Backup SISTEMA
PRIVILEGE" do Agendador de Tarefas, 12:30 por padrão). Guarda os diários dos
últimos 30 dias e o primeiro backup de cada mês por 12 meses. Cópia extra fora do
computador: `BACKUP_PASTA_COPIA` no `.env`. Como conferir, agendar e
restaurar: `database/RESTAURACAO.md`.

## Design system

A interface usa um design system próprio, todo em `frontend/css/style.css`,
organizado em seções (Reset, Variáveis, Base, Componentes, Layout, Módulos
Específicos, Responsividade):

- **Tema claro/escuro**: alternância pelo botão no topo direito de cada tela,
  persistida em `localStorage` e aplicada via `data-theme` no `<html>`. Sem
  o botão, o sistema também respeita a preferência do sistema operacional
  (`prefers-color-scheme`) no primeiro acesso.
- **Paleta da marca Privilege**: bordô profundo (`#6B0E12`) como cor de ação
  principal, dourado (`#C99B59`) como destaque na sidebar, fundo em tom
  creme suave — extraídos da logo e do site institucional da Privilege.
  Cores semânticas (esmeralda/âmbar/carmim para status) permanecem
  independentes da marca, já que comunicam significado, não identidade.
- **Logo real**: o mark circular da Privilege (`frontend/assets/logo-mark.png`,
  recortado com fundo transparente a partir do arquivo enviado) aparece na
  sidebar de todas as telas e na tela de login.
- **Tipografia**: `Montserrat` só para a marca (logo, login), `Inter` para
  títulos e texto da aplicação, `IBM Plex Mono` para dados tabulares (CNPJ,
  protocolos, números de certidão/licença — classe `.ledger`).
- **Sidebar fixa** agrupada em Principal / Setores / Administração (os
  grupos são montados por `agruparMenuLateral()` em `api.js`, o HTML de cada
  página continua com a lista simples de links). Colapsável abaixo de 960px
  (menu hambúrguer; tocar fora fecha).
- **Dashboard** com indicadores clicáveis, lista "Precisa de atenção"
  (certidões e licenças vencidas ou vencendo em 30 dias) e barras de
  distribuição por status — cores de status sempre acompanhadas de rótulo e
  número.
- **Login** em tela dividida (painel da marca + formulário); em telas
  estreitas, só o formulário.
- Todas as páginas têm `<meta name="viewport">` — sem ela o sistema
  aparecia "encolhido" no celular.
- Tudo isso é CSS puro, sem dependência de frameworks — a única chamada
  externa é o `@import` opcional das fontes do Google Fonts no topo do
  `style.css`; se não houver internet, o sistema usa as fontes padrão do
  sistema operacional automaticamente (fallback já configurado).

## Próximos passos sugeridos

1. Configurar `NOTIF_EMAIL_*` no `.env` para os e-mails (recuperação de
   senha, alertas de vencimento) saírem de verdade — o WhatsApp já está
   com integração real, falta só o e-mail.
2. Avisar o cliente quando um documento novo for liberado para ele na
   Área do Cliente.
3. Ampliar a cobertura de testes automatizados para as rotas da API
   (hoje só cobre funções puras que não dependem do banco).
4. Preencher `BACKUP_PASTA_COPIA` (OneDrive da empresa ou HD externo)
   quando o sistema passar a ter dados reais de clientes.
5. Expandir o log de auditoria para cobrir também consultas de CND e
   renovações de certidão/licença (hoje cobre criação/edição/exclusão
   dos módulos principais).
