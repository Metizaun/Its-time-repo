param(
  [string]$EnvFile = ".env.local",
  [ValidateSet("ELEVENLABS_API_KEY")]
  [string]$Name = "ELEVENLABS_API_KEY"
)

$ErrorActionPreference = "Stop"
$resolvedFile = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $EnvFile))
$secret = Read-Host "Informe $Name (a entrada ficara oculta)" -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)

try {
  $plainText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  if ([string]::IsNullOrWhiteSpace($plainText)) {
    throw "O segredo nao pode ficar vazio."
  }
  if ($plainText -match "[`r`n]") {
    throw "O segredo nao pode conter quebra de linha."
  }

  $lines = if (Test-Path -LiteralPath $resolvedFile) {
    [System.Collections.Generic.List[string]](Get-Content -LiteralPath $resolvedFile)
  } else {
    [System.Collections.Generic.List[string]]::new()
  }
  $replacement = "$Name=$plainText"
  $found = $false
  for ($index = 0; $index -lt $lines.Count; $index += 1) {
    if ($lines[$index] -match "^$([regex]::Escape($Name))=") {
      $lines[$index] = $replacement
      $found = $true
    }
  }
  if (-not $found) {
    $lines.Add($replacement)
  }

  $directory = Split-Path -Parent $resolvedFile
  if (-not (Test-Path -LiteralPath $directory)) {
    New-Item -ItemType Directory -Path $directory | Out-Null
  }
  [System.IO.File]::WriteAllLines($resolvedFile, $lines, [System.Text.UTF8Encoding]::new($false))
  Write-Host "$Name gravado em arquivo ignorado pelo Git. O valor nao foi exibido."
} finally {
  if ($pointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
  $plainText = $null
}
