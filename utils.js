// ── DUVAR UTILS ──
// Ortak yardımcı fonksiyonlar — index.html ve admin.html tarafından paylaşılır

// HTML kaçış: metin ve tırnaklı attribute bağlamında güvenli.
// Not: inline onclick="f('${esc(x)}')" içinde güvenli DEĞİLDİR (tarayıcı &#39;'yi JS'ten önce ' yapar);
// kullanıcı verisini handler'a data-* attribute ile verin.
const esc = t => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Kullanıcı medyası (avatar, gönderi görseli, dosya) sadece sitenin Cloudinary hesabından gelebilir.
// Başka adres (izleme pikseli, oltalama linki) basılmaz.
const MEDIA_PREFIX = 'https://res.cloudinary.com/dxsvzlv1m/';
function safeMediaUrl(u) {
  const s = String(u ?? '').trim();
  return s.startsWith(MEDIA_PREFIX) ? esc(s) : '';
}

// PostgREST .or() filtresine değer koyarken: çift tırnak içine al, \ ve " kaçır
// (virgül/parantez içeren bir değer filtreyi genişletemesin).
function pgVal(v) {
  return '"' + String(v ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

// URL'yi src/href'e koymadan önce: sadece http(s) şemasına izin ver, değilse boş döner.
function safeUrl(u) {
  const s = String(u ?? '').trim();
  return /^https?:\/\//i.test(s) ? esc(s) : '';
}

function toast(msg, dur = 2400, html = false) {
  const t = document.getElementById('toast');
  if (!t) return;
  // Hata mesajları dış kaynaklı olabilir: varsayılan düz metin; HTML sadece açıkça istenirse.
  if (html) t.innerHTML = msg; else t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), dur);
}

// E-posta adresini açık metin olarak JS'te tutmamak için SHA-256 karşılaştırması.
// Not: bu sadece kişisel adresi gizler; asıl yetki kontrolü sunucuda (RLS / edge function) olmalı.
const ADMIN_EMAIL_HASHES = ['72cb38c5f992a10da19d9de490b9ccf9d5171a9d28afc0ff2c3ece34e79e0697'];
async function sha256Hex(text) {
  if (!globalThis.crypto?.subtle) return ''; // güvenli olmayan (http) ortamda yetki verme
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text || '').trim().toLowerCase()));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function isAdminEmail(email) {
  return ADMIN_EMAIL_HASHES.includes(await sha256Hex(email));
}
