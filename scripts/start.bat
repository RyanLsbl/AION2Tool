@echo off
REM Startet das AION2Tool unter Windows (aus dem Projektordner heraus).
cd /d "%~dp0\.."
if not exist .env (
  echo Bitte zuerst .env.example nach .env kopieren und ausfuellen.
  exit /b 1
)
if not exist node_modules\.bin\tsc.cmd (
  echo Installiere Abhaengigkeiten ...
  call npm install || exit /b 1
)
call npm run build || exit /b 1
node --no-warnings=ExperimentalWarning dist\server\index.js
