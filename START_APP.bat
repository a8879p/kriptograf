@echo off
title Bitcoin Analyzer PRO
color 0A
cd /d "%~dp0"

echo ==============================================
echo   BITCOIN ANALYZER PRO - ЗАПУСК
echo ==============================================
echo.

:: Поскольку Node.js не установлен, используем Python
echo Запускаю сервер в новом окне и открываю браузер...
echo Сервер откроется в соседнем черном окне (не закрывайте его!)
echo.
start "Bitcoin Analyzer Server" python -m http.server 8333
timeout /t 2 /nobreak >nul
start http://localhost:8333/666BTC2GRAF.html
