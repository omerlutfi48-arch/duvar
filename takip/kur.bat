@echo off
setlocal enabledelayedexpansion
echo DUVAR Takip - Kurulum
echo =====================

echo [1/3] Gerekli paket kuruluyor: feedparser
pip install feedparser

echo.
echo [2/3] Python yolu bulunuyor...

rem sys.executable ile gercek Python yolunu al (Microsoft Store stub'ı atla)
for /f "delims=" %%i in ('py -3 -c "import sys; print(sys.executable)" 2^>nul') do set PYTHON=%%i
if "!PYTHON!"=="" (
    for /f "delims=" %%i in ('python -c "import sys; print(sys.executable)" 2^>nul') do set PYTHON=%%i
)

if "!PYTHON!"=="" (
    echo HATA: Python bulunamadi. Python yuklu mu?
    pause
    exit /b 1
)

rem python.exe -> pythonw.exe (konsol penceresi acmaz)
set PYTHONW=!PYTHON:python.exe=pythonw.exe!
if not exist "!PYTHONW!" set PYTHONW=!PYTHON!

echo Python: !PYTHONW!

echo.
echo [3/3] Baslangic klasorune ekleniyor...

set STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set SCRIPT=%~dp0takip.py

rem VBScript olustur - Chr(34) ile guvenli tirnak kullanimi
(
    echo Set objShell = CreateObject^("WScript.Shell"^)
    echo objShell.Run Chr^(34^) ^& "!PYTHONW!" ^& Chr^(34^) ^& " " ^& Chr^(34^) ^& "!SCRIPT!" ^& Chr^(34^), 0, False
) > "%STARTUP%\duvar_takip.vbs"

echo.
echo === OLUSTURULAN VBS ICERIGI ===
type "%STARTUP%\duvar_takip.vbs"
echo ================================
echo.
echo Kurulum tamamlandi!
echo Startup: %STARTUP%\duvar_takip.vbs
echo Log: %~dp0log.txt
echo.
echo Bilgisayara her giris yaptiginda otomatik calisacak.
echo Daha once gonderilmis icerikler tekrar gonderilmez (goruldu.json).
echo.
echo Hemen test etmek icin:
echo   python "%SCRIPT%"
echo.
pause
