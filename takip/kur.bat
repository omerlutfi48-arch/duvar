@echo off
echo DUVAR Takip - Kurulum
echo =====================

echo [1/2] Gerekli paket kuruluyor: feedparser
pip install feedparser

echo.
echo [2/2] Baslangic klasorune ekleniyor...

set STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set SCRIPT=%~dp0takip.py

rem Tam python yolunu bul
for /f "tokens=*" %%i in ('where python') do set PYTHON=%%i

if "%PYTHON%"=="" (
    echo HATA: Python bulunamadi. Python yuklu mu?
    pause
    exit /b 1
)

rem VBScript ile gizli pencerede calistir (CMD penceresi acilmaz)
echo Set objShell = CreateObject("WScript.Shell") > "%STARTUP%\duvar_takip.vbs"
echo objShell.Run """%PYTHON%"" ""%SCRIPT%""", 0, False >> "%STARTUP%\duvar_takip.vbs"

echo.
echo Kurulum tamamlandi!
echo Python: %PYTHON%
echo Script: %SCRIPT%
echo Startup: %STARTUP%\duvar_takip.vbs
echo.
echo Bilgisayara her giris yaptiginda otomatik calisacak.
echo Daha once gonderilmis icerikler tekrar gonderilmez (goruldu.json).
echo CMD penceresi acilmaz, arka planda calisir.
echo.
echo Log dosyasi: %~dp0log.txt
echo.
echo Hemen test etmek icin: python "%SCRIPT%"
echo.
pause
