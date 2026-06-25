# Первичная настройка на компьютере коллеги (Windows).
# Запуск из PowerShell в пустой папке или из уже клонированного репозитория:
#   git clone https://github.com/ninakrasavina772-star/assistant-4p.git
#   cd assistant-4p
#   .\deploy\setup-colleague-windows.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $Root

if (-not (Test-Path -LiteralPath (Join-Path $Root "package.json"))) {
  Write-Host "Запустите из корня репозитория assistant-4p" -ForegroundColor Red
  exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Установите Node.js 20+ с https://nodejs.org/" -ForegroundColor Red
  exit 1
}

Write-Host "npm install..." -ForegroundColor Cyan
& npm install

$envLocal = Join-Path $Root ".env.local"
$example = Join-Path $Root "deploy\env.local.colleague.example"
if (-not (Test-Path -LiteralPath $envLocal) -and (Test-Path -LiteralPath $example)) {
  Copy-Item -LiteralPath $example -Destination $envLocal
  Write-Host ""
  Write-Host "Создан .env.local — вставьте секреты от администратора." -ForegroundColor Yellow
  notepad $envLocal
}

Write-Host ""
Write-Host "Дальше: двойной клик start-local.bat или .\start-local.ps1" -ForegroundColor Green
Write-Host "Страница: http://localhost:3000/ozon-images"
