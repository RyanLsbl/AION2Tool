# Aktualisiert das AION2Tool (Dienst stoppen, Sicherung, git pull, bauen, starten).
# Ausfuehren in einer PowerShell als Administrator:  .\scripts\update.ps1

$ErrorActionPreference = 'Stop'
$ServiceName = 'AION2Tool'
$ProjectDir = Resolve-Path (Join-Path $PSScriptRoot '..')
Push-Location $ProjectDir

nssm stop $ServiceName
$Stamp = Get-Date -Format 'yyyy-MM-dd_HH-mm'
if (Test-Path 'data') { Copy-Item 'data' "data-backup-$Stamp" -Recurse }
git pull
npm install
npm run build
nssm start $ServiceName

Pop-Location
Write-Host "Update fertig. Sicherung der Datenbank: data-backup-$Stamp"
