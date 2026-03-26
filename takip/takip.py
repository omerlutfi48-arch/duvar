"""
DUVAR — Yarışma & Etkinlik Takip Scripti
Mimarlık sitelerini tarar, yeni içerik bulunca e-posta atar.
"""

import feedparser
import smtplib
import json
import os
import sys
import ssl
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime


def load_env(env_file):
    """Basit .env dosyası okuyucu — python-dotenv gerekmez."""
    if not os.path.exists(env_file):
        return
    with open(env_file, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, _, val = line.partition('=')
            os.environ.setdefault(key.strip(), val.strip())


# .env dosyasını yükle (varsa)
load_env(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'))

# SSL doğrulamasını devre dışı bırak (bazı siteler için gerekli)
ssl._create_default_https_context = ssl._create_unverified_context

# ── DOSYA YOLLARI ──
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(SCRIPT_DIR, 'config.json')
GORULDU_FILE = os.path.join(SCRIPT_DIR, 'goruldu.json')
LOG_FILE = os.path.join(SCRIPT_DIR, 'log.txt')


def log(mesaj):
    zaman = datetime.now().strftime('%Y-%m-%d %H:%M')
    satir = f"[{zaman}] {mesaj}"
    try:
        print(satir)
    except UnicodeEncodeError:
        print(satir.encode('ascii', errors='replace').decode('ascii'))
    with open(LOG_FILE, 'a', encoding='utf-8') as f:
        f.write(satir + '\n')


def config_oku():
    if not os.path.exists(CONFIG_FILE):
        log("HATA: config.json bulunamadı. Önce config.json dosyasını düzenle.")
        sys.exit(1)
    with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)


def goruldu_oku():
    if not os.path.exists(GORULDU_FILE):
        return set()
    with open(GORULDU_FILE, 'r', encoding='utf-8') as f:
        return set(json.load(f))


def goruldu_kaydet(goruldu):
    # En fazla 2000 kayıt tut (bellek şişmesin)
    liste = list(goruldu)[-2000:]
    with open(GORULDU_FILE, 'w', encoding='utf-8') as f:
        json.dump(liste, f, ensure_ascii=False)


def anahtar_kelime_kontrol(baslik, ozet, anahtar_kelimeler):
    metin = (baslik + ' ' + ozet).lower()
    for k in anahtar_kelimeler:
        if k.lower() in metin:
            return k
    return None


def feedleri_tara(config, goruldu):
    """Tüm RSS beslemelerini tara, yeni ve ilgili içerikleri döndür."""
    yeni_icerikler = []
    anahtar_kelimeler = config['anahtar_kelimeler']

    for feed_bilgi in config['feeds']:
        isim = feed_bilgi['isim']
        url = feed_bilgi['url']
        log(f"Tarıyor: {isim} ({url})")

        try:
            feed = feedparser.parse(url, request_headers={'User-Agent': 'Mozilla/5.0'})

            if feed.bozo and not feed.entries:
                log(f"  ⚠ {isim}: Feed okunamadı veya boş")
                continue

            log(f"  → {len(feed.entries)} içerik bulundu")

            for entry in feed.entries:
                entry_id = getattr(entry, 'id', None) or getattr(entry, 'link', '')
                if not entry_id:
                    continue

                # Daha önce görüldüyse atla
                if entry_id in goruldu:
                    continue

                baslik = getattr(entry, 'title', '')
                ozet = getattr(entry, 'summary', '') or getattr(entry, 'description', '')
                link = getattr(entry, 'link', '')

                # Anahtar kelime kontrolü
                eslesen = anahtar_kelime_kontrol(baslik, ozet, anahtar_kelimeler)
                if eslesen:
                    yeni_icerikler.append({
                        'id': entry_id,
                        'kaynak': isim,
                        'baslik': baslik,
                        'ozet': ozet[:300] + ('...' if len(ozet) > 300 else ''),
                        'link': link,
                        'eslesen_kelime': eslesen,
                        'tarih': getattr(entry, 'published', 'bilinmiyor')
                    })
                    log(f"  ✓ YENİ: {baslik[:60]} [{eslesen}]")

                goruldu.add(entry_id)

        except Exception as e:
            log(f"  ✗ {isim}: Hata — {e}")

    return yeni_icerikler, goruldu


IS_ILANI_KELIMELERI = {
    "iş ilanı", "is ilani", "staj ilanı", "staj ilani", "stajyer",
    "intern", "internship", "mimar aranıyor", "mimar araniyor",
    "kariyer", "pozisyon", "başvuru", "hiring", "job opening",
    "full time", "part time", "tam zamanlı", "yarı zamanlı"
}

def kategori_belirle(eslesen_kelime):
    if eslesen_kelime.lower() in IS_ILANI_KELIMELERI:
        return 'is'
    return 'etkinlik'

def email_gonder(config, icerikler):
    """Bulunan içerikleri e-posta ile gönder."""
    email_cfg = config['email']
    gonderen = email_cfg['gonderen']
    # Şifreyi önce çevre değişkeninden al, yoksa config.json'dan al
    sifre = os.environ.get('EMAIL_SIFRE') or email_cfg.get('sifre', '')
    alici = email_cfg['alici']

    if 'senin_gmail' in gonderen:
        log("HATA: config.json içinde e-posta bilgilerini doldurmadın!")
        return False

    tarih_str = datetime.now().strftime('%d %B %Y')
    sayi = len(icerikler)

    # İş ilanları ve etkinlikleri ayır
    is_ilanlari = [ic for ic in icerikler if kategori_belirle(ic['eslesen_kelime']) == 'is']
    etkinlikler = [ic for ic in icerikler if kategori_belirle(ic['eslesen_kelime']) == 'etkinlik']

    konu = f"[DUVAR] {sayi} yeni içerik — {tarih_str}"

    def kart_html(ic, i, renk):
        return f"""
        <div style="border-left:3px solid {renk};padding:12px 16px;margin-bottom:12px;background:#111;border-radius:2px">
          <div style="font-size:11px;color:#888;margin-bottom:6px;font-family:monospace">
            {ic['kaynak']} · eşleşen: <b style="color:{renk}">{ic['eslesen_kelime']}</b>
          </div>
          <div style="font-size:15px;font-weight:bold;color:#f0f0f0;margin-bottom:8px">
            {i:02d}. {ic['baslik']}
          </div>
          <div style="font-size:13px;color:#aaa;line-height:1.6;margin-bottom:10px">
            {ic['ozet']}
          </div>
          <a href="{ic['link']}" style="font-size:12px;color:{renk};font-family:monospace">→ kaynağa git</a>
        </div>"""

    html_satirlar = []

    if is_ilanlari:
        html_satirlar.append('<h2 style="font-family:monospace;font-size:13px;color:#4ade80;letter-spacing:2px;border-bottom:1px solid #1a1a1a;padding-bottom:8px;margin-top:24px">// İŞ & STAJ İLANLARI</h2>')
        for i, ic in enumerate(is_ilanlari, 1):
            html_satirlar.append(kart_html(ic, i, '#4ade80'))

    if etkinlikler:
        html_satirlar.append('<h2 style="font-family:monospace;font-size:13px;color:#f5c400;letter-spacing:2px;border-bottom:1px solid #1a1a1a;padding-bottom:8px;margin-top:24px">// YARIŞMA & ETKİNLİK</h2>')
        for i, ic in enumerate(etkinlikler, 1):
            html_satirlar.append(kart_html(ic, i, '#f5c400'))

    html_govde = f"""
    <html><body style="background:#0e0e0e;padding:24px;font-family:Inter,sans-serif">
      <div style="max-width:600px;margin:0 auto">
        <div style="font-family:monospace;font-size:11px;color:#555;margin-bottom:4px">// duvar · yarışma & etkinlik takip</div>
        <h1 style="font-size:28px;color:#fff;margin:0 0 4px;letter-spacing:2px">DUVAR TAKİP</h1>
        <div style="font-size:12px;color:#888;font-family:monospace;margin-bottom:24px;border-bottom:1px solid #222;padding-bottom:16px">
          {tarih_str} · {sayi} yeni içerik bulundu
        </div>
        {''.join(html_satirlar)}
        <div style="font-size:11px;color:#333;font-family:monospace;margin-top:24px;border-top:1px solid #1a1a1a;padding-top:16px">
          // bu mesaj takip.py tarafından otomatik gönderildi
        </div>
      </div>
    </body></html>
    """

    mesaj = MIMEMultipart('alternative')
    mesaj['Subject'] = konu
    mesaj['From'] = f"DUVAR Takip <{gonderen}>"
    mesaj['To'] = alici
    mesaj.attach(MIMEText(html_govde, 'html', 'utf-8'))

    try:
        with smtplib.SMTP_SSL('smtp.gmail.com', 465) as sunucu:
            sunucu.login(gonderen, sifre)
            sunucu.sendmail(gonderen, alici, mesaj.as_string())
        log(f"✓ E-posta gönderildi → {alici} ({sayi} içerik)")
        return True
    except smtplib.SMTPAuthenticationError:
        log("HATA: Gmail girişi başarısız. App Password kullandığından emin ol.")
        return False
    except Exception as e:
        log(f"HATA: E-posta gönderilemedi — {e}")
        return False


def main():
    log("=" * 50)
    log("DUVAR Takip başladı")

    config = config_oku()
    goruldu = goruldu_oku()
    log(f"Daha önce görülen içerik sayısı: {len(goruldu)}")

    yeni_icerikler, goruldu = feedleri_tara(config, goruldu)
    goruldu_kaydet(goruldu)

    if yeni_icerikler:
        log(f"Toplam {len(yeni_icerikler)} yeni içerik bulundu, e-posta gönderiliyor...")
        email_gonder(config, yeni_icerikler)
    else:
        log("Yeni içerik bulunamadı, e-posta gönderilmedi.")

    log("Takip tamamlandı")
    log("=" * 50)


if __name__ == '__main__':
    main()
