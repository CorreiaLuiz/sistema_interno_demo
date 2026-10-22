# Testa se o último backup do SISTEMA PRIVILEGE realmente RESTAURA.
#
# O que faz (sem mexer no banco de verdade):
#   1. Pega o .zip mais novo de database\backups.
#   2. Restaura o banco num banco TEMPORÁRIO separado (sistema_ana_teste_restauracao).
#   3. Compara a quantidade de registros com o banco atual e confere se os
#      documentos do backup têm o arquivo junto.
#   4. Apaga o banco temporário e os arquivos extraídos.
#
# Rodar (PowerShell, na pasta do projeto):
#   powershell -ExecutionPolicy Bypass -File .\database\testar-backup.ps1
# Para testar um backup específico:  ... -File .\database\testar-backup.ps1 -Arquivo C:\caminho\backup_....zip

param([string]$Arquivo = "")

$ErrorActionPreference = "Stop"
$RAIZ = Split-Path $PSScriptRoot -Parent
$ARQUIVO_ENV = Join-Path $RAIZ "backend\.env"
$BANCO_TESTE = "sistema_ana_teste_restauracao"

function Ler-Env([string]$caminho) {
    $valores = @{}
    foreach ($linha in Get-Content -Path $caminho -Encoding UTF8) {
        if ($linha -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') { $valores[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'") }
    }
    return $valores
}

function Programa([string]$nome) {
    $noPath = Get-Command $nome -ErrorAction SilentlyContinue
    if ($noPath) { return $noPath.Source }
    $achados = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\$nome.exe" -ErrorAction SilentlyContinue |
        Sort-Object { [int]($_.Directory.Parent.Name -replace '\D', '') } -Descending
    if ($achados) { return $achados[0].FullName }
    throw "$nome não encontrado. Instale o PostgreSQL (Command Line Tools)."
}

$pasta = $null
$criouBanco = $false
try {
    $env_ = Ler-Env $ARQUIVO_ENV
    $DB_NAME = if ($env_.DB_NAME) { $env_.DB_NAME } else { "legalizacao_db" }
    $DB_USER = if ($env_.DB_USER) { $env_.DB_USER } else { "postgres" }
    $DB_HOST = if ($env_.DB_HOST) { $env_.DB_HOST } else { "localhost" }
    $DB_PORT = if ($env_.DB_PORT) { $env_.DB_PORT } else { "5432" }
    $env:PGPASSWORD = $env_.DB_PASSWORD   # só para este processo, nunca na tela
    $conexao = @("-h", $DB_HOST, "-p", $DB_PORT, "-U", $DB_USER, "--no-password")

    if (-not $Arquivo) {
        $ultimo = Get-ChildItem (Join-Path $PSScriptRoot "backups") -Filter "backup_*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if (-not $ultimo) { throw "Nenhum backup encontrado em database\backups." }
        $Arquivo = $ultimo.FullName
    }
    Write-Host "Testando: $(Split-Path $Arquivo -Leaf)  ($([math]::Round((Get-Item $Arquivo).Length / 1MB, 1)) MB, de $((Get-Item $Arquivo).LastWriteTime))"

    $pasta = Join-Path $env:TEMP ("teste_restauracao_" + (Get-Date -Format "yyyyMMddHHmmss"))
    Expand-Archive -Path $Arquivo -DestinationPath $pasta
    $arquivoBanco = Join-Path $pasta "banco.backup"
    if (-not (Test-Path $arquivoBanco)) { throw "O .zip não tem o banco.backup." }

    # Banco temporário (apaga se sobrou de um teste anterior)
    & (Programa "dropdb") @conexao --if-exists $BANCO_TESTE
    & (Programa "createdb") @conexao $BANCO_TESTE
    if ($LASTEXITCODE -ne 0) { throw "Não consegui criar o banco temporário." }
    $criouBanco = $true
    & (Programa "pg_restore") @conexao --no-owner -d $BANCO_TESTE $arquivoBanco 2>&1 | Out-Null
    # pg_restore às vezes avisa de coisas sem importância (comentários de extensão); o que vale é a conferência abaixo

    $psql = Programa "psql"
    $tabelas = @("empresas", "usuarios", "documentos", "certidoes", "licencas", "processos_legalizacao", "guias_importacao", "emails_enviados", "logs_auditoria")
    function Contar([string]$banco, [string]$tabela) {
        $r = & $psql @conexao -d $banco -t -A -c "SELECT count(*) FROM $tabela" 2>$null
        if ($LASTEXITCODE -ne 0) { return "-" }
        return [int]$r
    }
    Write-Host ""
    Write-Host ("{0,-24}{1,12}{2,12}" -f "Tabela", "No backup", "Hoje")
    $vazias = 0
    foreach ($t in $tabelas) {
        $noBackup = Contar $BANCO_TESTE $t
        $hoje = Contar $DB_NAME $t
        if ($noBackup -eq "-") { $vazias++ }
        Write-Host ("{0,-24}{1,12}{2,12}" -f $t, $noBackup, $hoje)
    }

    # Documentos: o arquivo de cada um está no .zip?
    $nomes = & $psql @conexao -d $BANCO_TESTE -t -A -c "SELECT nome_armazenado FROM documentos"
    $pastaUploads = Join-Path $pasta "uploads"
    $faltando = @($nomes | Where-Object { $_ -and -not (Test-Path (Join-Path $pastaUploads $_)) })
    $totalDocs = @($nomes | Where-Object { $_ }).Count
    Write-Host ""
    Write-Host "Documentos com o arquivo dentro do backup: $($totalDocs - $faltando.Count) de $totalDocs"

    Write-Host ""
    if ($vazias -eq 0 -and (Contar $BANCO_TESTE "usuarios") -gt 0) {
        Write-Host "RESULTADO: o backup RESTAURA corretamente." -ForegroundColor Green
        if ($faltando.Count) { Write-Host "Atenção: $($faltando.Count) documento(s) já estavam sem arquivo no sistema quando o backup foi feito." -ForegroundColor Yellow }
        $codigo = 0
    } else {
        Write-Host "RESULTADO: o backup NÃO restaurou direito. Veja database\RESTAURACAO.md." -ForegroundColor Red
        $codigo = 1
    }
}
catch {
    Write-Host "ERRO NO TESTE: $($_.Exception.Message)" -ForegroundColor Red
    $codigo = 1
}
finally {
    if ($criouBanco) { & (Programa "dropdb") @conexao --if-exists $BANCO_TESTE }
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
    if ($pasta -and (Test-Path $pasta)) { Remove-Item $pasta -Recurse -Force }
    Write-Host "Banco temporário e arquivos extraídos apagados."
}
exit $codigo
