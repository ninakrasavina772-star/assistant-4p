# First-time setup for colleagues (Windows).
#   git clone https://github.com/ninakrasavina772-star/assistant-4p.git
#   cd assistant-4p
#   .\deploy\setup-colleague-windows.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $Root

if (-not (Test-Path -LiteralPath (Join-Path $Root "package.json"))) {
  Write-Host "Run from assistant-4p repo root" -ForegroundColor Red
  exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Install Node.js 20+ from https://nodejs.org/" -ForegroundColor Red
  exit 1
}

Write-Host "npm install..." -ForegroundColor Cyan
& npm install

$envLocal = Join-Path $Root ".env.local"
$example = Join-Path $Root "deploy\env.local.colleague.example"
if (-not (Test-Path -LiteralPath $envLocal) -and (Test-Path -LiteralPath $example)) {
  Copy-Item -LiteralPath $example -Destination $envLocal
  Write-Host ""
  Write-Host "Created .env.local - paste secrets from admin." -ForegroundColor Yellow
  notepad $envLocal
}

Write-Host ""
Write-Host "Next: double-click start-local.bat" -ForegroundColor Green
Write-Host "URL: http://localhost:3000/ozon-images"
