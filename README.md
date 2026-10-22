# SISTEMA PRIVILEGE — demonstração

Sistema de gestão para escritórios de contabilidade, feito para a
**Privilege Contabilidade e Consultoria**. Esta é a **versão de demonstração**:
roda no seu computador com **empresas, pessoas e documentos fictícios**, e tudo
que dependeria de serviços de fora (SERPRO, sistema Domínio, e-mail e WhatsApp)
funciona de forma **simulada**.

## O que dá para ver

| Área | O que faz |
|---|---|
| **Painel** | Empresas ativas, processos em andamento e o que está vencendo |
| **Empresas** | Cadastro, ficha completa, sócios, documentos e a esteira de empresa nova |
| **Legalização** | Quadro por etapas (arrastar e soltar) com checklist de documentos |
| **Certidões e licenças** | Validades, avisos de vencimento, **CND Federal** e **Situação fiscal** (Receita + PGFN) com um clique |
| **Setores** | Tarefas do Fiscal, Contabilidade e Folha, com prazo e pedidos dos clientes |
| **Importar guias** | Arraste vários PDFs de DAS (ou busque o DAS direto na Receita): o sistema lê o CNPJ e põe cada guia na empresa certa |
| **Caixa Postal da Receita** | Mensagens do e-CAC de cada cliente (intimações, avisos), sem marcar como lidas |
| **Planejamento tributário** | Compara Simples, Lucro Presumido, Lucro Real e o Simples híbrido de 2027, com parecer em PDF |
| **E-mails enviados** | Quem abriu o e-mail e quem baixou a guia (pelo e-mail ou pela Área do Cliente) |
| **Conferência bancária** | Compara os extratos OFX da pasta da empresa com o Domínio, mês a mês |
| **Área do Cliente** | Portal do cliente: documentos, certidões, pedidos de 2ª via de guia |
| **Dúvidas? e Ajuda** | Manual passo a passo com imagens e um assistente que responde dúvidas (no sistema e na Área do Cliente) |
| **Contatos do site** | Pedidos de diagnóstico feitos no formulário da página *Sobre* |
| **Auditoria** | Quem fez o quê e quando |

## Como rodar (Windows, macOS ou Linux)

Precisa ter instalado:
- [Node.js](https://nodejs.org) 20 ou mais novo
- [PostgreSQL](https://www.postgresql.org/download/) 14 ou mais novo (anote a senha do usuário `postgres`)

Depois, num terminal, na pasta `backend`:

```bash
npm install
npm run demo
```

Na primeira vez ele pergunta a **senha do `postgres`** e monta tudo sozinho:
um banco separado chamado `sistema_ana_demo`, as empresas fictícias, os
extratos, as guias e os e-mails de exemplo. No fim, o sistema já fica ligado.

Abra **http://localhost:3000/pages/login.html** e clique num dos usuários de
exemplo. A senha de todos é **`demo1234`**.

| Usuário | E-mail |
|---|---|
| Administrador (vê tudo) | admin@demo.com.br |
| Legalização | legalizacao@demo.com.br |
| Fiscal | fiscal@demo.com.br |
| Contabilidade | contabil@demo.com.br |
| Folha de Pagamento | folha@demo.com.br |
| **Área do Cliente** ([link](http://localhost:3000/pages/cliente-login.html)) | cliente@demo.com.br |

Nas próximas vezes, para só ligar: `npm start`.
Para apagar tudo e montar a demonstração de novo: `npm run demo:recriar`.

### Experimente

1. **Importar guias**: Fiscal → *Importar guias* → arraste os PDFs da pasta
   `backend/demo-arquivos/guias-exemplo`. Uma delas é de uma empresa que não
   está cadastrada, para você ver como o sistema avisa. Ou use *Buscar na Receita*.
2. **CND e situação fiscal**: Empresas → menu ⋮ de uma empresa → *CND Federal*.
3. **Caixa Postal**: Fiscal → *Caixa Postal da Receita* → *Ver assuntos* da Padaria.
4. **Planejamento tributário**: Contabilidade → *Planejamento tributário* → *Ver análise* da Padaria.
5. **Conferência bancária**: Contabilidade → *Conferência bancária* → *Abrir* uma empresa.
6. **Área do Cliente**: entre como cliente e peça a 2ª via de uma guia; depois
   entre como Fiscal e conclua o pedido anexando um PDF.
7. **Dúvidas?**: clique no botão do canto da tela e pergunte, por exemplo, "como mando as guias para os clientes?".

## O que é simulado na demonstração

- **E-mail e WhatsApp**: nada é enviado de verdade (aparece só no terminal).
- **SERPRO (CND, situação fiscal, DAS e Caixa Postal)**: tudo fictício. CNPJs terminados
  em 9 saem "com pendência" e com mensagens novas na Caixa Postal.
- **Domínio (Conferência bancária e Planejamento)**: os lançamentos vêm de dados de exemplo,
  combinando com os extratos OFX gerados em `backend/demo-arquivos/empresas`.
- **Assistente de dúvidas**: sem chave da API do Claude, responde pela busca no manual.

Para usar o sistema com dados reais é preciso configurar o `backend/.env`
(veja `backend/.env.example`) e **não** usar `MODO_DEMO=true`. A documentação
técnica completa está em [docs/DOCUMENTACAO-TECNICA.md](docs/DOCUMENTACAO-TECNICA.md).

## Testes

- `npm test` — regras sem banco e sem internet.
- `npm run test:integracao` — liga o sistema num banco temporário e confere login,
  permissões, Área do Cliente (um cliente nunca vê outra empresa) e links públicos.

## Tecnologia

Node.js + Express, PostgreSQL, HTML/CSS/JavaScript puro (sem framework no
navegador), login com JWT e senhas com bcrypt. Assistente com a API do Claude (Anthropic).
