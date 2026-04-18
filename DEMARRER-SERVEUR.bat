@echo off
setlocal enabledelayedexpansion
title Sales Companion — Serveur
color 0A
echo.
echo  ==========================================
echo   SALES COMPANION — Intelligence B2B
echo  ==========================================
echo.
echo  Demarrage du serveur...
echo.

cd /d "%~dp0server"

:: Verifier si Node.js est installe
node --version > nul 2>&1
if errorlevel 1 (
    echo  ERREUR : Node.js n'est pas installe.
    echo  Telechargez-le sur : https://nodejs.org
    echo.
    pause
    exit /b 1
)

:: Installer les dependances si necessaire
if not exist "node_modules" (
    echo  Installation des dependances...
    npm install
    echo.
)

:: Trouver l'IP locale (premiere IPv4 non-loopback)
set IP=localhost
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /C:"Adresse IPv4"') do (
    set RAWIP=%%a
    set RAWIP=!RAWIP: =!
    if not "!RAWIP!"=="127.0.0.1" (
        set IP=!RAWIP!
        goto :found
    )
)
:found

echo  ==========================================
echo   Serveur demarre avec succes !
echo  ==========================================
echo.
echo   Panel Admin    : http://localhost:3210/admin
echo   App Mobile     : http://%IP%:3210/mobile
echo   Landing Page   : http://%IP%:3210/
echo   API            : http://localhost:3210
echo.
echo   Login admin    : admin / admin123
echo.
echo   Partagez ces liens avec vos utilisateurs :
echo   Mobile  ^> http://%IP%:3210/mobile
echo   Web     ^> http://%IP%:3210/
echo.
echo  ==========================================
echo   Appuyez sur Ctrl+C pour arreter
echo  ==========================================
echo.

:: Passer l'IP au serveur via variable d'environnement
set SERVER_IP=%IP%
node server/server-firebase.js
pause
