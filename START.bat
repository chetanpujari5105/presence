@echo off
title Presence website - keep this window open
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed. Get the "LTS" version from https://nodejs.org
  echo  then double-click START.bat again.
  echo.
  pause
  exit /b
)

if not exist node_modules (
  echo  First time setup - downloading the pieces the server needs...
  call npm install
)

if not exist .env (
  copy .env.example .env >nul
  echo.
  echo  I created a settings file called .env
  echo  Open it with Notepad, change ADMIN_PASSWORD, save, then run START.bat again.
  echo.
  notepad .env
  pause
  exit /b
)

start "" http://localhost:3000
node server.js
pause