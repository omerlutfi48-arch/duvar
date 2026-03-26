@echo off
echo DUVAR Takip - Kurulum
echo =====================

echo [1/2] Gerekli paket kuruluyor: feedparser
pip install feedparser

echo.
echo [2/2] Windows Gorev Zamanlayici'ya ekleniyor...
echo Her sabah 09:00'da otomatik calisacak.

schtasks /create /tn "DUVAR Takip" /tr "python \"%~dp0takip.py\"" /sc onlogon /f

echo.
echo Kurulum tamamlandi!
echo Bilgisayara her giris yaptiginda otomatik calisacak.
echo Daha once gonderilmis icerikler tekrar gonderilmez (goruldu.json).
echo.
echo SIMDI YAPMAN GEREKEN:
echo  1. config.json dosyasini ac
echo  2. gonderen ve alici e-posta adreslerini yaz
echo  3. Gmail App Password'u yaz (asagida nasil alirsın yazıyor)
echo.
echo Gmail App Password nasil alinir:
echo  → myaccount.google.com/apppasswords adresine git
echo  → "Uygulama sec" → "Diger" → "DUVAR Takip" yaz → Olustur
echo  → Gelen 16 haneli sifreyi config.json'daki "sifre" alanina yaz
echo.
echo Hemen test etmek icin:
echo  python takip.py
echo.
pause
