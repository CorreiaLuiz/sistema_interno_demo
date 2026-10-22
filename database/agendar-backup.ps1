# Agenda o backup automático do SISTEMA PRIVILEGE no Agendador de Tarefas do Windows.
#
# Rodar uma vez (PowerShell, na pasta do projeto):
#   powershell -ExecutionPolicy Bypass -File .\database\agendar-backup.ps1
#
# Cria a tarefa "Backup SISTEMA PRIVILEGE": todo dia no horário abaixo. Se o
# computador estiver desligado nessa hora, o backup roda assim que ele for
# ligado e o usuário entrar. Rodar de novo este script só atualiza a tarefa.
#
# Para remover:  Unregister-ScheduledTask -TaskName "Backup SISTEMA PRIVILEGE"
# Para rodar agora (teste):  Start-ScheduledTask -TaskName "Backup SISTEMA PRIVILEGE"

param(
    [string]$Horario = "12:30"
)

$ErrorActionPreference = "Stop"
$NOME_TAREFA = "Backup SISTEMA PRIVILEGE"
$script = Join-Path $PSScriptRoot "backup.ps1"

$acao = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`"" `
    -WorkingDirectory (Split-Path $PSScriptRoot -Parent)

$gatilho = New-ScheduledTaskTrigger -Daily -At $Horario

# StartWhenAvailable: se perdeu o horário (PC desligado), roda assim que der.
$config = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1)

# Roda com o usuário atual, só quando ele estiver conectado — não precisa
# guardar a senha do Windows na tarefa.
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $NOME_TAREFA -Action $acao -Trigger $gatilho -Settings $config `
    -Principal $principal -Description "Backup diário do banco e dos documentos do SISTEMA PRIVILEGE (database\backup.ps1)." -Force | Out-Null


Write-Host "Tarefa '$NOME_TAREFA' agendada para todo dia às $Horario."
Write-Host "Os backups ficam em: $(Join-Path $PSScriptRoot 'backups')"
