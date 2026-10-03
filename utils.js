// ── DUVAR UTILS ──
// Ortak yardımcı fonksiyonlar — index.html ve admin.html tarafından paylaşılır

// HTML kaçış: metin ve tırnaklı attribute bağlamında güvenli.
// Not: inline onclick="f('${esc(x)}')" içinde güvenli DEĞİLDİR (tarayıcı &#39;'yi JS'ten önce ' yapar);
// kullanıcı verisini handler'a data-* attribute ile verin.
const esc = t => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

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
