@echo off
setlocal EnableExtensions
title WMS 38 Lokal
cd /d "%~dp0"
echo.
echo  WMS 38 Lokal sedang dimulai...
echo.
if not exist "runtime\node.exe" (
  echo  File runtime\node.exe tidak ditemukan.
  echo  Ekstrak seluruh ZIP terlebih dahulu, lalu jalankan file ini dari folder hasil ekstrak.
  echo.
  pause
  exit /b 1
)
"%~dp0runtime\node.exe" "%~dp0server.mjs"
set "WMS_EXIT=%ERRORLEVEL%"
echo.
if not "%WMS_EXIT%"=="0" echo  WMS berhenti dengan kode %WMS_EXIT%. Baca pesan di atas.
echo  Jendela ini boleh ditutup jika WMS tidak sedang dipakai.
pause
