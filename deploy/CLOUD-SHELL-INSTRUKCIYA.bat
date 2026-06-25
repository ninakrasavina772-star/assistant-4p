@echo off
chcp 65001 >nul
echo.
echo ============================================================
echo   PERENOS CHEREZ YANDEX CLOUD SHELL (bez tokena)
echo ============================================================
echo.
echo Yandex s iyulya 2026 ne prinimaet OAuth token v skripte.
echo Delaem cherez Cloud Shell - tam vy uzhe voshli v akkaunt.
echo.
echo SHAG 1. Skopiruyte fajl .env.local v papku deploy:
echo        compare\deploy\.env.production
echo        (kopiya vashego .env.local bez VERCEL_)
echo.
echo SHAG 2. Otkrojte v brauzere:
echo        https://console.cloud.yandex.ru
echo.
echo SHAG 3. Vverhu sprava najmite ikonku ^>_^  (Cloud Shell)
echo        Otkroetsya chernoe okno terminala VNUTRI brauzera.
echo.
echo SHAG 4. V Cloud Shell: menyu (tri poloski) - Upload
echo        Zagruzite fajl .env.production v domashnyuyu papku
echo.
echo SHAG 5. Vstavte v Cloud Shell ODNU komandu (pravyj klik = vstavit):
echo.
echo curl -fsSL https://raw.githubusercontent.com/ninakrasavina772-star/assistant-4p/main/deploy/cloud-shell-deploy.sh ^| bash
echo.
echo SHAG 6. Podozhdite 10-15 min. V konce budet adres http://IP:3000/ozon-images
echo.
pause
