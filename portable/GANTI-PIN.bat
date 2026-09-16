@echo off
setlocal
cd /d "%~dp0"
"runtime\node.exe" "server.mjs" --change-pin
pause
