# Copy .env.local -> deploy/.env.production for Cloud Shell upload
$Root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $Root ".env.local"
$dst = Join-Path $PSScriptRoot ".env.production"
if (-not (Test-Path $src)) {
  Write-Host "Net .env.local v papke compare" -ForegroundColor Red
  exit 1
}
Get-Content $src | Where-Object {
  $_ -notmatch '^\s*VERCEL_' -and $_ -notmatch '^\s*BLOB_READ_WRITE_TOKEN\s*='
} | Set-Content $dst -Encoding UTF8
Write-Host "OK: deploy\.env.production" -ForegroundColor Green
Write-Host "Zagruzite etot fajl v Cloud Shell (Upload)"
