# Backup e restauração (banco + documentos)

Cada backup é **um único arquivo** `database\backups\backup_AAAA-MM-DD_HH-mm.zip`
com duas coisas dentro:

- `banco.backup`: o banco de dados inteiro (formato do `pg_restore`)
- `uploads\`: os documentos enviados (cartões CNPJ, guias, certificados...)

A pasta `database\backups\` fica **fora do Git** de propósito: os backups têm
dados reais de clientes e nunca devem ir para o GitHub.

## Backup automático (já configurado neste computador)

A tarefa **"Backup SISTEMA PRIVILEGE"** do Agendador de Tarefas do Windows roda
**todo dia às 12:30**. Se o computador estiver desligado nessa hora, roda assim
que ele for ligado. O que fica guardado:

- **Diários:** os últimos **30 dias** (`database\backups\backup_*.zip`).
- **Mensais:** o primeiro backup de cada mês, por **12 meses**
  (`database\backups\mensais\`).

Cada backup é uma **cópia completa** do sistema. Apagar um backup antigo não
apaga nada do sistema; só limita até quando dá para "voltar no tempo" (a
qualquer dia do último mês e a qualquer mês do último ano).

- **Conferir se está funcionando:** abra `database\backups\backup.log`. Cada
  execução deixa uma linha "Backup finalizado com sucesso" (ou "ERRO NO BACKUP"
  com o motivo).
- **Agendar em outro computador** (ou mudar o horário):
  ```powershell
  powershell -ExecutionPolicy Bypass -File .\database\agendar-backup.ps1 -Horario 12:30
  ```
- **Rodar um backup agora:**
  ```powershell
  powershell -ExecutionPolicy Bypass -File .\database\backup.ps1
  ```
- **Desligar o backup automático:**
  ```powershell
  Unregister-ScheduledTask -TaskName "Backup SISTEMA PRIVILEGE"
  ```

### Opções no `backend\.env`

| Campo | Para quê |
|---|---|
| `BACKUP_PASTA_COPIA` | Pasta para uma **cópia extra fora do computador**: OneDrive **da empresa**, HD externo (ex: `E:\Backups SISTEMA PRIVILEGE`). Vazio = só neste computador. |
| `BACKUP_DIAS_PARA_MANTER` | Quantos dias de backups diários guardar (padrão 30). |
| `BACKUP_MESES_MENSAIS` | Por quantos meses guardar o backup mensal (padrão 12). |

> Quando o sistema começar a guardar dados reais de clientes, preencha
> `BACKUP_PASTA_COPIA`. Se o HD deste computador estragar, os backups que
> estão só nele se perdem junto.

## Restaurar um backup

⚠️ Restaurar por cima do banco atual **apaga o que foi feito depois do backup**.
Na dúvida, restaure primeiro num banco separado para conferir.

1. **Pare o sistema** (`Ctrl + C` no terminal onde ele roda).
2. **Extraia o .zip** (botão direito → "Extrair tudo...") numa pasta, por
   exemplo `C:\restauracao`.
3. **Restaure o banco** (PowerShell):
   ```powershell
   $bin = "C:\Program Files\PostgreSQL\18\bin"

   # Opção A (recomendada para conferir): num banco novo, separado
   & "$bin\createdb.exe" -U postgres legalizacao_db_restaurado
   & "$bin\pg_restore.exe" -U postgres -d legalizacao_db_restaurado C:\restauracao\banco.backup

   # Opção B: por cima do banco atual (substitui tudo)
   & "$bin\pg_restore.exe" -U postgres -d legalizacao_db --clean --if-exists C:\restauracao\banco.backup
   ```
   Cada comando pede a senha do usuário `postgres`.
4. **Restaure os documentos:** copie o conteúdo de `C:\restauracao\uploads\`
   para `backend\uploads\` (substituindo quando o Windows perguntar).
5. Inicie o sistema de novo (`npm start` na pasta `backend`).

> Os documentos e o banco precisam ser do **mesmo** backup. O banco guarda o
> nome de cada arquivo, e o arquivo precisa estar na pasta `uploads`.
