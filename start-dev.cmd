@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Рубрики — dev server
echo Запуск... Окно можно свернуть, но не закрывайте, пока нужен сайт.
echo.
echo === ВАЖНО ===
echo Откройте в браузере ТОТ ПОРТ, что в строке "Local:" ниже.
echo http://localhost:3002 и http://localhost:3000 - это РАЗНЫЕ серверы. Неверный порт = пусто или страница Яндекса.
echo.
echo.
npm run dev
echo.
echo Сервер остановлен. Клавиша — закрыть окно.
pause >nul
