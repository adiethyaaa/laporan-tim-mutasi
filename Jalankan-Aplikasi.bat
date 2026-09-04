@echo off
title Menjalankan Aplikasi Laporan Tim Mutasi (Vite)
echo ========================================================
echo   Sedang menyalakan server lokal Vite...
echo   Browser akan terbuka secara otomatis di http://localhost:3000
echo ========================================================
echo.
cd /d "%~dp0"
call npm run dev
pause
