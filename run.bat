@echo off
chcp 65001 >nul
title Небо - сайт погоды
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [!] Node.js не найден. Установите LTS-версию с https://nodejs.org/
  echo     и запустите этот файл снова.
  pause
  exit /b 1
)

echo Запуск сайта... Браузер откроется автоматически.
node server.js
echo.
echo Сервер остановлен.
pause
