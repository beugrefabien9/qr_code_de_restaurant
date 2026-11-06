@echo off
setlocal
set "PROJECT_DIR=%~dp0"

for /f %%A in ('powershell -NoProfile -Command "[Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent().IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"') do set "IS_ADMIN=%%A"
if /I not "%IS_ADMIN%"=="True" (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

set "FIREWALL_ERROR="
netsh advfirewall firewall delete rule name="Restaurant Frontend 5173" >nul 2>&1
netsh advfirewall firewall delete rule name="Restaurant Laravel 8000" >nul 2>&1
netsh advfirewall firewall add rule name="Restaurant Frontend 5173" dir=in action=allow protocol=TCP localport=5173 profile=any remoteip=localsubnet >nul 2>&1
if errorlevel 1 set "FIREWALL_ERROR=1"
netsh advfirewall firewall add rule name="Restaurant Laravel 8000" dir=in action=allow protocol=TCP localport=8000 profile=any remoteip=localsubnet >nul 2>&1
if errorlevel 1 set "FIREWALL_ERROR=1"
if defined FIREWALL_ERROR (
    echo.
    echo ATTENTION : Windows n'a pas autorise la configuration du pare-feu.
    echo Relancez ce fichier avec un clic droit, puis "Executer en tant qu'administrateur".
    echo Cette autorisation est limitee aux appareils du reseau local.
    echo.
    pause
)

netstat -ano -p tcp | findstr /R /C:":8000 .*LISTENING" >nul
if errorlevel 1 start "Restaurant - Laravel" powershell -NoExit -ExecutionPolicy Bypass -Command "$ErrorActionPreference = 'Stop'; Set-Location -LiteralPath '%PROJECT_DIR%backend-laravel'; php artisan migrate --force; if ($LASTEXITCODE -eq 0) { php artisan serve --host=0.0.0.0 }"

netstat -ano -p tcp | findstr /R /C:":5173 .*LISTENING" >nul
if errorlevel 1 start "Restaurant - React" powershell -NoExit -ExecutionPolicy Bypass -Command "$network = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.IPv4Address } | Select-Object -First 1; $lanIp = $network.IPv4Address[0].IPAddress; if (-not $lanIp) { $lanIp = 'localhost' }; Write-Host ('Adresse du reseau local utilisee pour les QR : {0}' -f $lanIp); $env:VITE_PUBLIC_FRONTEND_HOST = ('{0}:5173' -f $lanIp); $env:VITE_API_BASE_URL = ('http://{0}:8000/api' -f $lanIp); $env:VITE_API_URL = $env:VITE_API_BASE_URL; Set-Location -LiteralPath '%PROJECT_DIR%frontend'; npm.cmd run dev -- --host 0.0.0.0"

endlocal
