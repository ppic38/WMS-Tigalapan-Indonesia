@echo off
setlocal EnableExtensions
title Diagnosa WMS 38 Lokal
cd /d "%~dp0"
echo.
echo  DIAGNOSA WMS 38 LOKAL
echo  Folder: %CD%
echo.
if not exist "runtime\node.exe" (
  echo [GAGAL] runtime\node.exe tidak ada.
  echo Ekstrak ZIP seluruhnya terlebih dahulu.
  goto selesai
)
echo [OK] runtime\node.exe ditemukan.
"%~dp0runtime\node.exe" --version
if errorlevel 1 (
  echo [GAGAL] Windows tidak dapat menjalankan runtime WMS.
  echo Klik kanan ZIP lalu Extract All. Jika tetap gagal, kirim foto jendela ini.
  goto selesai
)
if not exist "server.mjs" (
  echo [GAGAL] server.mjs tidak ada. Ekstrak ulang ZIP.
  goto selesai
)
if not exist "app\worker.mjs" (
  echo [GAGAL] app\worker.mjs tidak ada. Ekstrak ulang ZIP.
  goto selesai
)
echo [OK] File WMS lengkap.
echo.
echo Menjalankan WMS. Browser akan terbuka bila berhasil.
echo Tutup jendela ini atau tekan Ctrl+C untuk berhenti.
"%~dp0runtime\node.exe" "%~dp0server.mjs"
:selesai
echo.
pause
