$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

function Get-LocalSupabaseStatus {
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $statusLines = & npx supabase status --output json 2>$null
    $statusExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  if ($statusExitCode -ne 0) {
    throw "Nao foi possivel consultar o status do Supabase local."
  }

  $statusOutput = $statusLines | Out-String

  try {
    return $statusOutput | ConvertFrom-Json
  } catch {
    throw "O Supabase retornou um status invalido: $($_.Exception.Message)"
  }
}

function Wait-LocalSupabaseRestReady {
  param([int]$TimeoutSeconds = 90)

  $status = Get-LocalSupabaseStatus
  $apiUrl = ([string]$status.API_URL).TrimEnd("/")
  $serviceRoleKey = [string]$status.SERVICE_ROLE_KEY

  if ([string]::IsNullOrWhiteSpace($apiUrl) -or [string]::IsNullOrWhiteSpace($serviceRoleKey)) {
    throw "O status do Supabase nao informou API_URL ou SERVICE_ROLE_KEY."
  }

  $headers = @{
    apikey = $serviceRoleKey
    Authorization = "Bearer $serviceRoleKey"
    "Accept-Profile" = "crm"
  }
  $probeUrl = "$apiUrl/rest/v1/leads?select=id&limit=0"
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $lastError = "sem resposta"

  Write-Host "Aguardando PostgREST e schema cache ficarem prontos..."
  while ((Get-Date) -lt $deadline) {
    try {
      $requestParameters = @{
        Uri = $probeUrl
        Headers = $headers
        UseBasicParsing = $true
        TimeoutSec = 5
      }
      $response = Invoke-WebRequest @requestParameters

      if ($response.StatusCode -eq 200) {
        Write-Host "Supabase REST esta pronto."
        return
      }

      $lastError = "HTTP $($response.StatusCode)"
    } catch {
      $lastError = $_.Exception.Message
    }

    Start-Sleep -Milliseconds 750
  }

  throw "Supabase REST nao ficou pronto em ${TimeoutSeconds}s. Ultimo erro: $lastError"
}

Write-Host "Iniciando Supabase local..."
& npx supabase start
if ($LASTEXITCODE -ne 0) {
  throw "Falha ao iniciar o Supabase local."
}

Wait-LocalSupabaseRestReady

Write-Host "Iniciando backend Docker e frontend Vite..."
& npm run dev
