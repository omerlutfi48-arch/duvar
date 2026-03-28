// ── SUPABASE ──
const {createClient} = supabase;
const sb = createClient('https://tnxflwddhucvlejmoihj.supabase.co','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRueGZsd2RkaHVjdmxlam1vaWhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0NjU5OTcsImV4cCI6MjA5MDA0MTk5N30.XFwCgn8lseNGsYDzigmHKDIBBRqByJ9gOpaPRmkT4Vs');

// ── VERİ FONKSİYONLARI ──
async function getPosts() { const {data} = await sb.from('posts').select('*, yorumlar(*)').eq('aktif',true).order('created_at',{ascending:false}); return data||[]; }
async function getReports() { const {data} = await sb.from('raporlar').select('*').order('created_at',{ascending:false}); return data||[]; }
async function getFeedback() { const {data} = await sb.from('feedback').select('*').order('created_at',{ascending:false}); return data||[]; }
async function getIlanlar() { const {data} = await sb.from('ilanlar').select('*').order('created_at',{ascending:false}); return data||[]; }
async function getEtkinlikler() { const {data} = await sb.from('etkinlikler').select('*').order('created_at',{ascending:false}); return data||[]; }
async function getBanned() { const {data} = await sb.from('kullanicilar').select('nick').eq('banli',true); return (data||[]).map(u=>u.nick); }
async function getUsers() { const {data}=await sb.from('kullanicilar').select('*').order('created_at',{ascending:false}); return data||[]; }

// ── AUTH (Supabase Email) ──
let isAdmin = false;

async function adminLogin() {
  const email = (document.getElementById('adminEmail')?.value || '').trim();
  const pass = document.getElementById('adminPass').value;
  const err = document.getElementById('loginErr');
  if (!email) { err.textContent = '// e-posta boş'; return; }
  if (!pass) { err.textContent = '// şifre boş'; return; }
  err.textContent = '// giriş yapılıyor...';
  try {
    const {data, error} = await sb.auth.signInWithPassword({email, password: pass});
    if (error) {
      err.textContent = '// ' + (error.message === 'Invalid login credentials' ? 'e-posta veya şifre yanlış' : error.message);
      document.getElementById('adminPass').value = '';
      return;
    }
    if (data.user.email !== ADMIN_EMAIL) {
      await sb.auth.signOut();
      err.textContent = '// bu hesabın admin yetkisi yok';
      return;
    }
    isAdmin = true;
    document.getElementById('loginScreen').classList.add('hidden');
    initPanel();
  } catch(e) {
    err.textContent = '// bağlantı hatası: ' + e.message;
  }
}

async function adminLogout() {
  await sb.auth.signOut();
  location.reload();
}

document.getElementById('adminPass').addEventListener('keydown', e => {
  if (e.key === 'Enter') adminLogin();
});

// ── AKTİVİTE GRAFİĞİ ──
async function renderActivityChart(){
  const now = new Date();
  const since = new Date(now);
  since.setDate(since.getDate() - 6);
  since.setHours(0, 0, 0, 0);

  const { data } = await sb.from('page_views')
    .select('created_at')
    .gte('created_at', since.toISOString());

  // UTC → local tarih anahtarıyla say
  const dayMap = {};
  (data || []).forEach(row => {
    const d = new Date(row.created_at);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    dayMap[key] = (dayMap[key] || 0) + 1;
  });

  const labels = [], counts = [];
  for(let i = 6; i >= 0; i--){
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    labels.push(d.toLocaleDateString('tr-TR', {weekday:'short'}));
    counts.push(dayMap[key] || 0);
  }

  const max = Math.max(...counts, 1);
  const el = document.getElementById('activityChart');
  el.innerHTML = counts.map((c, i) => `
    <div class="chart-col">
      <div class="chart-val">${c}</div>
      <div class="chart-bar" style="height:${Math.max(Math.round(c/max*70), c > 0 ? 8 : 2)}px${c === 0 ? ';opacity:0.3' : ''}" title="${labels[i]}: ${c} ziyaret"></div>
      <div class="chart-day">${labels[i]}</div>
    </div>`).join('');
}

