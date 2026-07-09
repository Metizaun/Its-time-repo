$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

Write-Host "Iniciando Supabase local..."
& npx supabase start
if ($LASTEXITCODE -ne 0) {
  throw "Falha ao iniciar o Supabase local."
}

Write-Host "Iniciando backend Docker e frontend Vite..."
& npm run dev
