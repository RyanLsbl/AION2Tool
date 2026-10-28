# Richtet das AION2Tool als Windows-Dienst ein (startet automatisch mit Windows).
# Voraussetzung: NSSM (https://nssm.cc) ist installiert und im PATH,
# z. B. per "winget install NSSM.NSSM" oder "choco install nssm".
# Ausfuehren in einer PowerShell als Administrator:  .\scripts\install-service.ps1

$ErrorActionPreference = 'Stop'
$ServiceName = 'AION2Tool'
$ProjectDir = Resolve-Path (Join-Path $PSScriptRoot '..')
$Node = (Get-Command node).Source

if (-not (Test-Path (Join-Path $ProjectDir '.env'))) {
  throw "Bitte zuerst .env.example nach .env kopieren und ausfuellen."
}

Push-Location $ProjectDir
npm install
npm run build
Pop-Location

New-Item -ItemType Directory -Force -Path (Join-Path $ProjectDir 'logs') | Out-Null

nssm install $ServiceName $Node "--no-warnings=ExperimentalWarning" "dist\server\index.js"
nssm set $ServiceName AppDirectory $ProjectDir
nssm set $ServiceName DisplayName 'AION2Tool - Checkliste der Legion'
nssm set $ServiceName Start SERVICE_AUTO_START
nssm set $ServiceName AppStdout (Join-Path $ProjectDir 'logs\tool.log')
nssm set $ServiceName AppStderr (Join-Path $ProjectDir 'logs\tool-error.log')
nssm set $ServiceName AppRotateFiles 1
nssm set $ServiceName AppRotateBytes 5242880
nssm set $ServiceName AppExit Default Restart
nssm start $ServiceName

Write-Host "Dienst '$ServiceName' laeuft. Logs: $ProjectDir\logs"
