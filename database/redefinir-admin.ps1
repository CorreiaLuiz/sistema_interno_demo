# Redefine o e-mail e a senha do administrador do SISTEMA PRIVILEGE — para quando
# não dá mais para entrar (esqueceu a senha, digitou errado ao trocar...).
#
# Como usar (num PowerShell na pasta principal do sistema):
#   powershell -ExecutionPolicy Bypass -File database\redefinir-admin.ps1
#
# A senha é digitada aqui (não aparece na tela) e vai direto para o banco,
# já protegida — não fica gravada em arquivo nenhum.

$ErrorActionPreference = 'Stop'
$RAIZ = Split-Path -Parent $PSScriptRoot
$BACKEND = Join-Path $RAIZ 'backend'

function Texto-Da-Senha($segura) {
    $ponteiro = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($segura)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ponteiro) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ponteiro) }
}

Write-Host ''
Write-Host 'Redefinir o administrador do sistema' -ForegroundColor Cyan
Write-Host ''

$atual = Read-Host 'E-mail ATUAL do administrador [admin@demo.com.br]'
if (-not $atual) { $atual = 'admin@demo.com.br' }
$novo = Read-Host 'E-mail NOVO (Enter para manter o mesmo)'
if (-not $novo) { $novo = $atual }

while ($true) {
    $senha = Texto-Da-Senha (Read-Host 'Senha nova (mínimo 8 caracteres)' -AsSecureString)
    $repetida = Texto-Da-Senha (Read-Host 'Repita a senha nova' -AsSecureString)
    if ($senha -ne $repetida) { Write-Host 'As duas senhas não são iguais. Tente de novo.' -ForegroundColor Yellow; continue }
    if ($senha.Length -lt 8) { Write-Host 'Use pelo menos 8 caracteres.' -ForegroundColor Yellow; continue }
    break
}

$env:ADMIN_EMAIL_ATUAL = $atual
$env:ADMIN_EMAIL_NOVO = $novo
$env:ADMIN_SENHA_NOVA = $senha
$env:NODE_ENV = 'production'  # sem as mensagens técnicas de SQL na tela
try {
    Push-Location $BACKEND
    & node 'src\utils\redefinirAdmin.js'
    $codigo = $LASTEXITCODE
} finally {
    Pop-Location
    Remove-Item Env:ADMIN_SENHA_NOVA, Env:ADMIN_EMAIL_ATUAL, Env:ADMIN_EMAIL_NOVO, Env:NODE_ENV -ErrorAction SilentlyContinue
}

Write-Host ''
if ($codigo -eq 0) {
    Write-Host "Pronto! Entre no sistema com $novo e a senha nova." -ForegroundColor Green
    Write-Host 'Se aparecer "Muitas tentativas", feche e abra o servidor de novo (npm run dev).'
} else {
    Write-Host 'Não deu certo — nada foi alterado. Veja a mensagem acima.' -ForegroundColor Red
}
