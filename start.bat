@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Installing packages, please wait...
  call npm install
)
:loop
node redarrows.js
echo.
echo ===== The bot stopped. Read the message above. =====
echo Press any key to start it again, or close this window.
pause >nul
goto loop
