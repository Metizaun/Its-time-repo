param(
  [string]$PreviousMigration = "20260622143901",
  [string]$DatabaseContainer = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$migrationVersion = "20260622215036"

function Invoke-Checked([string]$Command, [string[]]$Arguments) {
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Command falhou com codigo $LASTEXITCODE"
  }
}

function Resolve-DatabaseContainer {
  if ($DatabaseContainer) { return $DatabaseContainer }
  $containers = @(@(
    docker ps --filter "name=supabase_db_" --format "{{.Names}}"
  ) | Where-Object { $_ -and $_.Trim() })
  if ($LASTEXITCODE -ne 0) { throw "Nao foi possivel consultar os containers Docker" }
  if ($containers.Count -ne 1) {
    throw "Esperado exatamente um container supabase_db_; informe -DatabaseContainer. Encontrados: $($containers -join ', ')"
  }
  return ([string]$containers[0]).Trim()
}

function Invoke-SqlFile([string]$Container, [string]$RelativePath) {
  $fullPath = Join-Path $repoRoot $RelativePath
  if (-not (Test-Path -LiteralPath $fullPath)) { throw "SQL ausente: $fullPath" }
  Get-Content -Raw -LiteralPath $fullPath |
    docker exec -i $Container psql -U postgres -d postgres -v ON_ERROR_STOP=1
  if ($LASTEXITCODE -ne 0) { throw "Falha ao executar $RelativePath" }
}

Push-Location $repoRoot
try {
  Invoke-Checked "docker" @("info", "--format", "{{.ServerVersion}}")
  Invoke-Checked "supabase" @("start")
  & supabase db reset --local --no-seed --version $PreviousMigration
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "supabase db reset retornou erro; validando se foi apenas timeout pos-reset"
    Start-Sleep -Seconds 10
    $probeContainer = Resolve-DatabaseContainer
    $probe = docker exec $probeContainer psql -U postgres -d postgres -At -v ON_ERROR_STOP=1 -c @"
SELECT
  COALESCE((SELECT max(version) FROM supabase_migrations.schema_migrations), ''),
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'crm' AND c.relname IN ('ai_agents','ai_stage_rules','ai_lead_state','ai_runs')),
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'agents' AND c.relname IN ('ai_agents','ai_stage_rules','ai_lead_state','ai_runs'));
"@
    if ($LASTEXITCODE -ne 0 -or $probe.Trim() -ne "$PreviousMigration|4|0") {
      throw "Reset nao atingiu o estado anterior esperado. Estado: $probe"
    }
    Write-Host "Estado anterior confirmado no Postgres; continuando apos timeout do Storage."
  }
  $container = Resolve-DatabaseContainer

  Write-Host "Aplicando migration $migrationVersion"
  Invoke-Checked "supabase" @("migration", "up", "--local")
  Invoke-SqlFile $container "supabase/manual/2026-06-22_verify_agents_tools_and_bi.sql"
  Invoke-Checked "supabase" @("db", "lint", "--local", "--schema", "agents,bi,crm", "--fail-on", "error")

  Write-Host "Ensaiando rollback"
  Invoke-SqlFile $container "supabase/manual/2026-06-22_rollback_agents_tools_and_bi.sql"
  Invoke-SqlFile $container "supabase/manual/2026-06-22_verify_agents_rollback.sql"

  Write-Host "Reaplicando migration apos rollback"
  Invoke-Checked "supabase" @("migration", "up", "--local")
  Invoke-SqlFile $container "supabase/manual/2026-06-22_verify_agents_tools_and_bi.sql"
  Invoke-Checked "supabase" @("db", "lint", "--local", "--schema", "agents,bi,crm", "--fail-on", "error")

  Write-Host "Ensaio migration -> rollback -> migration concluido com sucesso."
} finally {
  Pop-Location
}
