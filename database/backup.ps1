# Backup do SISTEMA PRIVILEGE: banco de dados + documentos enviados.
#
# O que faz, a cada execução:
#   1. Gera o backup do banco (pg_dump, formato comprimido do PostgreSQL).
#   2. Junta com a pasta backend\uploads (cartões CNPJ, guias, certificados...)
#      num único arquivo: database\backups\backup_AAAA-MM-DD_HH-mm.zip
#   3. Se BACKUP_PASTA_COPIA estiver preenchida no backend\.env, copia o .zip
#      para lá também (OneDrive da empresa, HD externo...).
#   4. Guarda o primeiro backup de cada mês em database\backups\mensais.
#   5. Apaga os backups diários com mais de BACKUP_DIAS_PARA_MANTER dias
#      (padrão 30) e os mensais com mais de BACKUP_MESES_MENSAIS meses
#      (padrão 12). Cada backup é uma cópia COMPLETA — apagar um antigo não
#      apaga nada do sistema, só limita até quando dá para "voltar no tempo".
#   6. Registra tudo em database\backups\backup.log.
#
# Usuário, senha e nome do banco vêm do backend\.env — nada fica escrito aqui.
#
# Rodar manualmente (PowerShell, na pasta do projeto):
#   powershell -ExecutionPolicy Bypass -File .\database\backup.ps1
#
# Agendar para rodar sozinho todo dia: .\database\agendar-backup.ps1
# Como restaurar: database\RESTAURACAO.md

$ErrorActionPreference = "Stop"

$RAIZ = Split-Path $PSScriptRoot -Parent
$ARQUIVO_ENV = Join-Path $RAIZ "backend\.env"
$PASTA_UPLOADS = Join-Path $RAIZ "backend\uploads"
$PASTA_BACKUP = Join-Path $PSScriptRoot "backups"
$ARQUIVO_LOG = Join-Path $PASTA_BACKUP "backup.log"

if (-not (Test-Path $PASTA_BACKUP)) { New-Item -ItemType Directory -Path $PASTA_BACKUP | Out-Null }

function Registrar([string]$mensagem) {
    $linha = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $mensagem
    Write-Host $linha
    Add-Content -Path $ARQUIVO_LOG -Value $linha -Encoding UTF8
}

