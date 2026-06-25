# Local dev launcher (Windows). Double-click start-local.bat
$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
Set-Location -LiteralPath $Root

function Need-Install {
  return -not (Test-Path -LiteralPath (Join-Path $Root "node_modules"))
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host ""
  Write-Host "Node.js not found. Install LTS from https://nodejs.org/ (v20+)" -ForegroundColor Red
  Read-Host "Press Enter"
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
    Write-Host "Created .env.local from example." -ForegroundColor Yellow
    Write-Host "Fill OPENAI_API_KEY and YANDEX_S3_* (ask admin), then run start-local again." -ForegroundColor Yellow
    notepad $envLocal
    Read-Host "Press Enter"
    exit 0
  }
  Write-Host "Missing .env.local - ask admin for the file." -ForegroundColor Red
  Read-Host "Press Enter"
  exit 1
}

if ((Need-Install)) {
  Write-Host "First run: npm install (1-3 min)..." -ForegroundColor Cyan
  & npm install
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$port = 3000
$url = "http://localhost:$port/ozon-images"
Write-Host ""
Write-Host "Starting: $url" -ForegroundColor Green
Write-Host "Stop: Ctrl+C in this window" -ForegroundColor DarkGray
Write-Host ""

Start-Process $url
& npm run dev
