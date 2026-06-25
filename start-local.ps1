# Локальный запуск для коллег (Windows). Двойной клик или: .\start-local.ps1
$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
Set-Location -LiteralPath $Root

function Need-Install {
  return -not (Test-Path -LiteralPath (Join-Path $Root "node_modules"))
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host ""
  Write-Host "Node.js не найден. Установите LTS с https://nodejs.org/ (версия 20+)" -ForegroundColor Red
  Read-Host "Enter"
  exit 1
}

$nodeVer = (node -p "process.versions.node")
Write-Host "Node $nodeVer"

$envLocal = Join-Path $Root ".env.local"
$envExample = Join-Path $Root "deploy\env.local.colleague.example"
if (-not (Test-Path -LiteralPath $envLocal)) {
  if (Test-Path -LiteralPath $envExample) {
    Copy-Item -LiteralPath $envExample -Destination $envLocal
    Write-Host ""
    Write-Host "Создан .env.local из примера." -ForegroundColor Yellow
    Write-Host "Заполните OPENAI_API_KEY и YANDEX_S3_* (администратор пришлёт значения), затем снова запустите start-local." -ForegroundColor Yellow
    notepad $envLocal
    Read-Host "Enter"
    exit 0
  }
  Write-Host "Нет .env.local — попросите у администратора файл или deploy/env.local.colleague.example" -ForegroundColor Red
  Read-Host "Enter"
  exit 1
}

if ((Need-Install)) {
  Write-Host "Первый запуск: npm install (1–3 мин)..." -ForegroundColor Cyan
  & npm install
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$port = 3000
$url = "http://localhost:$port/ozon-images"
Write-Host ""
Write-Host "Запуск: $url" -ForegroundColor Green
Write-Host "Остановка: Ctrl+C в этом окне" -ForegroundColor DarkGray
Write-Host ""

Start-Process $url
& npm run dev
