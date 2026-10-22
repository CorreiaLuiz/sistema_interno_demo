# Troca a senha do usuário do banco (PostgreSQL) e atualiza o backend\.env
# de uma vez, para o sistema e o backup continuarem funcionando.
#
# Como usar (num PowerShell normal, na pasta do projeto):
#   powershell -ExecutionPolicy Bypass -File database\trocar-senha-banco.ps1
#
# A senha nova é digitada aqui mesmo (não aparece na tela) e não fica
# gravada em nenhum outro lugar além do backend\.env.
# Depois: feche e abra de novo o servidor (npm run dev).

$ErrorActionPreference = 'Stop'
$RAIZ = Split-Path -Parent $PSScriptRoot
$ARQUIVO_ENV = Join-Path $RAIZ 'backend\.env'

function Encontrar-Psql {
    $comando = Get-Command psql.exe -ErrorAction SilentlyContinue
    if ($comando) { return $comando.Source }
    $candidato = Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\psql.exe' -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending | Select-Object -First 1
    if ($candidato) { return $candidato.FullName }
    throw 'psql.exe não encontrado. O PostgreSQL está instalado?'
}

function Texto-Da-Senha($segura) {
    $ponteiro = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($segura)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ponteiro) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ponteiro) }
}

if (-not (Test-Path $ARQUIVO_ENV)) { throw "Não achei o $ARQUIVO_ENV" }
# Lê como UTF-8 e grava de volta como UTF-8 sem BOM (o Node lê assim)
$utf8 = New-Object System.Text.UTF8Encoding($false)
$conteudo = [IO.File]::ReadAllText($ARQUIVO_ENV, $utf8)
$valores = @{}
foreach ($linha in $conteudo -split "`r?`n") {
    if ($linha -match '^\s*([A-Z0-9_]+)\s*=(.*)$') { $valores[$Matches[1]] = $Matches[2].Trim() }
}
$usuario = if ($valores.DB_USER) { $valores.DB_USER } else { 'postgres' }
$servidor = if ($valores.DB_HOST) { $valores.DB_HOST } else { 'localhost' }
$porta = if ($valores.DB_PORT) { $valores.DB_PORT } else { '5432' }
$banco = if ($valores.DB_NAME) { $valores.DB_NAME } else { 'legalizacao_db' }
$senhaAtual = $valores.DB_PASSWORD
$psql = Encontrar-Psql

Write-Host ''
Write-Host "Trocar a senha do banco (usuário: $usuario)" -ForegroundColor Cyan
Write-Host 'Regras: pelo menos 8 caracteres, sem espaço e sem os símbolos  #  "  ''  `  \'
Write-Host ''

while ($true) {
    $nova = Texto-Da-Senha (Read-Host 'Senha nova' -AsSecureString)
    $repetida = Texto-Da-Senha (Read-Host 'Repita a senha nova' -AsSecureString)
    if ($nova -ne $repetida) { Write-Host 'As duas senhas não são iguais. Tente de novo.' -ForegroundColor Yellow; continue }
    if ($nova.Length -lt 8) { Write-Host 'Use pelo menos 8 caracteres.' -ForegroundColor Yellow; continue }
    if ($nova -match '[\s#"''`\\]') { Write-Host 'Tire espaços e os símbolos # " '' ` \ da senha.' -ForegroundColor Yellow; continue }
    break
}

# 1. Troca no PostgreSQL (entrando com a senha atual do .env)
$env:PGPASSWORD = $senhaAtual
& $psql -h $servidor -p $porta -U $usuario -d $banco -v ON_ERROR_STOP=1 -q -c "ALTER USER `"$usuario`" WITH PASSWORD '$nova';"
if ($LASTEXITCODE -ne 0) { throw 'O PostgreSQL recusou a troca (a senha atual do .env está certa?). Nada foi alterado.' }

# 2. Confere se a senha nova entra
$env:PGPASSWORD = $nova
& $psql -h $servidor -p $porta -U $usuario -d $banco -q -t -c 'SELECT 1;' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'A senha foi trocada mas o teste falhou. Não mexa no .env e me chame.' }
Remove-Item Env:PGPASSWORD

# 3. Atualiza só a linha DB_PASSWORD do .env
$novoConteudo = [regex]::Replace($conteudo, '(?m)^DB_PASSWORD=[^\r\n]*', { param($m) "DB_PASSWORD=$nova" })
[IO.File]::WriteAllText($ARQUIVO_ENV, $novoConteudo, $utf8)

Write-Host ''
Write-Host 'Pronto! Senha do banco trocada e .env atualizado.' -ForegroundColor Green
Write-Host 'Agora feche e abra de novo o servidor (npm run dev).'
Write-Host 'Se usa o pgAdmin, ele vai pedir a senha nova na próxima vez.'
