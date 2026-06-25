# Pull production secrets from Vercel into .env.local (admin / colleagues).
# Requires: npx vercel login
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $Root

Write-Host "Pulling env from Vercel (production)..." -ForegroundColor Cyan
& npx vercel env pull .env.local --environment=production --yes
if ($LASTEXITCODE -ne 0) {
  Write-Host "Failed. Run: npx vercel login" -ForegroundColor Red
  exit $LASTEXITCODE
}

$lines = Get-Content .env.local -Encoding UTF8 | Where-Object {
  $_ -notmatch '^\s*VERCEL_' -and $_ -notmatch '^\s*BLOB_READ_WRITE_TOKEN\s*='
}
$lines | Set-Content .env.local -Encoding UTF8

if (-not ($lines -match '^COMPARE_SKIP_AUTH=')) {
  Add-Content .env.local "COMPARE_SKIP_AUTH=1"
}

Write-Host ""
Write-Host "OK -> .env.local" -ForegroundColor Green
Write-Host "Run start-local.bat. Share .env.local with colleagues via a secure channel."