// ── INIT ──
async function initPanel() {
  autoCleanIfNeeded(); // 7 günde bir page_views temizle (arka planda)
  await updateStats();
  renderActivityChart();
  renderTagAnalytics();
  renderReports();
  renderPosts();
  renderUsers();
  renderFeedback();
  renderIlanlarAdmin();
  renderEtkinlikAdmin();
  document.getElementById('adminMeta').textContent = `// giriş yapıldı · ${new Date().toLocaleString('tr-TR')}`;
  // Her 60 sn aktif kullanıcı güncelle
  setInterval(async()=>{
    const n = await getActiveUsers();
    document.getElementById('statActive').textContent = n;
  }, 60000);
}

const ADMIN_EMAIL = 'omerlutfi48@gmail.com';

// Oturum kontrolü — sadece admin e-postası kabul edilir
(async () => {
  const {data:{session}} = await sb.auth.getSession();
  if (session && session.user.email === ADMIN_EMAIL) {
    isAdmin = true;
    document.getElementById('loginScreen').classList.add('hidden');
    initPanel();
  } else if (session) {
    await sb.auth.signOut(); // mod oturumunu temizle
  }
})();

async function getActiveUsers() {
  const since = new Date(Date.now() - 30*60*1000).toISOString();
  const {count} = await sb.from('page_views').select('id',{count:'exact',head:true}).gte('created_at',since);
  return count || 0;
}

