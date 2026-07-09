$ErrorActionPreference = "Stop"

$rootDir = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $rootDir ".tmp"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Test-CrmBackendHealth {
  try {
    $response = Invoke-WebRequest -Uri "http://localhost:3000/health" -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Test-DockerAvailable {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker nao encontrado. Instale Docker Desktop antes de rodar o ambiente padronizado."
  }
}

function Get-BackendListenerProcess {
  $connection = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $connection) {
    return $null
  }

  return Get-CimInstance Win32_Process -Filter "ProcessId=$($connection.OwningProcess)"
}

function Stop-LegacyBackendIfRunning {
  $process = Get-BackendListenerProcess
  if (-not $process) {
    return
  }

  $commandLine = if ([string]::IsNullOrWhiteSpace($process.CommandLine)) { "" } else { $process.CommandLine }
  if ($process.Name -match '^(wslrelay|com\.docker|Docker Desktop)') {
    return
  }

  if ($commandLine -match "Project\\\\IA|api-server\.ts|tsx watch") {
    Write-Host "Stopping legacy local backend process on port 3000 (PID $($process.ProcessId))..."
    Stop-Process -Id $process.ProcessId -Force
    Start-Sleep -Seconds 1
    return
  }

  if ($commandLine -notmatch "docker|com\.docker" -and $process.Name -notmatch '^(wslrelay|com\.docker|Docker Desktop)') {
    throw "A porta 3000 ja esta em uso pelo processo $($process.ProcessId) ($($process.Name)). Pare esse processo e rode novamente."
  }
}

function Get-FrontendListenerProcess {
  $connection = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $connection) {
    return $null
  }

  return Get-CimInstance Win32_Process -Filter "ProcessId=$($connection.OwningProcess)"
}

function Stop-LegacyFrontendIfRunning {
  $process = Get-FrontendListenerProcess
  if (-not $process) {
    return
  }

  $commandLine = if ([string]::IsNullOrWhiteSpace($process.CommandLine)) { "" } else { $process.CommandLine }
  if ($commandLine -match "vite|npm run dev:frontend|npm exec vite") {
    Write-Host "Stopping legacy local frontend process on port 8080 (PID $($process.ProcessId))..."
    Stop-Process -Id $process.ProcessId -Force
    Start-Sleep -Seconds 1
    return
  }

  throw "A porta 8080 ja esta em uso pelo processo $($process.ProcessId) ($($process.Name)). Pare esse processo e rode novamente."
}

function Start-BackendDockerStack {
  Set-Location $rootDir
  & docker compose up -d --build redis backend
  if ($LASTEXITCODE -ne 0) {
    throw "Falha ao subir o backend via Docker Compose."
  }
}

function Stop-BackendDockerStack {
  Set-Location $rootDir
  & docker compose stop backend redis | Out-Null
}

Test-DockerAvailable

Set-Location $rootDir

try {
  $startedDockerStack = $false

  Stop-LegacyBackendIfRunning

  $process = Get-BackendListenerProcess
  $backendAlreadyDocker = $false
  if ($process) {
    $commandLine = if ([string]::IsNullOrWhiteSpace($process.CommandLine)) { "" } else { $process.CommandLine }
    $backendAlreadyDocker = ($commandLine -match "docker|com\.docker") -or ($process.Name -match '^(wslrelay|com\.docker|Docker Desktop)')
  }

  if ($backendAlreadyDocker) {
    Write-Host "CRM backend Docker stack is already running on http://localhost:3000."
  } else {
    Write-Host "Starting CRM backend via Docker Compose on http://localhost:3000..."
    Start-BackendDockerStack
    $startedDockerStack = $true
  }

  Stop-LegacyFrontendIfRunning

  $healthy = $false
  $deadline = (Get-Date).AddSeconds(45)

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
    Write-Warning "CRM backend did not answer /health within 45s."
    & docker compose logs --tail 40 backend
  }

  npm run dev:frontend
} finally {
  if ($startedDockerStack) {
    Stop-BackendDockerStack
  }
}
