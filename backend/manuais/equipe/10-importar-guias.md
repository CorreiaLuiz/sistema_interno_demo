---
id: importar-guias
titulo: Importar guias (PDFs ou DAS direto da Receita) e enviar aos clientes
resumo: Colocar as guias em cada empresa e mandar por e-mail para os clientes.
grupo: Setores e guias
palavras: guia, guias, das, darf, fgts, inss, boleto, importar, lote, pdf, enviar guia, e-mail da guia, simples nacional, mei, gerar das, buscar na receita, competencia, repetida, segunda via
---
A tela **Importar guias** coloca as guias em cada empresa e manda por e-mail ao cliente. Fica no botão **"Importar guias"** das telas **Fiscal** e **Folha de Pagamento**.

Quem pode: administrador, Fiscal e Folha.

## Opção 1 — Guias em PDF (DAS, DARF, FGTS...)

1. Arraste os PDFs para o quadro **"Arraste os PDFs das guias para cá"** (ou clique nele para escolher). Pode selecionar centenas de uma vez.
2. Clique em **"Ler guias"**. O sistema lê o CNPJ, o mês, o vencimento e o valor de cada guia e acha a empresa.
3. Siga para **"Confira antes de importar"**.

![Importar guias em PDF](e-importar-guias.png)

## Opção 2 — Buscar o DAS direto na Receita

1. No quadro **"Ou busque os DAS direto na Receita"**, escolha o **Mês (competência)** (já vem o mês passado).
2. Marque as empresas (só aparecem as ativas do Simples Nacional e MEI). Use **"Filtrar empresas"** para achar pelo nome ou CNPJ.
3. Clique em **"Buscar na Receita"** e confirme.
4. As guias que vieram seguem para a conferência. As que não vieram aparecem num aviso amarelo com o motivo (ex.: sem procuração, declaração do mês não entregue).

![Buscar DAS na Receita](e-importar-receita.png)

> **Dica:** cada guia gerada na Receita custa alguns centavos (SERPRO). Gerar de novo um mês já gerado não dá erro: sai outra guia igual (com multa e juros, se vencida).

## Conferir e importar

1. Na tela **"Confira antes de importar"**, as guias marcadas vão para a empresa indicada.
2. Guia **sem empresa**: digite o nome ou CNPJ e escolha a empresa. **"Trocar empresa"** corrige uma escolha.
3. Guias **já importadas antes** (mesmo número, ou a mesma empresa com guia do mesmo mês enviada há pouco) vêm **desmarcadas**. Marque só se for uma 2ª via de propósito.
4. Deixe marcado **"Enviar por e-mail para cada cliente"** para mandar um e-mail por empresa com as guias em anexo.
5. Clique em **"Importar"** e confirme.

![Conferência das guias](e-importar-conferencia.png)

As guias ficam nos documentos da empresa (categoria Guia) e na Área do Cliente. Para ver quem abriu e quem baixou, clique em **"Acompanhar os e-mails"**.

## Para quem vai o e-mail

Para o **e-mail do cadastro da empresa** e para **cada login ativo da Área do Cliente** daquela empresa. Para tirar alguém, remova o acesso dele na Área do Cliente (veja "Liberar a Área do Cliente").
