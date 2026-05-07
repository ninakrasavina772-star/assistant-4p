# Скопировать этот проект (папка compare на рабочем столе) в клон assistant-4p и закоммитить.
# Запуск: правый клик → Выполнить с PowerShell, ИЛИ из PowerShell:
#   cd "...\compare"
#   .\sync-to-github-repo.ps1 -TargetRepoPath "C:\путь\к\assistant-4p"
#
# Не копируются: node_modules, .next, .git, .cursor, .env.local (секреты остаются у вас локально).

param(
  [Parameter(Mandatory = $false)]
  [string]$TargetRepoPath = ""
)

$SourceRoot = $PSScriptRoot
if (-not $TargetRepoPath) {
  Write-Host "Подсказка: если клонировали в корень диска C:, путь часто такой: C:\assistant-4p" -ForegroundColor DarkGray
  $TargetRepoPath = (Read-Host "Полный путь к папке клона assistant-4p с GitHub").Trim().Trim('"')
}

if (-not (Test-Path -LiteralPath $TargetRepoPath)) {
  Write-Host "Ошибка: папка не найдена: $TargetRepoPath" -ForegroundColor Red
  exit 1
}
$gitDir = Join-Path $TargetRepoPath ".git"
if (-not (Test-Path -LiteralPath $gitDir)) {
  Write-Host "Ошибка: в папке нет .git — укажите корень клонированного репозитория." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "Откуда: $SourceRoot"
Write-Host "Куда:   $TargetRepoPath"
Write-Host "Копирование..." -ForegroundColor Cyan

$robArgs = @(
  $SourceRoot,
  $TargetRepoPath,
  "/E",
  "/R:1",
  "/W:1",
  "/NFL",
  "/NDL",
  "/NJH",
  "/NP",
  "/XD", "node_modules",
  "/XD", ".next",
  "/XD", ".git",
  "/XD", ".cursor",
  "/XF", ".env.local"
)
& robocopy @robArgs
$rc = $LASTEXITCODE
if ($rc -ge 8) {
  Write-Host "Ошибка копирования (robocopy код $rc)." -ForegroundColor Red
  exit $rc
}

Set-Location -LiteralPath $TargetRepoPath
git add -A
$changes = git status --porcelain
if (-not $changes) {
  Write-Host ""
  Write-Host "Нет изменений — файлы уже как на рабочем столе." -ForegroundColor Yellow
  exit 0
}

git commit -m "Обновление: мастер сравнения, API wizard, фильтр дублей по модели"
Write-Host ""
Write-Host "Коммит создан. Отправка на GitHub..." -ForegroundColor Cyan
git push
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "Push не удался (нужен вход в Git или доступ). Откройте папку репозитория и выполните: git push" -ForegroundColor Yellow
  exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Готово. Подождите 1–3 минуты — Vercel сам пересоберёт сайт." -ForegroundColor Green
