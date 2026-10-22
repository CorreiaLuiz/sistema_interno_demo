---
id: conferencia-bancaria
titulo: Conferência bancária (extratos x Domínio)
resumo: Comparar os extratos do banco com os lançamentos do Domínio.
grupo: Contabilidade
palavras: conferencia bancaria, extrato, ofx, banco, dominio, lancamento, diferenca, falta extrato, falta importar, conta encerrada, painel bancario, conciliacao
---
A **Conferência bancária** compara, mês a mês, os extratos (arquivos OFX) da pasta de cada empresa no servidor com os lançamentos no Domínio. Fica no botão **"Conferência bancária"** da tela **Contabilidade**.

Quem pode: administrador e setor Contábil.

![Conferência bancária](e-conferencia.png)

## Conferir

1. Clique em **"Conferir todas"** para conferir todas as empresas, ou em **"Abrir"** na linha de uma empresa.
2. Cada mês ganha uma situação:
   - **Conferido** — o extrato bate com o Domínio;
   - **Falta importar** — o extrato está na pasta e ainda não foi lançado no Domínio;
   - **Diferença** — o extrato e o Domínio não batem;
   - **Falta extrato** — não há extrato na pasta nem lançamento (pedir ao cliente);
   - **Lançado sem OFX** — há lançamento no Domínio, mas não há extrato na pasta;
   - **Conta não identificada** — extrato de uma conta que não foi ligada a uma conta do Domínio;
   - **Conta encerrada** e **Sem movimento** — nada a conferir.
3. Dentro da empresa, as pendências aparecem separadas: pasta da empresa, diferenças, extratos sem conta, importar ou lançar, pedir ao cliente, contas encerradas.

## Filtros

Filtre por responsável e por situação (com pendência, com diferença, falta importar/lançar, falta extrato, em dia, ainda não conferidas, sem código ou sem pasta). **"Exportar Excel"** baixa a lista.

## Conta encerrada

Se uma conta foi encerrada, marque como **"Conta encerrada"** e informe o **último mês com movimento**, depois **"Salvar e conferir"**. Ela deixa de pedir extrato.

## Corrigir cadastro

Se a empresa estiver "sem código ou sem pasta", use **"Corrigir cadastro"** para informar o **Código da empresa no Domínio** e a **pasta** em "01 - Empresas Ativas". **"Atualizar da planilha"** relê a planilha de controle dos extratos.

## Painel

**"Ver painel"** mostra o resumo: situação das empresas mês a mês, por responsável, maiores diferenças em R$ e contas encerradas ou suspeitas.
