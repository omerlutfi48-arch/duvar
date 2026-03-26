// ── DUVAR UTILS ──
// Ortak yardımcı fonksiyonlar — index.html ve admin.html tarafından paylaşılır

const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function toast(msg, dur = 2400) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.innerHTML = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), dur);
}
