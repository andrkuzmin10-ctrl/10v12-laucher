@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
 echo Install Node.js 22 LTS or newer from nodejs.org.
 pause
 exit /b 1
)
node start.cjs
pause
