$ErrorActionPreference = "Stop"

$rootDir = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $rootDir "Project\IA"
$logDir = Join-Path $rootDir ".tmp"
$backendOut = Join-Path $logDir "crm-backend.out.log"
$backendErr = Join-Path $logDir "crm-backend.err.log"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Test-CrmBackendHealth {
  try {
    $response = Invoke-WebRequest -Uri "http://localhost:3000/health" -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

$backend = $null

if (Test-CrmBackendHealth) {
  Write-Host "CRM backend is already running on http://localhost:3000."
} else {
  Write-Host "Starting CRM backend on http://localhost:3000..."
  $backend = Start-Process `
    -FilePath "powershell.exe" `
    -ArgumentList @("-NoProfile", "-Command", "npm run dev") `
    -WorkingDirectory $backendDir `
    -PassThru `
    -WindowStyle Hidden `
    -RedirectStandardOutput $backendOut `
    -RedirectStandardError $backendErr
}

try {
  $healthy = $false
  $deadline = (Get-Date).AddSeconds(30)

  while ((Get-Date) -lt $deadline) {
    if (Test-CrmBackendHealth) {
      $healthy = $true
      break
    }

    Start-Sleep -Milliseconds 750
  }

  if ($healthy) {
    Write-Host "CRM backend is ready."
  } else {
    Write-Warning "CRM backend did not answer /health within 30s. Check .tmp/crm-backend.err.log."
    if (Test-Path $backendErr) {
      Get-Content $backendErr -Tail 40
    }
  }

  npm run dev:frontend
} finally {
  if ($backend -and -not $backend.HasExited) {
    Stop-Process -Id $backend.Id -Force
  }
}