# Lê o backend\.env (linhas CHAVE=valor; ignora comentários e linhas vazias)
function Ler-Env([string]$caminho) {
    $valores = @{}
    if (-not (Test-Path $caminho)) { throw "Arquivo .env não encontrado em $caminho" }
    foreach ($linha in Get-Content -Path $caminho -Encoding UTF8) {
        if ($linha -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
            $valores[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'")
        }
    }
    return $valores
}

# pg_dump pode não estar no PATH (o instalador do PostgreSQL não coloca) —
# procura também na pasta padrão de instalação, na versão mais nova.
function Encontrar-PgDump {
    $noPath = Get-Command pg_dump -ErrorAction SilentlyContinue
    if ($noPath) { return $noPath.Source }
    $instalados = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\pg_dump.exe" -ErrorAction SilentlyContinue |
        Sort-Object { [int]($_.Directory.Parent.Name -replace '\D', '') } -Descending
    if ($instalados) { return $instalados[0].FullName }
    throw "pg_dump não encontrado. Instale o PostgreSQL (Command Line Tools)."
}

$pastaTemporaria = $null
try {
    $env_ = Ler-Env $ARQUIVO_ENV
    $DB_NAME = if ($env_.DB_NAME) { $env_.DB_NAME } else { "legalizacao_db" }
    $DB_USER = if ($env_.DB_USER) { $env_.DB_USER } else { "postgres" }
    $DB_HOST = if ($env_.DB_HOST) { $env_.DB_HOST } else { "localhost" }
    $DB_PORT = if ($env_.DB_PORT) { $env_.DB_PORT } else { "5432" }
    $DIAS_PARA_MANTER = if ($env_.BACKUP_DIAS_PARA_MANTER) { [int]$env_.BACKUP_DIAS_PARA_MANTER } else { 30 }
    $MESES_MENSAIS = if ($env_.BACKUP_MESES_MENSAIS) { [int]$env_.BACKUP_MESES_MENSAIS } else { 12 }
    $PASTA_COPIA = $env_.BACKUP_PASTA_COPIA

    $dataHora = Get-Date -Format "yyyy-MM-dd_HH-mm"
    $arquivoZip = Join-Path $PASTA_BACKUP "backup_$dataHora.zip"
    $pastaTemporaria = Join-Path $env:TEMP "backup_sistema_ana_$dataHora"
    New-Item -ItemType Directory -Path $pastaTemporaria -Force | Out-Null

    Registrar "Iniciando backup ($DB_NAME)..."

    # 1. Banco de dados. A senha vai só para este processo, nunca para a tela.
    $env:PGPASSWORD = $env_.DB_PASSWORD
    $arquivoBanco = Join-Path $pastaTemporaria "banco.backup"
    & (Encontrar-PgDump) -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -Fc -f $arquivoBanco --no-password
    if ($LASTEXITCODE -ne 0) { throw "pg_dump falhou (código $LASTEXITCODE). Confira DB_* no backend\.env." }

    # 2. Documentos enviados (a pasta inteira, com a mesma estrutura)
    $destinoUploads = Join-Path $pastaTemporaria "uploads"
    if (Test-Path $PASTA_UPLOADS) {
        Copy-Item -Path $PASTA_UPLOADS -Destination $destinoUploads -Recurse
    } else {
        New-Item -ItemType Directory -Path $destinoUploads | Out-Null
    }
    $qtdArquivos = @(Get-ChildItem $destinoUploads -File -Recurse | Where-Object { $_.Name -ne ".gitkeep" }).Count

    # 3. Um único .zip por backup
    Compress-Archive -Path (Join-Path $pastaTemporaria "*") -DestinationPath $arquivoZip -Force
    $tamanhoMb = [math]::Round((Get-Item $arquivoZip).Length / 1MB, 2)
    Registrar "Backup criado: $(Split-Path $arquivoZip -Leaf) ($tamanhoMb MB, $qtdArquivos documento(s))"

    # 4. Cópia fora do computador, se configurada
    $destinos = @($PASTA_BACKUP)
    if ($PASTA_COPIA) {
        if (-not (Test-Path $PASTA_COPIA)) { New-Item -ItemType Directory -Path $PASTA_COPIA -Force | Out-Null }
        Copy-Item -Path $arquivoZip -Destination $PASTA_COPIA -Force
        Registrar "Cópia extra salva em: $PASTA_COPIA"
        $destinos += $PASTA_COPIA
    }

    # 5. Cópia mensal: o primeiro backup de cada mês fica guardado à parte
    $mesAtual = Get-Date -Format "yyyy-MM"
    foreach ($pasta in $destinos) {
        $pastaMensal = Join-Path $pasta "mensais"
        if (-not (Test-Path $pastaMensal)) { New-Item -ItemType Directory -Path $pastaMensal | Out-Null }
        if (-not (Get-ChildItem -Path $pastaMensal -Filter "backup_$mesAtual-*.zip")) {
            Copy-Item -Path $arquivoZip -Destination $pastaMensal
            Registrar "Backup mensal de $mesAtual guardado em: $pastaMensal"
        }
    }

    # 6. Limpeza: diários com mais de X dias, mensais com mais de Y meses
    $limiteDiario = (Get-Date).AddDays(-$DIAS_PARA_MANTER)
    $limiteMensal = (Get-Date -Day 1).Date.AddMonths(-$MESES_MENSAIS)
    foreach ($pasta in $destinos) {
        Get-ChildItem -Path $pasta -Filter "backup_*.zip" -ErrorAction SilentlyContinue |
            Where-Object { $_.LastWriteTime -lt $limiteDiario } |
            ForEach-Object {
                Remove-Item $_.FullName
                Registrar "Backup diário antigo removido: $($_.Name)"
            }
        Get-ChildItem -Path (Join-Path $pasta "mensais") -Filter "backup_*.zip" -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match '^backup_(\d{4})-(\d{2})' -and (Get-Date -Year $Matches[1] -Month $Matches[2] -Day 1).Date -lt $limiteMensal } |
            ForEach-Object {
                Remove-Item $_.FullName
                Registrar "Backup mensal antigo removido: $($_.Name)"
            }
    }

    Registrar "Backup finalizado com sucesso."
    exit 0
}
catch {
    Registrar "ERRO NO BACKUP: $($_.Exception.Message)"
    exit 1
}
finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
    if ($pastaTemporaria -and (Test-Path $pastaTemporaria)) { Remove-Item $pastaTemporaria -Recurse -Force }
}
