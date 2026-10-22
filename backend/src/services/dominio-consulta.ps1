# Consultas SOMENTE LEITURA no banco do Domínio (ODBC), chamado pelo dominioService.js.
# Entrada (stdin, JSON): { "nome": "select ...", ... }
# Saída (stdout, JSON):  { "nome": [[col1, col2, ...], ...], ... }  ou  { "_erro": "..." }
# Credenciais vêm das variáveis DOMINIO_DSN / DOMINIO_USUARIO / DOMINIO_SENHA.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$entrada = [Console]::In.ReadToEnd() | ConvertFrom-Json

$resultado = @{}
$con = $null
try {
    $con = New-Object System.Data.Odbc.OdbcConnection("DSN=$($env:DOMINIO_DSN);UID=$($env:DOMINIO_USUARIO);PWD=$($env:DOMINIO_SENHA)")
    $con.Open()
    $cmd = $con.CreateCommand()
    $cmd.CommandTimeout = 120
    foreach ($p in $entrada.PSObject.Properties) {
        $sql = [string]$p.Value
        if ($sql -notmatch '^\s*select\b' -or $sql -match ';') { throw "Consulta '$($p.Name)' recusada: apenas um SELECT por vez." }
        $cmd.CommandText = $sql
        $linhas = New-Object System.Collections.Generic.List[object]
        $r = $cmd.ExecuteReader()
        try {
            while ($r.Read()) {
                $linha = New-Object System.Collections.Generic.List[object]
                for ($i = 0; $i -lt $r.FieldCount; $i++) {
                    $v = $r.GetValue($i)
                    if ($v -is [System.DBNull]) { $linha.Add($null) }
                    elseif ($v -is [datetime]) { $linha.Add($v.ToString('yyyy-MM-dd')) }
                    elseif ($v -is [decimal] -or $v -is [double] -or $v -is [single]) { $linha.Add([double]$v) }
                    elseif ($v -is [int] -or $v -is [long] -or $v -is [int16]) { $linha.Add([long]$v) }
                    else { $linha.Add([string]$v) }
                }
                $linhas.Add($linha)
            }
        } finally { $r.Close() }
        $resultado[$p.Name] = $linhas
    }
} catch {
    $resultado = @{ _erro = $_.Exception.Message.Split("`n")[0] }
} finally {
    if ($con) { $con.Close() }
}
ConvertTo-Json -InputObject $resultado -Depth 6 -Compress
