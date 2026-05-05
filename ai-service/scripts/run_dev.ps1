$ErrorActionPreference = "Stop"

$serviceRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $serviceRoot
$python = Join-Path $repoRoot ".venv\Scripts\python.exe"

if (-not (Test-Path $python)) {
  $python = "python"
}

Set-Location $serviceRoot

$hostValue = if ($env:AI_SERVICE_HOST) { $env:AI_SERVICE_HOST } else { "127.0.0.1" }
$portValue = if ($env:AI_SERVICE_PORT) { $env:AI_SERVICE_PORT } else { "8100" }

& $python -m uvicorn app.main:app --host $hostValue --port $portValue --reload
