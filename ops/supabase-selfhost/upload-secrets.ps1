param(
  [string]$SecretsFile = "$PSScriptRoot/migration-secrets.local",
  [string]$PlatformEnvFile = "$PSScriptRoot/../../.env.vps.local",
  [string]$SshKey = "$HOME/.ssh/chat-query-vps-nova",
  [string]$HostName = "187.127.49.20"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $SecretsFile)) {
  throw "Arquivo de segredos não encontrado: $SecretsFile"
}

$required = @(
  "SUPABASE_DB_PASSWORD",
  "SMTP_PASSWORD",
  "PLATFORM_S3_ACCESS_KEY_ID",
  "PLATFORM_S3_SECRET_ACCESS_KEY",
  "PLATFORM_S3_ENDPOINT"
)
$values = @{}
foreach ($line in Get-Content -LiteralPath $SecretsFile) {
  if ($line -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
    $values[$Matches[1]] = $Matches[2]
  }
}
$missing = @($required | Where-Object { -not $values.ContainsKey($_) -or [string]::IsNullOrWhiteSpace($values[$_]) })
if ($missing.Count -gt 0) {
  throw "Preencha os campos obrigatórios: $($missing -join ', ')"
}

$transferKeys = @($required)
if (Test-Path -LiteralPath $PlatformEnvFile) {
  $platformValues = @{}
  foreach ($line in Get-Content -LiteralPath $PlatformEnvFile) {
    if ($line -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
      $platformValues[$Matches[1]] = $Matches[2].Trim()
    }
  }
  if (
    $platformValues.ContainsKey("SUPABASE_SERVICE_ROLE_KEY") -and
    -not [string]::IsNullOrWhiteSpace($platformValues["SUPABASE_SERVICE_ROLE_KEY"]) -and
    $platformValues.ContainsKey("SUPABASE_URL") -and
    $platformValues["SUPABASE_URL"] -match 'hvziqfbnkicryfndoepk'
  ) {
    $values["PLATFORM_SERVICE_ROLE_KEY"] = $platformValues["SUPABASE_SERVICE_ROLE_KEY"]
    $transferKeys += "PLATFORM_SERVICE_ROLE_KEY"
  }
}

$remoteTemp = "/opt/supabase-migration/migration-secrets.env.upload"
$remoteFinal = "/opt/supabase-migration/migration-secrets.env"
$temporaryFile = New-TemporaryFile

try {
  $singleQuote = [char]39
  $doubleQuote = [char]34
  $shellQuoteReplacement = "$singleQuote$doubleQuote$singleQuote$doubleQuote$singleQuote"
  $protectedLines = foreach ($key in $transferKeys) {
    $value = $values[$key].Trim()
    $quotedValue = "$singleQuote$($value.Replace([string]$singleQuote, $shellQuoteReplacement))$singleQuote"
    "$key=$quotedValue"
  }
  [System.IO.File]::WriteAllText(
    $temporaryFile.FullName,
    (($protectedLines -join "`n") + "`n"),
    [System.Text.UTF8Encoding]::new($false)
  )

  & scp -q -i $SshKey -- $temporaryFile.FullName "root@${HostName}:$remoteTemp"
  if ($LASTEXITCODE -ne 0) { throw "Falha ao transferir o arquivo protegido" }

  & ssh -i $SshKey -o BatchMode=yes "root@$HostName" "install -m 600 '$remoteTemp' '$remoteFinal' && rm -f -- '$remoteTemp' && /opt/supabase-selfhost/apply-runtime-secrets.sh"
  if ($LASTEXITCODE -ne 0) { throw "Falha ao instalar/aplicar os segredos na VPS" }
} finally {
  Remove-Item -LiteralPath $temporaryFile.FullName -Force -ErrorAction SilentlyContinue
}

Write-Output "Segredos enviados e aplicados sem exibir valores."