async function renderTagAnalytics() {
  const posts = await getPosts();
  const tagCounts = {};
  posts.forEach(p => {
    const tags = (p.text.match(/#([\wçğışöüÇĞİŞÖÜ]+)/gi) || []).map(t => t.toLowerCase());
    tags.forEach(t => { tagCounts[t] = (tagCounts[t]||0) + 1; });
  });
  const sorted = Object.entries(tagCounts).sort((a,b) => b[1]-a[1]).slice(0,15);
  const el = document.getElementById('tagAnalytics');
  if (!sorted.length) { el.innerHTML = '<div class="empty-msg">// henüz tag kullanılmamış</div>'; return; }
  const max = sorted[0][1];
  el.innerHTML = sorted.map(([tag, count]) => `
    <div style="display:flex;align-items:center;gap:.8rem;margin-bottom:.55rem">
      <span style="font-family:'Space Mono',monospace;font-size:.7rem;color:#f5c400;width:130px;flex-shrink:0;overflow:hidden;text-overflow:ellipsis">${esc(tag)}</span>
      <div style="flex:1;height:6px;background:#1a1a1a;border-radius:2px">
        <div style="height:100%;width:${Math.round(count/max*100)}%;background:#8b1a1a;border-radius:2px;transition:width .4s"></div>
      </div>
      <span style="font-family:'Space Mono',monospace;font-size:.65rem;color:#555;width:28px;text-align:right">${count}</span>
    </div>`).join('');
}

async function updateStats() {
  const [posts, reports, feedback, banned, users,
         yorumlarRes, mesajlarRes, begeniRes, activeUsers] = await Promise.all([
    getPosts(), getReports(), getFeedback(), getBanned(), getUsers(),
    sb.from('yorumlar').select('id',{count:'exact',head:true}),
    sb.from('mesajlar').select('id',{count:'exact',head:true}),
    sb.from('begeni').select('id',{count:'exact',head:true}),
    getActiveUsers()
  ]);
  const pending = reports.length;
  const acil = posts.filter(p => p.type === 'acil').length;
  const feedbackPending = feedback.filter(f => !f.okundu).length;

  document.getElementById('statPosts').textContent = posts.length;
  document.getElementById('statUsers').textContent = users.length;
  document.getElementById('statReports').textContent = pending;
  document.getElementById('statBanned').textContent = banned.length;
  document.getElementById('statAcil').textContent = acil;
  document.getElementById('reportBadge').textContent = pending;
  document.getElementById('statFeedback').textContent = feedback.length;
  document.getElementById('feedbackBadge').textContent = feedbackPending;
  document.getElementById('statYorumlar').textContent = yorumlarRes.count ?? '—';
  document.getElementById('statMesajlar').textContent = mesajlarRes.count ?? '—';
  document.getElementById('statBegeni').textContent = begeniRes.count ?? '—';
  document.getElementById('statActive').textContent = activeUsers;
}

async function cleanOldDMs() {
  const cutoff = new Date(Date.now() - 90*24*60*60*1000).toISOString();
  const {count,error} = await sb.from('mesajlar').delete({count:'exact'}).lt('created_at',cutoff);
  const el = document.getElementById('cleanResult');
  if(error){el.textContent='// hata: '+error.message;el.style.color='#c0392b';}
  else{el.textContent=`// ${count??0} eski DM silindi`;el.style.color='#4caf50';}
  await updateStats();
}

async function cleanOldFeedback() {
  const {count,error} = await sb.from('feedback').delete({count:'exact'}).eq('okundu',true);
  const el = document.getElementById('cleanResult');
  if(error){el.textContent='// hata: '+error.message;el.style.color='#c0392b';}
  else{el.textContent=`// ${count??0} çözülmüş bildirim silindi`;el.style.color='#4caf50';}
  await updateStats();
}

async function cleanPageViews(auto=false) {
  const cutoff = new Date(Date.now() - 30*24*60*60*1000).toISOString();
  const {count,error} = await sb.from('page_views').delete({count:'exact'}).lt('created_at',cutoff);
  localStorage.setItem('duvar_pv_cleanup', Date.now().toString());
  if(!auto){
    const el = document.getElementById('cleanResult');
    if(error){el.textContent='// hata: '+error.message;el.style.color='#c0392b';}
    else{el.textContent=`// ${count??0} eski ziyaret kaydı silindi`;el.style.color='#4caf50';}
    await updateStats();
  }
}

async function autoCleanIfNeeded() {
  const last = parseInt(localStorage.getItem('duvar_pv_cleanup')||'0');
  const yediGun = 7*24*60*60*1000;
  if(Date.now() - last > yediGun){
    await cleanPageViews(true);
  }
}

// ── TABS ──
function switchTab(tab) {
  ['reports','posts','users','feedback','ilanlar','etkinlik'].forEach(t => {
    document.getElementById('section-' + t).classList.toggle('active', t === tab);
    document.getElementById('tab-' + t).classList.toggle('active', t === tab);
  });
}

// ── REPORTS ──
async function renderReports() {
  const [reports, allPosts] = await Promise.all([getReports(), getPosts()]);
  const el = document.getElementById('reportsList');

  if (!reports.length) {
    el.innerHTML = '<div class="empty-msg">// şikayet yok</div>';
    return;
  }

  const reasonLabels = { hakaret: 'hakaret / aşağılama', tehdit: 'tehdit / taciz', kisisel_veri: 'kişisel bilgi ifşası', zarar: 'zarar verici içerik', diger: 'diğer' };

  el.innerHTML = reports.map((r) => {
    const post = allPosts.find(p => p.id === r.post_id);
    const preview = post ? post.text.slice(0, 120) + (post.text.length > 120 ? '...' : '') : '[gönderi silinmiş]';
    return `
    <div class="report-card">
      <div class="report-reason">⚑ ${esc(reasonLabels[r.sebep] || r.sebep || '?')}</div>
      <div class="report-meta">bildiren: @${esc(r.bildiren || '?')} · ${new Date(r.created_at).toLocaleString('tr-TR')}</div>
      <div class="report-post-preview">"${esc(preview)}"</div>
      <div class="item-actions">
        <button class="action-btn warn" onclick="resolveReport(${r.id})">✓ çözüldü / sil</button>
        ${post ? `<button class="action-btn danger" onclick="confirmDeletePost(${r.post_id})">gönderiyi sil</button>` : ''}
        ${post ? `<button class="action-btn danger" onclick="confirmBan('${post.author}')">@${esc(post?.author||'?')} banla</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

async function resolveReport(id) {
  await sb.from('raporlar').delete().eq('id', id);
  await updateStats();
  renderReports();
  toast('// şikayet silindi');
}

// ── POSTS ──
async function renderPosts() {
  const [posts, banned] = await Promise.all([getPosts(), getBanned()]);
  const q = (document.getElementById('postSearch')?.value || '').toLowerCase();
  const el = document.getElementById('postsList');

  const filtered = posts.filter(p =>
    !q || p.text.toLowerCase().includes(q) || p.author.toLowerCase().includes(q)
  );

  if (!filtered.length) {
    el.innerHTML = '<div class="empty-msg">// gönderi yok</div>';
    return;
  }

  const typeLabels = { dert:'// dert', soru:'? soru', kaynak:'↗ kaynak', acil:'! acil' };
  const moodLabels = { yorgun:'😮‍💨 yorgunum', yardim:'🆘 yardım lazım', iyi:'✓ iyiyim', tesekkur:'♡ teşekkür' };

  el.innerHTML = filtered.map(p => {
    const isBanned = banned.includes(p.author);
    return `
    <div class="item-card ${p.pinned ? 'pinned' : ''} ${isBanned ? 'banned' : ''} ${p.type === 'acil' ? 'flagged' : ''}">
      <div>
        <div class="item-meta">
          <span class="author">@${esc(p.author)}</span>
          <span class="time">${new Date(p.created_at).toLocaleString('tr-TR')}</span>
          ${p.type ? `<span class="type-badge">${typeLabels[p.type]||p.type}</span>` : ''}
          ${p.mood ? `<span class="type-badge">${moodLabels[p.mood]||p.mood}</span>` : ''}
          ${p.pinned ? '<span style="color:#4ade80;border:1px solid #1a3a1a;padding:0.1rem 0.4rem">📌 sabitlendi</span>' : ''}
        </div>
        <div class="item-text">${esc(p.text)}</div>
        <div class="item-actions">
          <button class="action-btn success" onclick="togglePin(${p.id},${p.pinned})">${p.pinned ? '📌 sabiti kaldır' : '📌 sabitle'}</button>
          <button class="action-btn danger" onclick="confirmDeletePost(${p.id})">🗑 sil</button>
          <button class="action-btn danger" onclick="confirmBan('${p.author}')">🚫 @${esc(p.author)} banla</button>
        </div>
      </div>
      <div class="item-right">
        <div style="font-family:Space Mono,monospace;font-size:0.58rem;color:#333">↳ ${p.yorumlar?.length||0} yorum</div>
        <div style="font-family:Space Mono,monospace;font-size:0.58rem;color:#333">⚡ ${p.fire||0}</div>
      </div>
    </div>`;
  }).join('');
}

async function togglePin(id, currentPinned) {
  await sb.from('posts').update({ pinned: !currentPinned }).eq('id', id);
  renderPosts();
  toast(!currentPinned ? '// gönderi sabitlendi' : '// sabit kaldırıldı');
}

// ── USERS ──
async function renderUsers() {
  const [users, posts] = await Promise.all([getUsers(), getPosts()]);
  const q = (document.getElementById('userSearch')?.value || '').toLowerCase();
  const el = document.getElementById('usersList');

  const filtered = users.filter(u => !q || u.nick.toLowerCase().includes(q));

  if (!filtered.length) {
    el.innerHTML = '<div class="empty-msg">// kullanıcı yok</div>';
    return;
  }

  el.innerHTML = filtered.map(u => {
    const nick = u.nick;
    const isBanned = u.banli;
    const isMod = u.mod;
    const postCount = posts.filter(p => p.author === nick).length;
    return `
    <div class="user-card ${isBanned ? 'banned-user' : ''}">
      <div>
        <div class="user-nick-display">${esc(nick)}</div>
        <div class="user-stats-row">
          <span>${postCount} gönderi</span>
          ${isBanned ? '<span style="color:var(--red)">🚫 banlı</span>' : ''}
          ${isMod ? '<span style="color:var(--yellow)">⚡ mod</span>' : ''}
        </div>
      </div>
      <div class="item-actions">
        <button class="action-btn ${isMod ? 'warning' : 'secondary'}" onclick="toggleMod('${nick}',${isMod})">
          ${isMod ? '⚡ mod al' : '⚡ mod ver'}
        </button>
        <button class="action-btn ${isBanned ? 'success' : 'danger'}" onclick="toggleBan('${nick}',${isBanned})">
          ${isBanned ? '✓ banı kaldır' : '🚫 banla'}
        </button>
        <button class="action-btn danger" onclick="confirmDeleteUser('${nick}')">🗑 hesabı sil</button>
      </div>
    </div>`;
  }).join('');
}

// ── ACTIONS ──
function confirmDeletePost(id) {
  openConfirm('GÖNDERİYİ SİL', '// bu gönderi kalıcı olarak silinecek. geri alınamaz.', () => deletePost(id));
}

async function confirmBan(nick) {
  const banned = await getBanned();
  if (banned.includes(nick)) { toggleBan(nick, true); return; }
  openConfirm(`@${nick.toUpperCase()} BANLA`, `// bu kullanıcı platforma erişemeyecek.`, () => toggleBan(nick, false));
}

async function deletePost(id) {
  await sb.from('posts').delete().eq('id', id);
  await updateStats();
  renderPosts();
  renderReports();
  toast('// gönderi silindi');
}

async function toggleMod(nick, isMod) {
  await sb.from('kullanicilar').update({mod: !isMod}).eq('nick', nick);
  toast(isMod ? `// @${nick} mod yetkisi alındı` : `// @${nick} mod yetkisi verildi`);
  renderUsers();
}

async function toggleBan(nick, isBanned) {
  if (isBanned) {
    await sb.from('kullanicilar').update({banli: false}).eq('nick', nick);
    toast(`// @${nick} ban kaldırıldı`);
  } else {
    await sb.from('kullanicilar').update({banli: true}).eq('nick', nick);
    toast(`// @${nick} banlı`);
  }
  await updateStats();
  renderUsers();
  renderPosts();
}

function confirmDeleteUser(nick) {
  openConfirm(
    `@${nick.toUpperCase()} HESABI SİL`,
    `// @${nick} kullanıcısının TÜM gönderileri, yorumları ve hesabı kalıcı olarak silinecek. Bu işlem geri alınamaz.`,
    () => deleteUser(nick)
  );
}

async function deleteUser(nick) {
  // Auth id'yi önceden al
  const {data:userRow}=await sb.from('kullanicilar').select('auth_id').eq('nick',nick).maybeSingle();
  // Tüm gönderilerini, yorumlarını, mesajlarını, beğenilerini ve hesabı sil
  await Promise.all([
    sb.from('posts').delete().eq('author', nick),
    sb.from('yorumlar').delete().eq('nick', nick),
    sb.from('mesajlar').delete().or(`gonderen.eq.${nick},alici.eq.${nick}`),
    sb.from('begeni').delete().eq('nick', nick),
    sb.from('anket_oylar').delete().eq('nick', nick),
  ]);
  const {error} = await sb.from('kullanicilar').delete().eq('nick', nick);
  if(error){
    console.error('deleteUser hatası:', error);
    toast(`// HATA: ${error.message}`);
    return;
  }
  // Supabase Auth kaydını da sil (nick tekrar alınabilsin)
  const {data:{session}}=await sb.auth.getSession();
  if(session){
    const res=await fetch('https://tnxflwddhucvlejmoihj.supabase.co/functions/v1/delete-user',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${session.access_token}`},
      body:JSON.stringify({auth_id:userRow?.auth_id||null, nick})
    }).catch(()=>null);
    if(!res?.ok){
      console.error('Auth kaydı silinemedi:', nick, res?.status);
      toast(`// UYARI: @${nick} verileri silindi ama auth kaydı silinemedi`);
    }
  }
  await updateStats();
  await renderUsers();
  await renderPosts();
  toast(`// @${nick} hesabı ve tüm verileri silindi`);
}

// ── CONFIRM MODAL ──
let confirmCallback = null;
function openConfirm(title, msg, cb) {
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMsg').textContent = msg;
  confirmCallback = cb;
  document.getElementById('confirmModal').classList.remove('hidden');
}
function closeConfirm() {
  document.getElementById('confirmModal').classList.add('hidden');
  confirmCallback = null;
}
document.getElementById('confirmOk').onclick = () => {
  if (confirmCallback) confirmCallback();
  closeConfirm();
};

// ── FEEDBACK ──
async function renderFeedback() {
  const items = await getFeedback();
  const el = document.getElementById('feedbackList');
  if (!items.length) {
    el.innerHTML = '<div class="empty-msg">// henüz geri bildirim yok</div>';
    return;
  }
  const typeLabel = { oneri: '💡 öneri', sikayet: '⚑ şikayet' };
  el.innerHTML = items.map(f => {
    return `<div class="report-card ${f.okundu ? 'resolved' : ''}">
      <div class="report-reason">${typeLabel[f.tip] || f.tip}</div>
      <div class="report-meta">${new Date(f.created_at).toLocaleString('tr-TR')}</div>
      <div class="item-text" style="margin:0.5rem 0">${esc(f.mesaj)}</div>
      <div class="item-actions">
        ${!f.okundu ? `<button class="action-btn warn" onclick="markFeedbackRead(${f.id})">✓ okundu</button>` : '<span style="font-family:Space Mono,monospace;font-size:0.6rem;color:#333;letter-spacing:0.08em">// okundu</span>'}
        <button class="action-btn danger" onclick="deleteFeedback(${f.id})">🗑 sil</button>
      </div>
    </div>`;
  }).join('');
}
async function markFeedbackRead(id) {
  await sb.from('feedback').update({ okundu: true }).eq('id', id);
  await updateStats();
  renderFeedback();
  toast('// okundu işaretlendi');
}
// ── ETKİNLİKLER ──
async function etkinlikEkle() {
  const baslik = document.getElementById('etkinlikBaslik').value.trim();
  const yer = document.getElementById('etkinlikOrg').value.trim();
  const aciklama = document.getElementById('etkinlikAciklama').value.trim();
  const tarih = document.getElementById('etkinlikTarih').value;
  const tip = document.getElementById('etkinlikTip').value;
  const link = document.getElementById('etkinlikLink').value.trim();
  if (!baslik) { toast('// başlık zorunlu'); return; }
  const {error} = await sb.from('etkinlikler').insert({ baslik, yer, aciklama, tarih, tip, link });
  if (error) { toast('// hata: ' + error.message); return; }
  ['etkinlikBaslik','etkinlikOrg','etkinlikAciklama','etkinlikTarih','etkinlikLink'].forEach(id => document.getElementById(id) && (document.getElementById(id).value = ''));
  renderEtkinlikAdmin();
  toast('// etkinlik yayınlandı');
}
async function etkinlikSil(id) {
  await sb.from('etkinlikler').delete().eq('id', id);
  renderEtkinlikAdmin();
  toast('// etkinlik silindi');
}
async function etkinlikArsiv(id, aktif) {
  await sb.from('etkinlikler').update({ aktif: !aktif }).eq('id', id);
  renderEtkinlikAdmin();
  toast(!aktif ? '// yeniden yayınlandı' : '// arşivlendi');
}
async function renderEtkinlikAdmin() {
  const liste = await getEtkinlikler();
  const el = document.getElementById('etkinlikAdminList');
  if (!liste.length) { el.innerHTML = '<div class="empty-msg">// henüz etkinlik yok</div>'; return; }
  const tipLabel = { yarisma: 'yarışma', festival: 'festival', etkinlik: 'etkinlik', workshop: 'workshop', seminer: 'seminer' };
  el.innerHTML = liste.map(e => `
    <div class="item-card ${!e.aktif ? 'banned' : ''}">
      <div>
        <div class="item-meta">
          <span class="author">${esc(e.baslik)}</span>
          <span class="type-badge">${tipLabel[e.tip]||e.tip}</span>
          ${e.yer ? `<span>${esc(e.yer)}</span>` : ''}
          ${e.tarih ? `<span>📅 ${new Date(e.tarih).toLocaleDateString('tr-TR')}</span>` : ''}
          ${!e.aktif ? '<span style="color:#555">arşiv</span>' : ''}
        </div>
        <div class="item-text">${esc((e.aciklama||'').slice(0,120))}${(e.aciklama||'').length>120?'...':''}</div>
        ${e.link ? `<div style="font-family:Space Mono,monospace;font-size:0.62rem;color:#c084fc;margin-bottom:0.5rem">${esc(e.link)}</div>` : ''}
        <div class="item-actions">
          <button class="action-btn warn" onclick="etkinlikArsiv(${e.id},${e.aktif})">${!e.aktif ? '↺ yeniden yayınla' : '📦 arşivle'}</button>
          <button class="action-btn danger" onclick="etkinlikSil(${e.id})">🗑 sil</button>
        </div>
      </div>
    </div>`).join('');
}

// ── İLANLAR ──
async function ilanEkle() {
  const sirket = document.getElementById('ilanOfis').value.trim();
  const baslik = document.getElementById('ilanBaslik').value.trim();
  const aciklama = document.getElementById('ilanAciklama').value.trim();
  const sehir = document.getElementById('ilanSehir').value.trim();
  const tip = document.getElementById('ilanTip').value;
  const link = document.getElementById('ilanIletisim').value.trim();
  if (!sirket || !baslik) { toast('// ofis adı ve başlık zorunlu'); return; }
  const {error} = await sb.from('ilanlar').insert({ sirket, baslik, aciklama, sehir, tip, link });
  if (error) { toast('// hata: ' + error.message); return; }
  ['ilanOfis','ilanBaslik','ilanAciklama','ilanSehir','ilanIletisim'].forEach(id => document.getElementById(id) && (document.getElementById(id).value = ''));
  renderIlanlarAdmin();
  toast('// ilan yayınlandı');
}
async function ilanSil(id) {
  await sb.from('ilanlar').delete().eq('id', id);
  renderIlanlarAdmin();
  toast('// ilan silindi');
}
async function ilanArsiv(id, aktif) {
  await sb.from('ilanlar').update({ aktif: !aktif }).eq('id', id);
  renderIlanlarAdmin();
  toast(!aktif ? '// ilan yeniden yayınlandı' : '// ilan arşivlendi');
}
async function renderIlanlarAdmin() {
  const ilanlar = await getIlanlar();
  const el = document.getElementById('ilanlarAdminList');
  if (!ilanlar.length) { el.innerHTML = '<div class="empty-msg">// henüz ilan yok</div>'; return; }
  const tipLabel = { staj: 'staj', tam: 'tam zamanlı', yari: 'yarı zamanlı', is: 'iş ilanı' };
  el.innerHTML = ilanlar.map(il => `
    <div class="item-card ${!il.aktif ? 'banned' : ''}">
      <div>
        <div class="item-meta">
          <span class="author">${esc(il.sirket||il.ofis||'')}</span>
          <span class="type-badge">${tipLabel[il.tip]||il.tip}</span>
          ${il.sehir ? `<span>${esc(il.sehir)}</span>` : ''}
          ${!il.aktif ? '<span style="color:#555">arşiv</span>' : ''}
        </div>
        <div class="item-text">${esc(il.baslik)} — ${esc((il.aciklama||'').slice(0,100))}${(il.aciklama||'').length>100?'...':''}</div>
        ${il.link ? `<div style="font-family:Space Mono,monospace;font-size:0.62rem;color:var(--yellow);margin-bottom:0.5rem">${esc(il.link)}</div>` : ''}
        <div class="item-actions">
          <button class="action-btn warn" onclick="ilanArsiv(${il.id},${il.aktif})">${!il.aktif ? '↺ yeniden yayınla' : '📦 arşivle'}</button>
          <button class="action-btn danger" onclick="ilanSil(${il.id})">🗑 sil</button>
        </div>
      </div>
    </div>`).join('');
}

async function deleteFeedback(id) {
  await sb.from('feedback').delete().eq('id', id);
  await updateStats();
  renderFeedback();
  toast('// geri bildirim silindi');
}

// ── UTILS → utils.js tarafından sağlanır ──
