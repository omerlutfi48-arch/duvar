// ── SUPABASE ──
const {createClient}=supabase;
const sb=createClient('https://tnxflwddhucvlejmoihj.supabase.co','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRueGZsd2RkaHVjdmxlam1vaWhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0NjU5OTcsImV4cCI6MjA5MDA0MTk5N30.XFwCgn8lseNGsYDzigmHKDIBBRqByJ9gOpaPRmkT4Vs');

// ── WEB PUSH ──
const VAPID_PUBLIC_KEY='BAAjoBB1iDgAJNTOFh5V5o4K8nG06aSn55v3xxJz4HeAfGewcXFa-psingFnsHT2nI-G_brpC36k_awSsbVz9-8';

function urlBase64ToUint8Array(b64){
  const pad='='.repeat((4-b64.length%4)%4);
  const raw=atob((b64+pad).replace(/-/g,'+').replace(/_/g,'/'));
  return Uint8Array.from(raw,c=>c.charCodeAt(0));
}

async function subscribePush(){
  if(!('serviceWorker' in navigator)||!('PushManager' in window))return;
  try{
    const reg=await navigator.serviceWorker.ready;
    const perm=await Notification.requestPermission();
    if(perm!=='granted'){toast('// bildirim izni verilmedi');return;}
    const sub=await reg.pushManager.subscribe({
      userVisibleOnly:true,
      applicationServerKey:urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    });
    const k=sub.getKey('p256dh'),a=sub.getKey('auth');
    const p256dh=btoa(String.fromCharCode(...new Uint8Array(k)));
    const auth=btoa(String.fromCharCode(...new Uint8Array(a)));
    await sb.from('push_subscriptions').upsert(
      {nick:currentUser,endpoint:sub.endpoint,p256dh,auth},
      {onConflict:'endpoint'}
    );
    toast('// bildirimler açıldı ✓');
    localStorage.setItem('duvar_push_asked','1');
  }catch(e){console.warn('push sub err',e);}
}

async function unsubscribePush(){
  if(!('serviceWorker' in navigator))return;
  const reg=await navigator.serviceWorker.ready;
  const sub=await reg.pushManager.getSubscription();
  if(sub){
    await sb.from('push_subscriptions').delete().eq('endpoint',sub.endpoint);
    await sub.unsubscribe();
  }
  toast('// bildirimler kapatıldı');
}

async function togglePushBtn(){
  if(!('Notification' in window))return toast('// tarayıcın bildirim desteklemiyor');
  const reg=await navigator.serviceWorker.ready;
  const sub=await reg.pushManager.getSubscription();
  if(sub){await unsubscribePush();updatePushBtn();}
  else{await subscribePush();updatePushBtn();}
}

async function updatePushBtn(){
  const btn=document.getElementById('pushToggleBtn');
  if(!btn)return;
  if(!('Notification' in window)){btn.style.display='none';return;}
  const reg=await navigator.serviceWorker.ready;
  const sub=await reg.pushManager.getSubscription();
  const on=sub&&Notification.permission==='granted';
  btn.textContent=on?'🔕 bildirimleri kapat':'🔔 bildirimleri aç';
  btn.style.borderColor=on?'var(--yellow)':'';
  btn.style.color=on?'var(--yellow)':'';
}

async function checkPushStatus(){
  if(!('Notification' in window)||!currentUser)return;
  if(Notification.permission==='granted'||localStorage.getItem('duvar_push_asked'))return;
  // İlk girişten 10 sn sonra sor
  setTimeout(()=>{
    if(!currentUser)return;
    toast('// 🔔 bildirim almak ister misin? <a href="#" onclick="subscribePush();return false" style="color:var(--yellow)">aç</a>',5000);
  },10000);
}

// ── STORAGE ──
const NOTIFS_KEY='duvar_notifs_';
const getNotifs=u=>{try{return JSON.parse(localStorage.getItem(NOTIFS_KEY+u))||[];}catch{return[];}};
const saveNotifs=(u,n)=>localStorage.setItem(NOTIFS_KEY+u,JSON.stringify(n));
// nick → Supabase Auth email (ASCII-safe, deterministik)
function nickToEmail(nick){
  const s=nick.toLowerCase()
    .replace(/ç/g,'c').replace(/ğ/g,'g').replace(/ı/g,'i')
    .replace(/ö/g,'o').replace(/ş/g,'s').replace(/ü/g,'u');
  return s+'.u@duvar.app';
}

// ── MOD YETKİLİ E-POSTALAR ──
const MOD_EMAILS=['omerlutfi48@gmail.com'];

// ── SUPABASE VERİ FONKSİYONLARI ──
async function loadPosts(){
  const {data,error}=await sb.from('posts').select('*, yorumlar(*)').eq('aktif',true).order('created_at',{ascending:false}).limit(200);
  if(error){console.error('posts yüklenemedi:',error);return;}
  posts=(data||[]).map(p=>({
    ...p,time:p.created_at,fired:[],disfire:p.disfire||0,
    comments:(p.yorumlar||[]).map(c=>({nick:c.nick,text:c.text,id:c.id}))
  }));
  const postIds=posts.map(p=>p.id);
  if(currentUser){
    const [{data:likes},{data:dislikes},{data:allDislikes}]=await Promise.all([
      sb.from('begeni').select('post_id').eq('nick',currentUser),
      sb.from('begenmeme').select('post_id').eq('nick',currentUser),
      sb.from('begenmeme').select('post_id').in('post_id',postIds)
    ]);
    const likedSet=new Set((likes||[]).map(l=>l.post_id));
    dislikedPosts=new Set((dislikes||[]).map(l=>l.post_id));
    posts.forEach(p=>{if(likedSet.has(p.id))p.fired=[currentUser];});
    const dislikeCounts={};
    (allDislikes||[]).forEach(r=>{dislikeCounts[r.post_id]=(dislikeCounts[r.post_id]||0)+1;});
    posts.forEach(p=>{if(dislikeCounts[p.id])p.disfire=dislikeCounts[p.id];});
  } else {
    const {data:allDislikes}=await sb.from('begenmeme').select('post_id').in('post_id',postIds);
    const dislikeCounts={};
    (allDislikes||[]).forEach(r=>{dislikeCounts[r.post_id]=(dislikeCounts[r.post_id]||0)+1;});
    posts.forEach(p=>{if(dislikeCounts[p.id])p.disfire=dislikeCounts[p.id];});
  }
  // Anket oyları
  const pollPosts=posts.filter(p=>p.options?.length>=2);
  if(pollPosts.length){
    const ids=pollPosts.map(p=>p.id);
    const [{data:allVotes},{data:myVotes}]=await Promise.all([
      sb.from('anket_oylar').select('post_id,option_idx').in('post_id',ids),
      currentUser?sb.from('anket_oylar').select('post_id,option_idx').eq('nick',currentUser).in('post_id',ids):{data:[]}
    ]);
    const myVoteMap={};(myVotes||[]).forEach(v=>myVoteMap[v.post_id]=v.option_idx);
    posts.forEach(p=>{
      if(!p.options?.length)return;
      const cnts=new Array(p.options.length).fill(0);
      (allVotes||[]).filter(v=>v.post_id===p.id).forEach(v=>{if(v.option_idx<cnts.length)cnts[v.option_idx]++;});
      p.voteCounts=cnts;
      p.myVote=myVoteMap[p.id]??null;
    });
  }
  render();
}

async function sbAddPost(author,text,mood,type,options=null){
  const row={author,text,mood,type};
  if(options)row.options=options;
  const {data,error}=await sb.from('posts').insert(row).select().single();
  if(error){toast('// hata: gönderi kaydedilemedi');return null;}
  return data;
}

async function sbReact(id,nick){
  const liked=posts.find(p=>p.id===id)?.fired?.includes(nick);
  if(liked){await sb.rpc('geri_al_begen',{p_id:id,p_nick:nick});}
  else{await sb.rpc('artir_begen',{p_id:id,p_nick:nick});}
  await loadPosts();
}

async function sbDislike(id,nick){
  if(dislikedPosts.has(id)){await sb.rpc('geri_al_begenmeme',{p_id:id,p_nick:nick});}
  else{await sb.rpc('artir_begenmeme',{p_id:id,p_nick:nick});}
  await loadPosts();
}

async function sbComment(postId,nick,text){
  const {error}=await sb.from('yorumlar').insert({post_id:postId,nick,text});
  if(error){toast('// hata: yorum kaydedilemedi');return false;}
  await loadPosts();
  return true;
}

async function sbReport(postId,sebep,bildiren){
  const {error}=await sb.from('raporlar').insert({post_id:postId,sebep,bildiren});
  if(error)console.error('rapor hatası:',error);
  return !error;
}

async function sbFeedback(tip,mesaj){
  const {error}=await sb.from('feedback').insert({tip,mesaj});
  return !error;
}

// Realtime: yeni post, güncelleme, yorum gelince otomatik yükle
sb.channel('duvar-realtime')
  .on('postgres_changes',{event:'*',schema:'public',table:'posts'},()=>loadPosts())
  .on('postgres_changes',{event:'INSERT',schema:'public',table:'yorumlar'},()=>loadPosts())
  .on('postgres_changes',{event:'INSERT',schema:'public',table:'mesajlar'},()=>{
    loadDMDot();
    if(dmConversation)openConversation(dmConversation);
    else if(document.getElementById('dmPanel').classList.contains('open'))openDMs();
  })
  .subscribe();

// Yedek: realtime çalışmasa da 30 saniyede bir güncelle
setInterval(loadPosts, 30000);

// ── MODERATÖR ──
function openModLogin(){document.getElementById('modLoginModal').classList.remove('hidden');document.getElementById('modEmail').focus();}
function closeModLogin(){document.getElementById('modLoginModal').classList.add('hidden');document.getElementById('modErr').textContent='';}
async function modLogin(){
  const email=(document.getElementById('modEmail').value||'').trim();
  const pass=document.getElementById('modPass').value;
  const err=document.getElementById('modErr');
  if(!email||!pass){err.textContent='// boş alan var';return;}
  err.textContent='// giriş yapılıyor...';
  try{
    const {data,error}=await sb.auth.signInWithPassword({email,password:pass});
    if(error){err.textContent='// '+( error.message==='Invalid login credentials'?'e-posta veya şifre yanlış':error.message);return;}
    if(!MOD_EMAILS.includes(data.user.email)){
      await sb.auth.signOut();
      err.textContent='// bu hesabın moderatör yetkisi yok';
      return;
    }
    setModeratorMode(true);
    closeModLogin();
    document.getElementById('modPass').value='';
    toast('// mod modu aktif');
  }catch(e){err.textContent='// bağlantı hatası';}
}
async function modLogout(){
  await sb.auth.signOut();
  setModeratorMode(false);
  toast('// mod modundan çıkıldı');
}
function setModeratorMode(active){
  isModerator=active;
  document.getElementById('modBar').style.display=active?'block':'none';
  document.getElementById('modLogoutBtn').style.display=active?'':'none';
  document.getElementById('modLoginBtn').style.display=active?'none':'';
  render();
}
async function modDeletePost(id){
  if(!confirm('Bu gönderiyi silmek istediğine emin misin?'))return;
  await sb.from('posts').delete().eq('id',id);
  await loadPosts();
  toast('// gönderi silindi');
}
async function modPin(id,pinned){
  await sb.from('posts').update({pinned:!pinned}).eq('id',id);
  await loadPosts();
  toast(!pinned?'// gönderi sabitlendi':'// sabit kaldırıldı');
}
async function modBan(nick){
  if(!confirm(`@${nick} kullanıcısını banlamak istediğine emin misin?`))return;
  await sb.from('kullanicilar').upsert({nick,banli:true});
  toast(`// @${nick} banlı`);
}
// Sayfa yüklenince mod oturumu kontrol et
(async()=>{
  const {data:{session}}=await sb.auth.getSession();
  if(session&&MOD_EMAILS.includes(session.user.email))setModeratorMode(true);
})();


// ── STATE ──
let currentUser=null,activeFilter={kind:'all',val:''},selectedMood=null,selectedType=null,activeAuthTab='login',activeSort='new',isModerator=false;
let activeTag=null;
let visibleCount=20;
const PAGE_SIZE=20;

let posts=[];
let bookmarks=JSON.parse(localStorage.getItem('duvar_bookmarks')||'[]');
let reportedPosts=new Set(JSON.parse(localStorage.getItem('duvar_reported')||'[]'));
let expandedPosts=new Set();
let dislikedPosts=new Set();
const TRUNCATE_LEN=200;
let anketOpen=false;

// ── TAG ──
function setTagFilter(tag){activeTag=activeTag===tag?null:tag;visibleCount=PAGE_SIZE;render();}

// ── DRAFT ──
let draftTimer=null;
function saveDraft(){
  clearTimeout(draftTimer);
  draftTimer=setTimeout(()=>{
    const v=document.getElementById('mainInput').value;
    if(v)localStorage.setItem('duvar_draft',v);else localStorage.removeItem('duvar_draft');
    const el=document.getElementById('draftSaved');
    el.classList.add('show');
    setTimeout(()=>el.classList.remove('show'),1500);
  },600);
}
function restoreDraft(){
  const d=localStorage.getItem('duvar_draft');
  if(d)document.getElementById('mainInput').value=d;
}

// ── PERMALINK ──
function copyPostLink(id){
  const url=location.origin+location.pathname+'?post='+id;
  navigator.clipboard.writeText(url).then(()=>toast('// link kopyalandı')).catch(()=>{});
}
function handlePermalink(){
  const id=parseInt(new URLSearchParams(location.search).get('post'));
  if(!id)return;
  const check=setInterval(()=>{
    const el=document.querySelector(`.post[data-pid="${id}"]`);
    if(el){clearInterval(check);el.classList.add('highlighted');el.scrollIntoView({behavior:'smooth',block:'center'});}
  },300);
  setTimeout(()=>clearInterval(check),6000);
}

// ── KULLANICI PROFİLİ ──
function openUserProfile(nick){
  if(nick===currentUser){openProfile();return;}
  const userPosts=posts.filter(p=>p.author===nick);
  const tF=userPosts.reduce((s,p)=>s+(p.fire||0),0);
  document.getElementById('uprofileNick').textContent=nick;
  document.getElementById('uprofileStats').innerHTML=`
    <div class="panel-stat"><div class="panel-stat-num">${userPosts.length}</div><div class="panel-stat-label">gönderi</div></div>
    <div class="panel-stat"><div class="panel-stat-num">${tF}</div><div class="panel-stat-label">❤️ toplam</div></div>
    <div class="panel-stat"><div class="panel-stat-num">${userPosts.reduce((s,p)=>s+p.comments.length,0)}</div><div class="panel-stat-label">yorum aldı</div></div>`;
  const rz=getRozetler(userPosts,tF);
  document.getElementById('uprofileRozetler').innerHTML=rz.length?rz.map(r=>`<span class="rozet">${r}</span>`).join(''):'<span style="font-family:Space Mono,monospace;font-size:.62rem;color:var(--muted)">// henüz rozet yok</span>';
  document.getElementById('uprofilePostsList').innerHTML=userPosts.slice(0,10).map(p=>`
    <div class="my-post-mini">
      <div class="my-post-mini-text">${esc(p.text.slice(0,120))}${p.text.length>120?'...':''}</div>
      <div class="my-post-mini-meta"><span>❤️ ${p.fire||0}</span><span>↳ ${p.comments.length}</span><span>${relTime(p.time)}</span></div>
    </div>`).join('')||'<div style="font-family:Space Mono,monospace;font-size:.7rem;color:var(--muted)">// gönderi yok</div>';
  document.getElementById('uprofileOverlay').classList.remove('hidden');
}
function closeUProfile(){document.getElementById('uprofileOverlay').classList.add('hidden');}

// ── ANKET ──
function toggleAnket(){
  anketOpen=!anketOpen;
  document.getElementById('anketInputs').classList.toggle('hidden',!anketOpen);
  document.getElementById('anketToggle').textContent=anketOpen?'✕ anketi kaldır':'📊 anket ekle';
  if(!anketOpen)['anket-opt-0','anket-opt-1','anket-opt-2','anket-opt-3'].forEach(id=>{document.getElementById(id).value='';});
}
async function voteAnket(postId,optIdx){
  if(!currentUser){toast('// oy için giriş yap');return;}
  const p=posts.find(x=>x.id===postId);
  if(!p)return;
  if(p.myVote===optIdx){
    await sb.from('anket_oylar').delete().eq('post_id',postId).eq('nick',currentUser);
  } else {
    await sb.from('anket_oylar').upsert({post_id:postId,nick:currentUser,option_idx:optIdx},{onConflict:'post_id,nick'});
  }
  await loadPosts();
}

function toggleBookmark(id){
  const i=bookmarks.indexOf(id);
  if(i===-1)bookmarks.push(id);else bookmarks.splice(i,1);
  localStorage.setItem('duvar_bookmarks',JSON.stringify(bookmarks));
  render();
}

// ── THEME ──
const THEME_CYCLE=['dark','warm','light'];
const THEME_ICON={dark:'◑',warm:'◕',light:'◐'};
function toggleTheme(){
  const curr=document.documentElement.getAttribute('data-theme')||'dark';
  const next=THEME_CYCLE[(THEME_CYCLE.indexOf(curr)+1)%THEME_CYCLE.length];
  document.documentElement.setAttribute('data-theme',next);
  localStorage.setItem('duvar_theme',next);
  document.getElementById('themeBtn').textContent=THEME_ICON[next]||'◑';
}
(()=>{
  const saved=localStorage.getItem('duvar_theme');
  const sys=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
  const t=saved||sys;
  document.documentElement.setAttribute('data-theme',t);
  document.getElementById('themeBtn').textContent=THEME_ICON[t]||'◑';
  if(!saved){
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',e=>{
      if(localStorage.getItem('duvar_theme'))return;
      const nt=e.matches?'dark':'light';
      document.documentElement.setAttribute('data-theme',nt);
      document.getElementById('themeBtn').textContent=THEME_ICON[nt]||'◑';
    });
  }
})();

// ── BOTTOM NAV ──
function updateBottomNav(active){
  ['duvar','ilanlar','etkinlik'].forEach(id=>{
    document.getElementById('bnav-'+id)?.classList.toggle('active',id===active);
  });
  ['bnav-notif','bnav-profil'].forEach(id=>document.getElementById(id)?.classList.remove('active'));
}
// Bildirim dot'unu bottom nav ile senkronize et
function syncBnavDot(){
  const dot=document.getElementById('bnavNotifDot');
  const src=document.getElementById('notifDot');
  if(dot&&src)dot.classList.toggle('show',src.classList.contains('show'));
}

// ── YAZILIM REHBERİ ──
const YAZILIM_DATA={
  autocad:{label:'AutoCAD',kategoriler:[
    {baslik:'// temel komutlar',komutlar:[{ks:'L',acik:'Line — çizgi'},{ks:'PL',acik:'Polyline — polçizgi'},{ks:'REC',acik:'Rectangle — dikdörtgen'},{ks:'C',acik:'Circle — daire'},{ks:'A',acik:'Arc — yay'},{ks:'H',acik:'Hatch — tarama'},{ks:'T',acik:'Mtext — yazı ekle'},{ks:'DIM',acik:'Dimension — ölçülendirme'},{ks:'B',acik:'Block — blok oluştur'},{ks:'I',acik:'Insert — blok ekle'}]},
    {baslik:'// düzenleme',komutlar:[{ks:'M',acik:'Move — taşı'},{ks:'CO',acik:'Copy — kopyala'},{ks:'RO',acik:'Rotate — döndür'},{ks:'SC',acik:'Scale — ölçekle'},{ks:'MI',acik:'Mirror — aynala'},{ks:'TR',acik:'Trim — kırp'},{ks:'EX',acik:'Extend — uzat'},{ks:'O',acik:'Offset — paralel kopyala'},{ks:'F',acik:'Fillet — yuvarla (R=0 köşe)'},{ks:'E',acik:'Erase — sil'},{ks:'AR',acik:'Array — dizi kopyala'}]},
    {baslik:'// görünüm & sunum',komutlar:[{ks:'Z+E',acik:'Zoom Extents — tüm çizim'},{ks:'Z+W',acik:'Zoom Window — alan seç'},{ks:'REGEN',acik:'Ekranı yenile'},{ks:'LA',acik:'Layer — katman yöneticisi'},{ks:'LTSCALE',acik:'Kesik çizgi ölçeği'},{ks:'PLOT',acik:'Yazdır / PDF'},{ks:'LAYOUT',acik:'Kağıt alanı'}]},
    {baslik:'// klavye kısayolları',komutlar:[{ks:'Ctrl+Z',acik:'Geri al'},{ks:'Ctrl+Y',acik:'Yinele'},{ks:'Ctrl+S',acik:'Kaydet'},{ks:'F3',acik:'Osnap aç/kapat'},{ks:'F8',acik:'Ortho aç/kapat'},{ks:'Esc',acik:'Komutu iptal et'},{ks:'Space/Enter',acik:'Son komutu tekrarla'}]}
  ]},
  rhino:{label:'Rhino 3D',kategoriler:[
    {baslik:'// temel çizim',komutlar:[{ks:'Line',acik:'Çizgi'},{ks:'Polyline',acik:'Kırık çizgi'},{ks:'Circle',acik:'Daire'},{ks:'Rectangle',acik:'Dikdörtgen'},{ks:'Curve',acik:'Serbest eğri (NURBS)'},{ks:'InterpCrv',acik:'Noktalardan eğri'},{ks:'Arc',acik:'Yay'}]},
    {baslik:'// yüzey & katı',komutlar:[{ks:'ExtrudeCrv',acik:'Eğriyi hacme çek'},{ks:'Loft',acik:'Eğrilerden yüzey'},{ks:'Sweep1',acik:'Profili ray üzerinde süpür'},{ks:'Revolve',acik:'Döndürerek yüzey'},{ks:'PlanarSrf',acik:'Düzlemsel yüzey'},{ks:'BooleanUnion',acik:'Birleştir'},{ks:'BooleanDifference',acik:'Çıkar'},{ks:'BooleanIntersection',acik:'Kesişim al'}]},
    {baslik:'// düzenleme',komutlar:[{ks:'Move',acik:'Taşı'},{ks:'Copy',acik:'Kopyala'},{ks:'Rotate',acik:'Döndür'},{ks:'Mirror',acik:'Aynala'},{ks:'Trim',acik:'Kırp'},{ks:'Join',acik:'Birleştir'},{ks:'Explode',acik:'Parçala'},{ks:'Offset',acik:'Paralel kopyala'}]},
    {baslik:'// sunum',komutlar:[{ks:'Make2D',acik:'Planı çıkar (2D)'},{ks:'Render',acik:'Render al'},{ks:'ViewCaptureToFile',acik:'Görünümü kaydet'},{ks:'Layout',acik:'Sayfa düzeni'}]}
  ]},
  revit:{label:'Revit',kategoriler:[
    {baslik:'// temel araçlar',komutlar:[{ks:'WA',acik:'Wall — duvar'},{ks:'DR',acik:'Door — kapı'},{ks:'WN',acik:'Window — pencere'},{ks:'FL',acik:'Floor — döşeme'},{ks:'RP',acik:'Roof — çatı'},{ks:'CL',acik:'Column — kolon'},{ks:'BM',acik:'Beam — kiriş'},{ks:'CM',acik:'Component — bileşen ekle'},{ks:'DI',acik:'Dimension — ölçü'}]},
    {baslik:'// görünümler',komutlar:[{ks:'VG',acik:'Visibility/Graphics (görünürlük)'},{ks:'ZA',acik:'Zoom All'},{ks:'EL',acik:'Elevation — cephe'},{ks:'SC',acik:'Section — kesit'},{ks:'PP',acik:'Properties paneli'},{ks:'WT',acik:'Tile Views'}]},
    {baslik:'// düzenleme',komutlar:[{ks:'MV',acik:'Move — taşı'},{ks:'CO',acik:'Copy — kopyala'},{ks:'RO',acik:'Rotate — döndür'},{ks:'MM',acik:'Mirror'},{ks:'AR',acik:'Array'},{ks:'TR',acik:'Trim/Extend'},{ks:'GP',acik:'Group'},{ks:'SA',acik:'Select All Instances'}]},
    {baslik:'// kısayollar',komutlar:[{ks:'Ctrl+Z',acik:'Geri al'},{ks:'Ctrl+S',acik:'Kaydet'},{ks:'HH',acik:'Hide Element'},{ks:'HR',acik:'Reset Hidden'}]}
  ]},
  sketchup:{label:'SketchUp',kategoriler:[
    {baslik:'// temel araçlar',komutlar:[{ks:'L',acik:'Line — çizgi'},{ks:'R',acik:'Rectangle — dikdörtgen'},{ks:'C',acik:'Circle — daire'},{ks:'P',acik:'Push/Pull — hacme çek'},{ks:'F',acik:'Follow Me — süpür'},{ks:'Q',acik:'Rotate — döndür'},{ks:'S',acik:'Scale — ölçekle'},{ks:'T',acik:'Tape Measure'},{ks:'D',acik:'Dimension'}]},
    {baslik:'// düzenleme',komutlar:[{ks:'M',acik:'Move — taşı'},{ks:'E',acik:'Eraser — sil'},{ks:'O',acik:'Offset — paralel'},{ks:'G',acik:'Make Group'},{ks:'Ctrl+G',acik:'Make Component'},{ks:'Space',acik:'Select aracı'}]},
    {baslik:'// kamera & görünüm',komutlar:[{ks:'Scroll',acik:'Zoom in/out'},{ks:'Orta tuş',acik:'Döndür (orbit)'},{ks:'Shift+Orta',acik:'Pan'},{ks:'K',acik:'Back Edges'},{ks:'Ctrl+Z',acik:'Geri al'},{ks:'Ctrl+S',acik:'Kaydet'}]}
  ]},
  photoshop:{label:'Photoshop',kategoriler:[
    {baslik:'// sunum hazırlama',komutlar:[{ks:'Ctrl+T',acik:'Free Transform'},{ks:'Ctrl+J',acik:'Katmanı çoğalt'},{ks:'Ctrl+G',acik:'Katmanları grupla'},{ks:'Ctrl+E',acik:'Katmanı birleştir'},{ks:'Ctrl+M',acik:'Curves — kontrast'},{ks:'Ctrl+U',acik:'Hue/Saturation'},{ks:'Ctrl+L',acik:'Levels — ışık düzenle'}]},
    {baslik:'// render post-production',komutlar:[{ks:'Ctrl+Alt+G',acik:'Create Clipping Mask'},{ks:'W',acik:'Quick Selection'},{ks:'Ctrl+D',acik:'Seçimi kaldır'},{ks:'Ctrl+Shift+N',acik:'Yeni katman'},{ks:'I',acik:'Eyedropper — renk al'},{ks:'B',acik:'Brush aracı'}]},
    {baslik:'// kısayollar',komutlar:[{ks:'Ctrl+Z',acik:'Geri al'},{ks:'Ctrl+0',acik:'Fit to Screen'},{ks:'Ctrl+P',acik:'Yazdır'},{ks:'Space+Sürükle',acik:'Pan (el aracı)'},{ks:'Ctrl+Shift+Alt+S',acik:'Web için dışa aktar'}]}
  ]}
};

let aktifYazilim='autocad';
function switchYazilim(yazilim){
  aktifYazilim=yazilim;
  document.querySelectorAll('.yazilim-tab').forEach(b=>b.classList.toggle('active',b.dataset.yazilim===yazilim));
  renderYazilim(yazilim);
}
function renderYazilim(yazilim){
  const data=YAZILIM_DATA[yazilim||aktifYazilim];
  const el=document.getElementById('yazilimContent');
  if(!el||!data)return;
  el.innerHTML=`<div class="yazilim-kategoriler">${data.kategoriler.map(kat=>`
    <div class="yazilim-kat">
      <div class="yazilim-kat-baslik">${esc(kat.baslik)}</div>
      <div class="yazilim-komutlar">${kat.komutlar.map(k=>`
        <div class="yazilim-komut">
          <span class="yazilim-ks">${esc(k.ks)}</span>
          <span class="yazilim-acik">${esc(k.acik)}</span>
        </div>`).join('')}
      </div>
    </div>`).join('')}
  </div>`;
}

// ── PROGRAM HESAPLAYICI 2.0 ──
const PROGRAM_PARAMS={
  konut:{label:'Konut',otopark:'1 araç / 120 m² brüt alan',otoparkFn:a=>Math.ceil(a/120),yangin:{kat4:'1 yangın merdiveni (≥4 kat)',kat7:'2 yangın merdiveni (≥7 kat)'},asansor:'4+ katta zorunlu (her 2000 m² için 1)',sigınak:'%3 oranında sığınak alanı önerilir',engelli:'Her katta 1 engelli WC, giriş rampa zorunlu',not:'TBDY 2018 ve Planlama Yönetmeliği esas alınmıştır.'},
  ofis:{label:'Ofis / İdari',otopark:'1 araç / 50 m² brüt alan',otoparkFn:a=>Math.ceil(a/50),yangin:{kat4:'1 yangın merdiveni (≥4 kat)',kat7:'2 yangın merdiveni (≥7 kat)'},asansor:'3+ katta zorunlu',sigınak:'Zorunlu değil (bölgeye bağlı)',engelli:'Her katta 1 engelli WC, asansör zorunlu',not:'Binanın niteliğine göre yerel yönetmelik uygulanır.'},
  ticaret:{label:'Ticaret / AVM',otopark:'1 araç / 40 m² satış alanı',otoparkFn:a=>Math.ceil(a*0.6/40),yangin:{kat4:'2 yangın merdiveni (kaçış uzaklığı ≤25 m)',kat7:'2+ yangın merdiveni + basınçlandırma'},asansor:'2+ katta zorunlu, yürüyen merdiven önerilir',sigınak:'Zorunlu değil',engelli:'Her katta ≥1 engelli WC, branda yeri',not:'İtfaiye Yönetmeliği ve AVM yönetmeliği esas alınır.'},
  egitim:{label:'Eğitim',otopark:'1 araç / 5 öğretmen (kapasite bağlı)',otoparkFn:a=>Math.ceil(a/200),yangin:{kat4:'1 yangın merdiveni, sınıftan ≤15 m mesafe',kat7:'2 yangın merdiveni'},asansor:'3+ katta zorunlu',sigınak:'Sığınak zorunlu (öğrenci kapasitesine göre)',engelli:'Rampa, engelli WC, uyarı bantları zorunlu',not:'MEB standartları ve Binaların Yangından Korunması Yönetmeliği.'},
  saglik:{label:'Sağlık',otopark:'1 araç / 3 yatak veya 50 m²',otoparkFn:a=>Math.ceil(a/50),yangin:{kat4:'Her katta en az 2 yangın merdiveni, yangın koridoru',kat7:'Sprinkler sistemi zorunlu'},asansor:'Yatak katlı binalarda zorunlu, 2+ ameliyathane için ayrı',sigınak:'Zorunlu değil (acil bölüm korunaklı tasarlanmalı)',engelli:'Tüm alanlarda tam engelli erişimi zorunlu',not:'Sağlık Yapıları İnşaat ve Onarım Yönetmeliği.'},
  otel:{label:'Otel',otopark:'1 araç / 2-3 oda (yıldıza göre)',otoparkFn:a=>Math.ceil(a/80),yangin:{kat4:'Yangın merdiveni + koridorda duman bariyeri',kat7:'Sprinkler + sesli alarm + acil aydınlatma'},asansor:'3+ katta zorunlu, VIP kat için ayrı önerilir',sigınak:'Zorunlu değil',engelli:'%5 oda engelli uyumlu, lobi tam erişimli',not:'Turizm Tesislerinin Belgelendirilmesine Yönelik Yönetmelik.'},
  kultur:{label:'Kültür / Eğlence',otopark:'1 araç / 3 koltuk veya 20 m²',otoparkFn:a=>Math.ceil(a/20),yangin:{kat4:'1-2 yangın çıkışı (kapasite ≥500 kişi = 2+)',kat7:'Sprinkler + sahne için özel yangın perdesi'},asansor:'2+ katta önerilir, engelli erişim asansörü zorunlu',sigınak:'Zorunlu değil',engelli:'%2 engelli koltuk, sahne erişimi',not:'Kalabalık binalara özel İtfaiye Yönetmeliği maddeleri.'}
};

function renderProgramSonuc(){
  const alanEl=document.getElementById('programAlan');
  const turEl=document.getElementById('programTur');
  const katEl=document.getElementById('programKat');
  if(!alanEl)return;
  const alan=parseFloat(alanEl.value)||0;
  const tur=turEl?turEl.value:'konut';
  const kat=parseInt(katEl?katEl.value:5)||5;
  const el=document.getElementById('programSonuc');
  if(!el)return;
  if(alan<=0){el.innerHTML='';return;}
  const p=PROGRAM_PARAMS[tur];
  if(!p)return;
  const otoparkSayisi=p.otoparkFn(alan);
  const yanginMer=kat>=7?p.yangin.kat7:kat>=4?p.yangin.kat4:'Zorunlu değil (≤3 kat)';
  const asansorZorunlu=tur==='konut'?kat>=4:tur==='ofis'?kat>=3:kat>=2;
  el.innerHTML=`
  <div class="program-sonuc-grid">
    <div class="prog-kart">
      <div class="prog-kart-ikon">🚗</div>
      <div class="prog-kart-baslik">Otopark</div>
      <div class="prog-kart-deger">${otoparkSayisi} araç</div>
      <div class="prog-kart-not">${esc(p.otopark)}</div>
    </div>
    <div class="prog-kart">
      <div class="prog-kart-ikon">🪜</div>
      <div class="prog-kart-baslik">Yangın Merdiveni</div>
      <div class="prog-kart-deger">${kat>=7?'2+':kat>=4?'1':'—'}</div>
      <div class="prog-kart-not">${esc(yanginMer)}</div>
    </div>
    <div class="prog-kart">
      <div class="prog-kart-ikon">🛗</div>
      <div class="prog-kart-baslik">Asansör</div>
      <div class="prog-kart-deger">${asansorZorunlu?'Zorunlu':'Önerilir'}</div>
      <div class="prog-kart-not">${esc(p.asansor)}</div>
    </div>
    <div class="prog-kart">
      <div class="prog-kart-ikon">♿</div>
      <div class="prog-kart-baslik">Engelli Erişimi</div>
      <div class="prog-kart-deger">Zorunlu</div>
      <div class="prog-kart-not">${esc(p.engelli)}</div>
    </div>
    <div class="prog-kart">
      <div class="prog-kart-ikon">🏰</div>
      <div class="prog-kart-baslik">Sığınak</div>
      <div class="prog-kart-deger">${p.sigınak.startsWith('Z')?'Zorunlu Değil':'Gerekli'}</div>
      <div class="prog-kart-not">${esc(p.sigınak)}</div>
    </div>
    <div class="prog-kart prog-kart-full">
      <div class="prog-kart-not" style="font-size:.65rem;color:var(--muted)">⚠ ${esc(p.not)} Proje aşamasında ilgili yönetmelikler uzman danışmanlığıyla kontrol edilmelidir.</div>
    </div>
  </div>`;
}

// ── RENK PALETİ ──
const PALET_DATA={
  beton:{label:'Beton + Cam',renkler:[{hex:'#E8E4DF',ad:'kaba sıva'},{hex:'#B0ABA5',ad:'beton gri'},{hex:'#6B6560',ad:'koyu beton'},{hex:'#2C2925',ad:'antrasit'},{hex:'#8FB5C8',ad:'cam mavi'},{hex:'#D4E4ED',ad:'açık cam'}]},
  ahsap:{label:'Ahşap + Taş',renkler:[{hex:'#C4A882',ad:'meşe ahşap'},{hex:'#8B6914',ad:'koyu ahşap'},{hex:'#4A3728',ad:'wenge'},{hex:'#D4C9B8',ad:'kum taşı'},{hex:'#9E9187',ad:'gri taş'},{hex:'#F5F0E8',ad:'kireç beyazı'}]},
  endustri:{label:'Endüstriyel',renkler:[{hex:'#2A2A2A',ad:'dökme demir'},{hex:'#4A4A4A',ad:'çelik gri'},{hex:'#8C8C8C',ad:'galvaniz'},{hex:'#C4A24A',ad:'sarı aksan'},{hex:'#8B3A3A',ad:'tuğla kırmızı'},{hex:'#F0EDE8',ad:'kireç sıva'}]},
  minimal:{label:'Minimal + Beyaz',renkler:[{hex:'#FFFFFF',ad:'saf beyaz'},{hex:'#F5F5F3',ad:'kırık beyaz'},{hex:'#E8E6E1',ad:'krem'},{hex:'#C8C4BE',ad:'açık gri'},{hex:'#787268',ad:'orta gri'},{hex:'#2A2825',ad:'siyah'}]},
  toprak:{label:'Toprak + Pişmiş',renkler:[{hex:'#C4622D',ad:'kiremit'},{hex:'#9E4A28',ad:'koyu terracotta'},{hex:'#D4A574',ad:'açık terracotta'},{hex:'#8B5E3C',ad:'koyu toprak'},{hex:'#D4B896',ad:'kum'},{hex:'#F0E8DC',ad:'bej'}]},
  deniz:{label:'Akdeniz',renkler:[{hex:'#2B6CB0',ad:'akdeniz mavi'},{hex:'#63B3ED',ad:'açık mavi'},{hex:'#EDF2F7',ad:'köpük beyazı'},{hex:'#F6AD55',ad:'portakal'},{hex:'#276749',ad:'zeytin yeşil'},{hex:'#FFF5E6',ad:'sıcak krem'}]},
  nordic:{label:'Nordic + Doğal',renkler:[{hex:'#F7F3EE',ad:'kar beyazı'},{hex:'#E8E0D5',ad:'açık krem'},{hex:'#C4A882',ad:'huş ahşap'},{hex:'#8B7355',ad:'çam gövde'},{hex:'#4A6741',ad:'orman yeşil'},{hex:'#2C3E50',ad:'gece mavi'}]},
  gece:{label:'Gece + Karanlık',renkler:[{hex:'#0A0A0A',ad:'derin siyah'},{hex:'#1A1A2E',ad:'gece mavi'},{hex:'#16213E',ad:'lacivert'},{hex:'#0F3460',ad:'derin mavi'},{hex:'#E94560',ad:'neon kırmızı'},{hex:'#F5A623',ad:'sarı aksan'}]},
  pastel:{label:'Pastel + Yumuşak',renkler:[{hex:'#FFE4E1',ad:'gül pembe'},{hex:'#E1F5FE',ad:'bebe mavisi'},{hex:'#F0FFF0',ad:'nane yeşil'},{hex:'#FFF9E6',ad:'vanilya'},{hex:'#EDE7F6',ad:'leylak'},{hex:'#FAFAFA',ad:'beyaz'}]},
  retro:{label:'Retro + Toprak',renkler:[{hex:'#8B4513',ad:'kahve'},{hex:'#CD853F',ad:'peru'},{hex:'#D2691E',ad:'çikolata'},{hex:'#F4A460',ad:'kum sarısı'},{hex:'#556B2F',ad:'zeytin'},{hex:'#708090',ad:'arduvaz gri'}]}
};

let aktifPalet='beton';
function setPalet(palet){
  aktifPalet=palet;
  document.querySelectorAll('.palet-kat').forEach(b=>b.classList.toggle('active',b.dataset.palet===palet));
  _renderPaletData(PALET_DATA[palet]);
}
function renderPalet(){
  // Rastgele palet seç
  const keys=Object.keys(PALET_DATA);
  const key=keys[Math.floor(Math.random()*keys.length)];
  aktifPalet=key;
  document.querySelectorAll('.palet-kat').forEach(b=>b.classList.toggle('active',b.dataset.palet===key));
  _renderPaletData(PALET_DATA[key]);
}
function _renderPaletData(data){
  const el=document.getElementById('paletSonuc');
  if(!el||!data)return;
  let html='<div class="palet-sonuc-label">'+data.label+'</div><div class="palet-renkler">';
  data.renkler.forEach(function(r){
    html+='<div class="palet-renk" data-hex="'+r.hex+'" title="Tıkla → kopyala">'
      +'<div class="palet-renk-swatch" style="background:'+r.hex+'"></div>'
      +'<div class="palet-renk-hex">'+r.hex+'</div>'
      +'<div class="palet-renk-ad">'+r.ad+'</div>'
      +'</div>';
  });
  html+='</div><div class="palet-not">// herhangi bir renk kutusuna tıkla → hex kodunu kopyalar</div>';
  el.innerHTML=html;
  el.querySelectorAll('.palet-renk[data-hex]').forEach(function(card){
    card.addEventListener('click',function(){
      var hex=card.dataset.hex;
      navigator.clipboard.writeText(hex).then(function(){toast('// '+hex+' kopyalandı');}).catch(function(){toast('// '+hex);});
    });
  });
}

// ── YAPAY ZEKA İPUÇLARI ──
const AI_DATA={
  konsept:[
    {baslik:'Konsept Üretimi',arac:'ChatGPT / Claude',prompts:[
      '"[fonksiyon] için 5 farklı kavramsal yaklaşım öner. Her birini 2 cümleyle açıkla."',
      '"[konsept kelimesi] kavramını mimarlığa nasıl çevirebilirim? Somut mekansal öneriler ver."',
      '"Bu konsepti jüri diline çevir: [kendi cümlelerinle yazdığın konsept]"',
      '"[proje programı] için zıt iki konsept geliştir. Hangisi daha güçlü ve neden?"'
    ]},
    {baslik:'Referans Bulma',arac:'ChatGPT / Perplexity',prompts:[
      '"[fonksiyon + bağlam] için 5 ilham verici yapı öner. Mimar, yıl ve öne çıkan özelliğini belirt."',
      '"[mimar adı] bu projeyi nasıl ele alırdı? Onun dilinde bir konsept yaz."',
      '"[malzeme] kullanan ödüllü yapılar? Archdaily veya Dezeen\'den örnekler."'
    ]},
    {baslik:'Program & Bağlam Analizi',arac:'Claude / ChatGPT',prompts:[
      '"[arsa büyüklüğü] m² arsaya [fonksiyon listesi] sığdır, oran ve hiyerarşi öner."',
      '"[kent / mahalle] bağlamında yapılacak [fonksiyon] için sosyal ve kültürel analiz yap."'
    ]}
  ],
  gorsel:[
    {baslik:'Midjourney Promptları',arac:'Midjourney',prompts:[
      '"architectural concept sketch, [stil], black pen on white paper, minimalist --ar 16:9"',
      '"[malzeme] facade, [iklim] climate, natural light, architectural photography --ar 3:2"',
      '"[fonksiyon] interior, [atmosfer], warm light, material study, photorealistic --ar 16:9"',
      '"site plan diagram, [bağlam], aerial view, minimal color palette, architectural drawing"'
    ]},
    {baslik:'DALL-E / Adobe Firefly',arac:'ChatGPT / Adobe',prompts:[
      '"Bir mimarlık stüdyosu için concept board: [tema], [renk paleti], kolaj tarzı"',
      '"[proje adı] için logo tasarımı: geometrik, [iki renk], modern, mimari tema"',
      '"[malzeme] doku çalışması, makro fotoğraf kalitesinde, sunum için"'
    ]},
    {baslik:'Stable Diffusion İpuçları',arac:'Stable Diffusion',prompts:[
      '"img2img: eskiz çizimini render\'a çevirmek için kendi çizimini yükle"',
      '"ControlNet + depth map: 3D modelinden fotoğrafçı render üret"',
      '"inpaint: renderdaki belirli bir bölümü (pencere, cephe, peyzaj) değiştir"'
    ]}
  ],
  sunum:[
    {baslik:'Jüri Hazırlığı',arac:'Claude / ChatGPT',prompts:[
      '"Bu projeyi 2 dakikada anlatacak sunum metni yaz: [proje özeti]"',
      '"Jüri bana [konu] hakkında soru sorabilir. Güçlü 3 cevap hazırla."',
      '"Tasarım kararlarımı eleştir: [kararlar]. Jüri ne sorabilir?"',
      '"Bu metni akademik ve özgüvenli jüri diline çevir: [metin]"'
    ]},
    {baslik:'Sunum Düzeni',arac:'ChatGPT / Claude',prompts:[
      '"A0 paftam için içerik hiyerarşisi öner: [ne var elimde]. Hangi sırayla dizmeliyim?"',
      '"Bu projenin 8 slaytlık sunum iskeletini oluştur: [proje adı ve özeti]"',
      '"Başlık, alt başlık ve açıklama metinlerini kısalt, paftaya sığdır: [metinler]"'
    ]},
    {baslik:'Diyagram & Şema',arac:'ChatGPT',prompts:[
      '"Sirkülasyon diyagramı için hangi semboller kullanılmalı? SVG kodu ver."',
      '"[kavram] için mimari diyagram nasıl çizilir? Adım adım anlat."'
    ]}
  ],
  arastirma:[
    {baslik:'Literatür & Yapı Analizi',arac:'Perplexity / Claude',prompts:[
      '"[yapı adı, mimar] projesinin tasarım sürecini ve ana kararlarını analiz et."',
      '"[dönem veya akım] mimarisinin temel ilkeleri neler? Akademik kaynaklarla açıkla."',
      '"[ülke/bölge] geleneksel mimarlığında [konu: iklim, malzeme, avlu] nasıl çözülmüş?"'
    ]},
    {baslik:'Yönetmelik & Teknik',arac:'ChatGPT / Claude',prompts:[
      '"Türkiye\'de [fonksiyon] yapısı için imar yönetmeliği şartları neler?"',
      '"LEED / BREEAM sertifikası almak için tasarım aşamasında nelere dikkat edilmeli?"',
      '"[yapı türü] için yangın yönetmeliği gereklilikleri: çıkış, merdiven, koridorlar."'
    ]},
    {baslik:'Kaynak & Okuma',arac:'Perplexity / Consensus',prompts:[
      '"[konu] üzerine mimarlık teorisi alanında temel okunacak 5 kitap öner."',
      '"[mimar] hakkında peer-reviewed makale var mı? Kısaca özetle."',
      '"Archdaily\'de [fonksiyon + bağlam] filtresiyle arama stratejisi öner."'
    ]}
  ],
  teknik:[
    {baslik:'Grasshopper / Rhino Scripting',arac:'ChatGPT / GitHub Copilot',prompts:[
      '"Bu Grasshopper bileşeni neden hata veriyor? [hata mesajı veya ekran görüntüsü]"',
      '"Parametrik [form] oluşturmak için Grasshopper mantığını adım adım anlat."',
      '"RhinoScript ile [işlem] yapmak istiyorum. Python kodu yaz."'
    ]},
    {baslik:'AutoCAD / Revit Makroları',arac:'ChatGPT',prompts:[
      '"AutoCAD\'de tüm [layer] nesnelerini seçip [işlem] yapan LISP kodu yaz."',
      '"Revit API ile [işlem] otomatikleştiren Python kodu yaz."',
      '"DXF dosyasını Python ile okuyup [veri] çıkaran kod yaz."'
    ]},
    {baslik:'Yapısal & Mekanik Hesap',arac:'ChatGPT / Wolfram',prompts:[
      '"[açıklık] m kirişin ön boyutlandırması için basit kural öner (betonarme/çelik)."',
      '"[iklim] için güneş kırıcı boyutlandırması nasıl yapılır? Formül ver."',
      '"[hacim] m³ ofis için mekanik tesisat ön hesabı: havalandırma debisi ve kanal boyutu."'
    ]}
  ],
  rapor:[
    {baslik:'Rapor Yazımı',arac:'Claude / ChatGPT',prompts:[
      '"Bu tasarım açıklamama akademik ton kat: [metin]. Türkçe, 1. çoğul şahıs kullan."',
      '"[proje] için 500 kelimelik tasarım raporu giriş bölümü yaz. Bağlam + problem + yaklaşım."',
      '"Bu cümleleri birleştir, tekrarı kaldır, akıcı hale getir: [metin]"'
    ]},
    {baslik:'Çeviri & Dil',arac:'DeepL / ChatGPT',prompts:[
      '"Bu mimari metni Türkçe\'den İngilizce\'ye çevir, teknik terimler doğru olsun: [metin]"',
      '"Abstract için 150 kelimelik İngilizce özet yaz: [proje açıklaması]"',
      '"Bu İngilizce reddiyeyi Türkçe\'ye çevir ve ana argümanları listele: [metin]"'
    ]},
    {baslik:'Dipnot & Kaynak',arac:'Claude / Zotero + ChatGPT',prompts:[
      '"Bu alıntı için APA 7 formatında kaynak oluştur: [yazar, başlık, yıl, yayınevi]"',
      '"[konu] üzerine akademik kaynak ararken Google Scholar\'da nasıl filtre kullanırım?"',
      '"Bu metinde kullandığım alıntıları tespit et ve kaynak listesi oluştur: [metin]"'
    ]}
  ]
};
let aktifAi='konsept';
function switchAiTab(tab){
  aktifAi=tab;
  document.querySelectorAll('#aiTablar .yazilim-tab').forEach(b=>b.classList.toggle('active',b.dataset.ai===tab));
  renderAi(tab);
}
function renderAi(tab){
  aktifAi=tab;
  document.querySelectorAll('#aiTablar .yazilim-tab').forEach(b=>b.classList.toggle('active',b.dataset.ai===tab));
  const el=document.getElementById('aiContent');
  if(!el)return;
  const kategoriler=AI_DATA[tab]||[];
  let html='<div class="yazilim-kategoriler">';
  kategoriler.forEach(function(kat){
    html+='<div class="yazilim-kat">'
      +'<div class="yazilim-kat-baslik">'+kat.baslik+' <span style="font-size:.58rem;color:var(--muted);font-weight:400;text-transform:none;letter-spacing:0">// '+kat.arac+'</span></div>'
      +'<div class="yazilim-komutlar">';
    kat.prompts.forEach(function(p){
      html+='<div class="ai-prompt" data-prompt="'+p.replace(/"/g,'&quot;')+'">'
        +'<div class="ai-prompt-text">'+p+'</div>'
        +'<button class="ai-kopyala-btn" title="kopyala">⎘</button>'
        +'</div>';
    });
    html+='</div></div>';
  });
  html+='</div>';
  el.innerHTML=html;
  el.querySelectorAll('.ai-prompt').forEach(function(card){
    card.querySelector('.ai-kopyala-btn').addEventListener('click',function(){
      const text=card.dataset.prompt.replace(/&quot;/g,'"');
      navigator.clipboard.writeText(text).then(function(){toast('// prompt kopyalandı');}).catch(function(){toast('// kopyalanamadı');});
    });
  });
}

// ── CV ŞABLONU ──
function renderCvPreview(){
  const g=id=>document.getElementById(id)?.value||'';
  const s=id=>document.getElementById(id);
  // Kişisel
  if(s('cvpAd'))s('cvpAd').textContent=g('cvAd')||'Ad Soyad';
  if(s('cvpUnvan'))s('cvpUnvan').textContent=g('cvUnvan')||'Mimarlık Öğrencisi';
  // İletişim
  const contacts=[g('cvEmail'),g('cvTelefon'),g('cvSehir'),g('cvLinkedin')].filter(Boolean);
  if(s('cvpContact'))s('cvpContact').textContent=contacts.join(' · ');
  // Bio
  if(s('cvpBio')){s('cvpBio').textContent=g('cvBio');s('cvpBio').style.display=g('cvBio')?'':'none';}
  // Eğitim
  let egitimHtml='';
  if(g('cvEgitim1Okul'))egitimHtml+=`<div class="cvp-item"><div class="cvp-item-title">${esc(g('cvEgitim1Okul'))}</div><div class="cvp-item-sub">${esc(g('cvEgitim1Bolum'))} ${g('cvEgitim1Tarih')?'· '+esc(g('cvEgitim1Tarih')):''}</div></div>`;
  if(g('cvEgitim2Okul'))egitimHtml+=`<div class="cvp-item"><div class="cvp-item-title">${esc(g('cvEgitim2Okul'))}</div><div class="cvp-item-sub">${esc(g('cvEgitim2Tarih'))}</div></div>`;
  if(s('cvpEgitim'))s('cvpEgitim').innerHTML=egitimHtml;
  if(s('cvpEgitimWrap'))s('cvpEgitimWrap').style.display=egitimHtml?'':'none';
  // Deneyim
  let deneyimHtml='';
  if(g('cvDeneyim1Firma'))deneyimHtml+=`<div class="cvp-item"><div class="cvp-item-title">${esc(g('cvDeneyim1Firma'))}</div><div class="cvp-item-sub">${esc(g('cvDeneyim1Pozisyon'))} ${g('cvDeneyim1Tarih')?'· '+esc(g('cvDeneyim1Tarih')):''}</div></div>`;
  if(g('cvDeneyim2Firma'))deneyimHtml+=`<div class="cvp-item"><div class="cvp-item-title">${esc(g('cvDeneyim2Firma'))}</div><div class="cvp-item-sub">${esc(g('cvDeneyim2Pozisyon'))} ${g('cvDeneyim2Tarih')?'· '+esc(g('cvDeneyim2Tarih')):''}</div></div>`;
  if(s('cvpDeneyim'))s('cvpDeneyim').innerHTML=deneyimHtml;
  if(s('cvpDeneyimWrap'))s('cvpDeneyimWrap').style.display=deneyimHtml?'':'none';
  // Yazılımlar / Beceriler / Diller
  const tagHtml=val=>val?val.split(',').map(t=>t.trim()).filter(Boolean).map(t=>`<span class="cvp-tag">${esc(t)}</span>`).join(''):'';
  if(s('cvpYazilimlar'))s('cvpYazilimlar').innerHTML=tagHtml(g('cvYazilimlar'));
  if(s('cvpYazilimWrap'))s('cvpYazilimWrap').style.display=g('cvYazilimlar')?'':'none';
  if(s('cvpBeceriler'))s('cvpBeceriler').innerHTML=tagHtml(g('cvBeceriler'));
  if(s('cvpBeceriWrap'))s('cvpBeceriWrap').style.display=g('cvBeceriler')?'':'none';
  if(s('cvpDiller'))s('cvpDiller').innerHTML=tagHtml(g('cvDiller'));
  if(s('cvpDilWrap'))s('cvpDilWrap').style.display=g('cvDiller')?'':'none';
}
function cvYazdir(){
  const preview=document.getElementById('cvPreviewInner');
  if(!preview)return;
  const w=window.open('','_blank');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>CV</title><style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Inter',Arial,sans-serif;font-size:10pt;color:#1a1a1a;padding:2cm;max-width:21cm;background:#fff}
    .cvp-name{font-size:22pt;font-weight:700;letter-spacing:.05em;text-transform:uppercase;margin-bottom:.2rem}
    .cvp-title{font-size:10pt;color:#666;letter-spacing:.12em;text-transform:uppercase;margin-bottom:.4rem}
    .cvp-contact{font-size:9pt;color:#888;margin-bottom:.8rem}
    .cvp-divider{border-top:2px solid #1a1a1a;margin:.6rem 0}
    .cvp-bio{font-size:9.5pt;color:#333;line-height:1.6;margin-bottom:.8rem}
    .cvp-section{margin-bottom:.8rem}
    .cvp-section-title{font-size:8pt;letter-spacing:.2em;text-transform:uppercase;font-weight:700;color:#1a1a1a;border-bottom:1px solid #ccc;margin-bottom:.4rem;padding-bottom:.2rem}
    .cvp-item{margin-bottom:.4rem}
    .cvp-item-title{font-size:10pt;font-weight:600}
    .cvp-item-sub{font-size:9pt;color:#666}
    .cvp-tags{display:flex;flex-wrap:wrap;gap:.3rem}
    .cvp-tag{font-size:8.5pt;background:#f0f0f0;padding:.15rem .45rem;border-radius:2px}
  </style></head><body>${preview.innerHTML}</body></html>`);
  w.document.close();
  setTimeout(()=>{w.print();},400);
}

// ── ESC + TOAST → utils.js tarafından sağlanır ──

// ── AUTH ──
function checkPassStrength(val){
  const set=(id,ok)=>{const el=document.getElementById(id);if(!el)return;el.classList.toggle('ok',ok);el.textContent=(ok?'✓ ':'✗ ')+el.textContent.slice(2);}
  set('preq-len', val.length>=8);
  set('preq-num', /\d/.test(val));
  set('preq-upper', /[A-ZÇĞİÖŞÜ]/.test(val));
}
function switchAuthTab(tab){
  activeAuthTab=tab;
  document.querySelectorAll('.modal-tab').forEach((t,i)=>t.classList.toggle('active',(i===0&&tab==='login')||(i===1&&tab==='register')));
  document.getElementById('authBtn').textContent=tab==='login'?'GİRİŞ YAP':'KAYIT OL';
  document.getElementById('authErr').textContent='';
  document.getElementById('authConfirmField').classList.toggle('hidden',tab==='login');
  document.getElementById('passReqs').classList.toggle('hidden',tab==='login');
  document.getElementById('authForgotNote').classList.toggle('hidden',tab==='register');
  document.getElementById('authRegisterNote').classList.toggle('hidden',tab==='login');
  if(tab==='register')document.getElementById('authPassConfirm').value='';
  checkPassStrength(document.getElementById('authPass').value);
}
async function handleAuth(){
  const nick=document.getElementById('authNick').value.trim().toLowerCase().replace(/\s+/g,'_');
  const pass=document.getElementById('authPass').value;
  const err=document.getElementById('authErr');
  if(nick.length<2){err.textContent='// nickname en az 2 karakter';return;}
  if(!/^[a-zA-Z0-9_çğıöşüÇĞİÖŞÜ]+$/.test(nick)){err.textContent='// sadece harf, rakam ve _';return;}
  const email=nickToEmail(nick);
  if(activeAuthTab==='register'){
    if(pass.length<8){err.textContent='// şifre en az 8 karakter';return;}
    if(!/\d/.test(pass)){err.textContent='// şifre en az 1 rakam içermeli';return;}
    if(!/[A-ZÇĞİÖŞÜ]/.test(pass)){err.textContent='// şifre en az 1 büyük harf içermeli';return;}
    const confirm=document.getElementById('authPassConfirm').value;
    if(pass!==confirm){err.textContent='// şifreler eşleşmiyor';return;}
    // Nick benzersizlik kontrolü (auth_id'si olan gerçek hesap)
    const {data:existing}=await sb.from('kullanicilar').select('nick,auth_id').eq('nick',nick).maybeSingle();
    if(existing?.auth_id){err.textContent='// bu nickname alınmış';return;}
    err.textContent='// kayıt yapılıyor...';
    // Supabase Auth'a kaydet — şifre sunucuda bcrypt ile saklanır
    const {data,error}=await sb.auth.signUp({email,password:pass,options:{data:{nick}}});
    if(error){
      err.textContent=error.message.includes('already registered')?'// bu nickname alınmış':'// hata: '+error.message;
      return;
    }
    // kullanicilar tablosuna auth_id ile ekle (veya güncelle)
    await sb.from('kullanicilar').upsert({nick,banli:false,auth_id:data.user.id},{onConflict:'nick'});
    loginSuccess(nick);
  }else{
    if(pass.length<4){err.textContent='// şifre en az 4 karakter';return;}
    err.textContent='// giriş yapılıyor...';
    // Supabase Auth ile doğrula — sunucu tarafında kontrol
    const {data,error}=await sb.auth.signInWithPassword({email,password:pass});
    if(error){err.textContent='// şifre yanlış veya hesap bulunamadı';return;}
    // Metadata'daki gerçek nick'i kullan (nick değiştirilmiş olabilir)
    const realNick=data.user.user_metadata?.nick||nick;
    // Ban kontrolü
    const {data:banRow}=await sb.from('kullanicilar').select('banli').eq('nick',realNick).maybeSingle();
    if(banRow?.banli){await sb.auth.signOut();err.textContent='// bu hesap askıya alınmış';return;}
    loginSuccess(realNick);
  }
}
function loginSuccess(nick){
  currentUser=nick;
  document.getElementById('authModal').classList.add('hidden');
  const nd=document.getElementById('userNickDisplay');
  nd.textContent=nick;nd.style.display='';
  document.getElementById('writeAsNick').textContent=nick;
  document.getElementById('writeBox').classList.remove('locked');
  document.getElementById('lockNotice').classList.remove('show');
  document.getElementById('notifBtn').style.display='';
  document.getElementById('dmBtn').style.display='';
  document.getElementById('loginBtn').style.display='none';
  cleanOldNotifs(currentUser);checkNotifDot();loadDMDot();render();
  checkPushStatus();
}
function enterAsGuest(){
  currentUser=null;
  document.getElementById('authModal').classList.add('hidden');
  document.getElementById('writeBox').classList.add('locked');
  document.getElementById('lockNotice').classList.add('show');
  document.getElementById('userNickDisplay').style.display='none';
  document.getElementById('notifBtn').style.display='none';
  document.getElementById('dmBtn').style.display='none';
  document.getElementById('loginBtn').style.display='';
  render();
}
function showAuth(){document.getElementById('authModal').classList.remove('hidden');}
async function deleteMyPost(id){
  if(!currentUser)return;
  if(!confirm('Bu gönderiyi silmek istediğine emin misin?'))return;
  // Önce local'den kaldır, anında kaybolsun
  posts=posts.filter(p=>p.id!==id);
  render();
  toast('// gönderin silindi');
  // Sonra Supabase'e yaz
  const {error}=await sb.from('posts').delete().eq('id',id).eq('author',currentUser);
  if(error){
    // Başarısız olursa geri yükle
    toast('// hata — yeniden yükleniyor');
    await loadPosts();
  }
}
function showNickChange(){
  const f=document.getElementById('nickChangeForm');
  f.classList.toggle('hidden');
  if(!f.classList.contains('hidden'))document.getElementById('newNickInput').focus();
  document.getElementById('nickChangeErr').textContent='';
}
async function changeNick(){
  const newNick=document.getElementById('newNickInput').value.trim().toLowerCase().replace(/\s+/g,'_');
  const err=document.getElementById('nickChangeErr');
  if(newNick.length<2){err.textContent='// en az 2 karakter';return;}
  if(!/^[a-zA-Z0-9_çğıöşüÇĞİÖŞÜ]+$/.test(newNick)){err.textContent='// sadece harf, rakam ve _';return;}
  if(newNick===currentUser){err.textContent='// aynı nickname';return;}
  err.textContent='// kontrol ediliyor...';
  const {data:existing}=await sb.from('kullanicilar').select('nick,auth_id').eq('nick',newNick).maybeSingle();
  if(existing?.auth_id){err.textContent='// bu nickname alınmış';return;}
  err.textContent='// güncelleniyor...';
  const oldNick=currentUser;
  // Supabase Auth email güncelle (kimlik sunucuda değişir)
  await sb.auth.updateUser({email:nickToEmail(newNick),data:{nick:newNick}});
  // Supabase tablo güncellemeleri
  await Promise.all([
    sb.from('kullanicilar').update({nick:newNick}).eq('nick',oldNick),
    sb.from('posts').update({author:newNick}).eq('author',oldNick),
    sb.from('yorumlar').update({nick:newNick}).eq('nick',oldNick),
    sb.from('mesajlar').update({gonderen:newNick}).eq('gonderen',oldNick),
    sb.from('mesajlar').update({alici:newNick}).eq('alici',oldNick),
  ]);
  currentUser=newNick;
  document.getElementById('userNickDisplay').textContent=newNick;
  document.getElementById('writeAsNick').textContent=newNick;
  document.getElementById('nickChangeForm').classList.add('hidden');
  document.getElementById('newNickInput').value='';
  err.textContent='';
  toast('// nickname değiştirildi → @'+newNick);
  await loadPosts();
  openProfile();
}
async function deleteAccount(){
  if(!currentUser)return;
  if(!confirm(`@${currentUser} hesabını kalıcı olarak silmek istediğine emin misin?\n\nTüm gönderilerin de silinecek.`))return;
  const nick=currentUser;
  // Supabase'den tüm gönderileri ve hesabı sil
  await sb.from('posts').delete().eq('author',nick);
  await sb.from('kullanicilar').delete().eq('nick',nick);
  // Supabase Auth oturumunu kapat
  await sb.auth.signOut();
  currentUser=null;
  document.getElementById('userNickDisplay').style.display='none';
  document.getElementById('notifBtn').style.display='none';
  document.getElementById('dmBtn').style.display='none';
  document.getElementById('loginBtn').style.display='';
  document.getElementById('writeBox').classList.add('locked');
  document.getElementById('lockNotice').classList.add('show');
  closePanels();
  toast('// hesabın silindi');
  render();
}
function logout(){
  currentUser=null;sb.auth.signOut();
  document.getElementById('userNickDisplay').style.display='none';
  document.getElementById('notifBtn').style.display='none';
  document.getElementById('dmBtn').style.display='none';
  document.getElementById('loginBtn').style.display='';
  document.getElementById('writeBox').classList.add('locked');
  document.getElementById('lockNotice').classList.add('show');
  closePanels();showAuth();render();
}

// ── NAV ──
const NAV_META={
  duvar:{
    title:'DUVAR — Mimarlık Öğrencileri için Anonim Yardımlaşma',
    desc:'Mimarlık öğrencileri için anonim yardımlaşma platformu. Dert anlat, soru sor, kaynak paylaş. Hoca yok, yargı yok.',
    url:'https://duvar.site/'
  },
  rehber:{
    title:'Mimarlık Öğrenci Rehberi — DUVAR',
    desc:'Mimarlık öğrencileri için stüdyo ipuçları, proje süreci, teslim hazırlığı ve dayanışma kaynakları.',
    url:'https://duvar.site/#rehber'
  },
  sozluk:{
    title:'Mimarlık Sözlüğü — DUVAR',
    desc:'Mimarlık terimleri sözlüğü. Charrette, form, mekan, yapı sistemi, cephe, plan ve yüzlerce mimarlık kavramı.',
    url:'https://duvar.site/#sozluk'
  },
  araclar:{
    title:'Mimarlık Araçları — Alan & Ölçek Hesaplayıcı — DUVAR',
    desc:'Mimarlık öğrencileri için online araçlar: alan hesaplayıcı, ölçek dönüştürücü, program sayacı.',
    url:'https://duvar.site/#araclar'
  },
  mimarlar:{
    title:'Dünyadan Önemli Mimarlar — DUVAR',
    desc:'Tarihin ve günümüzün önemli mimarları: Le Corbusier, Zaha Hadid, Frank Lloyd Wright ve daha fazlası.',
    url:'https://duvar.site/#mimarlar'
  },
  ilanlar:{
    title:'Mimarlık Staj ve İş İlanları — DUVAR',
    desc:'Mimarlık ofislerinden öğrencilere yönelik staj ve iş ilanları. Güncel fırsatlar.',
    url:'https://duvar.site/#ilanlar'
  },
  etkinlik:{
    title:'Mimarlık Etkinlikleri & Yarışmalar — DUVAR',
    desc:'Mimarlık öğrencilerine yönelik etkinlikler, workshoplar, seminerler ve yarışmalar.',
    url:'https://duvar.site/#etkinlik'
  }
};

function switchNav(tab,pushState=true){
  document.getElementById('section-duvar').style.display=tab==='duvar'?'block':'none';
  ['rehber','sozluk','araclar','mimarlar','ilanlar','etkinlik'].forEach(t=>document.getElementById('section-'+t).classList.toggle('active',t===tab));
  ['duvar','rehber','sozluk','araclar','mimarlar','ilanlar','etkinlik'].forEach(t=>document.getElementById('tab-'+t).classList.toggle('active',t===tab));
  updateBottomNav(tab);
  if(tab==='sozluk')renderSozluk();
  if(tab==='mimarlar')renderMimarlar();
  if(tab==='araclar')renderSayac();
  if(tab==='ilanlar')renderIlanlar();
  if(tab==='etkinlik')renderEtkinlikler();
  // URL + meta güncelle
  const m=NAV_META[tab]||NAV_META.duvar;
  if(pushState)history.pushState({tab},m.title,tab==='duvar'?location.pathname:'#'+tab);
  document.title=m.title;
  document.querySelector('meta[name="description"]').setAttribute('content',m.desc);
  document.querySelector('link[rel="canonical"]').setAttribute('href',m.url);
  document.querySelector('meta[property="og:title"]').setAttribute('content',m.title);
  document.querySelector('meta[property="og:description"]').setAttribute('content',m.desc);
  document.querySelector('meta[property="og:url"]').setAttribute('content',m.url);
  document.querySelector('meta[name="twitter:title"]').setAttribute('content',m.title);
  document.querySelector('meta[name="twitter:description"]').setAttribute('content',m.desc);
}

// Hash'ten sekmeye git
window.addEventListener('popstate',e=>{
  const tab=(e.state?.tab)||(location.hash.replace('#',''))||'duvar';
  const valid=['duvar','rehber','sozluk','araclar','mimarlar','ilanlar','etkinlik'];
  switchNav(valid.includes(tab)?tab:'duvar',false);
});

// İlk yüklemede hash kontrolü
(()=>{
  const hash=location.hash.replace('#','');
  const valid=['rehber','sozluk','araclar','mimarlar','ilanlar','etkinlik'];
  if(valid.includes(hash))switchNav(hash,false);
})();

// ── FILTER ──
function setFilter(val,el,kind='all'){
  activeFilter={kind,val};
  document.querySelectorAll('.filter-chip').forEach(c=>c.classList.remove('active'));
  el.classList.add('active');visibleCount=PAGE_SIZE;render();
}

// ── SORT ──
function setSort(s,el){
  activeSort=s;
  document.querySelectorAll('.sort-btn').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');visibleCount=PAGE_SIZE;render();
}

// ── RELATIVE TIME ──
function relTime(val){
  if(typeof val==='string'&&!/^\d/.test(val))return val; // "47 dk önce" gibi static string
  const d=new Date(val),now=Date.now(),diff=now-d;
  if(isNaN(diff))return val;
  const m=Math.floor(diff/60000),h=Math.floor(diff/3600000),day=Math.floor(diff/86400000);
  if(m<1)return 'şimdi';
  if(m<60)return m+' dk önce';
  if(h<24)return h+' sa önce';
  if(day<7)return day+' gün önce';
  return d.toLocaleDateString('tr-TR');
}

// ── RENDER ──
const moodL={yorgun:'😮‍💨 yorgunum',yardim:'🆘 yardım lazım',iyi:'✓ iyiyim',tesekkur:'♡ teşekkür'};
const typeL={dert:'// dert',soru:'? soru',kaynak:'↗ kaynak',acil:'! acil'};

function render(){
  const grid=document.getElementById('postsGrid');
  const savedScroll=window.scrollY;
  const q=(document.getElementById('searchInput')?.value||'').toLowerCase().trim();
  let filtered=[...posts];
  if(activeFilter.kind!=='all'){filtered=filtered.filter(p=>p[activeFilter.kind]===activeFilter.val);}
  if(q){filtered=filtered.filter(p=>p.text.toLowerCase().includes(q)||p.author.toLowerCase().includes(q));}
  if(activeSort==='week'){const w=Date.now()-7*24*60*60*1000;filtered=filtered.filter(p=>new Date(p.time)>=w);}
  if(activeSort==='saved'){filtered=filtered.filter(p=>bookmarks.includes(p.id));}
  if(activeTag){filtered=filtered.filter(p=>p.text.toLowerCase().includes('#'+activeTag.toLowerCase()));}
  // sıralama
  if(activeSort==='top'||activeSort==='week'){
    filtered.sort((a,b)=>(b.type==='acil'?1:0)-(a.type==='acil'?1:0)||(b.pinned?1:0)-(a.pinned?1:0)||((b.fire||0)-(a.fire||0)));
  } else {
    filtered.sort((a,b)=>(b.type==='acil'?1:0)-(a.type==='acil'?1:0)||(b.pinned?1:0)-(a.pinned?1:0));
  }
  const isFiltered=activeFilter.kind!=='all'||q||activeSort==='saved'||activeTag;
  document.getElementById('wallStats').textContent=filtered.length+' mesaj'+(isFiltered?' · filtrelendi':'')+(activeTag?` #${activeTag}`:'');
  if(!filtered.length){grid.innerHTML='<div class="empty-state"><div class="big">// bu filtrede gönderi yok</div></div>';return;}

  function renderText(t){
    return esc(t).replace(/#([\wçğışöüÇĞİŞÖÜ]+)/g,(m,tag)=>`<span class="tag-link" data-tag="${esc(tag)}">${m}</span>`);
  }

  renderGununEnIyisi();
  const toShow=filtered.slice(0,visibleCount);
  grid.innerHTML=toShow.map((p,i)=>{
    const isMine=p.author===currentUser;
    const mF=p.fired&&p.fired.includes(currentUser);
    const mD=dislikedPosts.has(p.id);
    const isBkm=bookmarks.includes(p.id);
    const isRep=reportedPosts.has(p.id);
    const isExp=expandedPosts.has(p.id);
    const needsTrunc=!isExp&&p.text.length>TRUNCATE_LEN;
    const mB=p.mood?`<span class="badge badge-mood-${p.mood}">${moodL[p.mood]||p.mood}</span>`:'';
    const tB=p.type?`<span class="badge badge-type-${p.type}">${typeL[p.type]||p.type}</span>`:'';
    // Anket HTML
    let anketHtml='';
    if(p.options&&p.options.length>=2){
      const total=(p.voteCounts||[]).reduce((s,n)=>s+n,0);
      anketHtml=`<div class="anket-display">${p.options.map((opt,idx)=>{
        const cnt=(p.voteCounts||[])[idx]||0;
        const pct=total?Math.round(cnt/total*100):0;
        const voted=p.myVote===idx;
        return`<div class="vote-opt${voted?' voted':''}" onclick="voteAnket(${p.id},${idx})">
          <div class="vote-fill" style="width:${pct}%"></div>
          <span class="vote-label">${esc(opt)}</span>
          <span class="vote-pct">${pct}%</span>
        </div>`;
      }).join('')}<div class="vote-count">// ${total} oy</div></div>`;
    }
    return`<div class="post${isMine?' mine':''}${p.pinned?' pinned-post':''}" data-pid="${p.id}" style="animation-delay:${Math.min(i,6)*.05}s">
      <div class="post-header">
        <span class="post-number">#${String(filtered.length-i).padStart(3,'0')}</span>
        <button class="post-author-link post-author${isMine?' me':''}" onclick="openUserProfile('${esc(p.author)}')">${esc(p.author)}</button>
        ${!isMine&&currentUser?`<button class="dm-btn" onclick="openConversation('${esc(p.author)}')" title="mesaj gönder">✉</button>`:''}
        ${isMine?'<span class="mini-tag mine-tag">sen</span>':''}
        ${p.pinned?'<span class="mini-tag pin-tag">📌 sabit</span>':''}
      </div>
      ${(mB||tB)?`<div class="post-badges">${tB}${mB}</div>`:''}
      <div class="post-text">${renderText(needsTrunc?p.text.slice(0,TRUNCATE_LEN).trimEnd():p.text)}${needsTrunc?`<button class="devami-btn" data-pid="${p.id}"> devamını oku →</button>`:''}</div>
      ${anketHtml}
      <div class="post-bottom">
        <span class="post-time">${relTime(p.time)}</span>
        <div class="reactions">
          <button class="rxn${mF?' on':''}"onclick="react(${p.id},'like')" title="beğen">${mF?'❤️':'🤍'} ${p.fire||0}</button>
          <button class="rxn${mD?' on dislike-on':''}"onclick="dislike(${p.id})" title="beğenme">${mD?'👎':'🖐'} ${p.disfire||0}</button>
          <button class="rxn"onclick="toggleComments(${p.id})" title="yorum yap">💬 ${p.comments.length}</button>
          <button class="rxn bkm-btn${isBkm?' on':''}"onclick="toggleBookmark(${p.id})"title="${isBkm?'kaydı kaldır':'kaydet'}">${isBkm?'🔖':'🏷️'}</button>
          <button class="rxn" onclick="copyPostLink(${p.id})" title="linki kopyala">🔗</button>
          ${!isMine?`<button class="rxn report-btn${isRep?' reported':''}"onclick="${isRep?'':` openReport(${p.id})`}"title="şikayet"${isRep?' disabled':''}>${isRep?'⚑':'···'}</button>`:''}
          ${isMine?`<button class="rxn"onclick="deleteMyPost(${p.id})"title="gönderimi sil"style="color:#c0392b">🗑</button>`:''}
          ${isModerator?`<button class="rxn"onclick="modDeletePost(${p.id})"title="sil"style="color:#c0392b">🗑</button><button class="rxn"onclick="modPin(${p.id},${!!p.pinned})"title="${p.pinned?'sabiti kaldır':'sabitle'}"style="color:var(--yellow)">${p.pinned?'📌':'📍'}</button><button class="rxn"data-nick="${esc(p.author)}"onclick="modBan(this.dataset.nick)"title="banla"style="color:#c0392b">🚫</button>`:''}
        </div>
      </div>
      <div class="comments-wrap"id="c-${p.id}">
        ${p.comments.map(c=>`<div class="comment"><button class="post-author-link comment-nick${c.nick===currentUser?' me':''}" onclick="openUserProfile('${esc(c.nick)}')">${esc(c.nick)}</button>${esc(c.text)}</div>`).join('')}
        <div class="comment-row">
          <input class="comment-input"id="ci-${p.id}"placeholder="${currentUser?(p.type==='soru'?'cevapla...':'destek yaz...'):'yazmak için giriş yap'}"maxlength="200"${!currentUser?' disabled':''}>
          <button class="comment-send"onclick="sendComment(${p.id})"${!currentUser?' disabled':''}>${p.type==='soru'?'cevapla':'gönder'}</button>
        </div>
      </div>
    </div>`;
  }).join('');
  // "Daha fazla yükle" butonu
  if(filtered.length>visibleCount){
    const rem=filtered.length-visibleCount;
    const btn=document.createElement('button');
    btn.className='load-more-btn';
    btn.textContent=`// ${rem} mesaj daha yükle`;
    btn.onclick=()=>{visibleCount+=PAGE_SIZE;render();};
    grid.appendChild(btn);
  }
  syncBnavDot();
  requestAnimationFrame(()=>window.scrollTo(0,savedScroll));
}

// ── ACTIONS ──
function selectMood(el,mood){
  document.querySelectorAll('.pill[class*="mood-"]').forEach(p=>p.classList.remove('active'));
  selectedMood=selectedMood===mood?null:mood;
  if(selectedMood)el.classList.add('active');
}
function selectType(el,type){
  document.querySelectorAll('.pill[class*="type-"]').forEach(p=>p.classList.remove('active'));
  selectedType=selectedType===type?null:type;
  if(selectedType)el.classList.add('active');
}
function checkRateLimit(){
  const key='duvar_ratelimit_'+currentUser;
  const now=Date.now();const hour=60*60*1000;
  const times=JSON.parse(localStorage.getItem(key)||'[]').filter(t=>now-t<hour);
  if(times.length>=10){
    const wait=Math.ceil((Math.min(...times)+hour-now)/60000);
    toast(`// saatlik limit doldu — ${wait} dk sonra tekrar yaz`);
    return false;
  }
  times.push(now);
  localStorage.setItem(key,JSON.stringify(times));
  return true;
}
async function addPost(){
  if(!currentUser)return;
  if(!checkRateLimit())return;
  const {data:banRow,error:banErr}=await sb.from('kullanicilar').select('banli').eq('nick',currentUser).maybeSingle();
  if(banErr){toast('// bağlantı hatası, tekrar dene');return;}
  if(banRow?.banli){toast('// hesabın askıya alınmış');logout();return;}
  const val=document.getElementById('mainInput').value.trim();
  if(!val)return;
  // Anket seçenekleri
  let options=null;
  if(anketOpen){
    const opts=[0,1,2,3].map(i=>document.getElementById('anket-opt-'+i).value.trim()).filter(Boolean);
    if(opts.length>=2)options=opts;
    else if(opts.length===1){toast('// en az 2 seçenek gir');return;}
  }
  const newPost=await sbAddPost(currentUser,val,selectedMood,selectedType,options);
  if(!newPost)return;
  document.getElementById('mainInput').value='';
  document.getElementById('charCount').textContent='500 karakter kaldı';
  localStorage.removeItem('duvar_draft');
  selectedMood=null;selectedType=null;
  document.querySelectorAll('.pill').forEach(p=>p.classList.remove('active'));
  if(anketOpen)toggleAnket();
  toast('// duvara yazıldı');
  await loadPosts();
}
async function react(id,type){
  if(!currentUser)return;
  if(type==='like'){
    const p=posts.find(x=>x.id===id);
    if(p&&p.fired&&!p.fired.includes(currentUser))addNotif(p.author,currentUser,'❤️ gönderini beğendi');
    await sbReact(id,currentUser);
  }
}
async function dislike(id){
  if(!currentUser){toast('// dislike için giriş yap');return;}
  await sbDislike(id,currentUser);
}
function expandPost(pid){expandedPosts.add(pid);render();}
function renderGununEnIyisi(){
  const el=document.getElementById('gunEnIyisi');
  if(!el)return;
  const bugun=new Date();bugun.setHours(0,0,0,0);
  const bugunPosts=posts.filter(p=>new Date(p.time)>=bugun&&p.aktif!==false);
  if(bugunPosts.length<2){el.style.display='none';return;}
  const enFire=[...bugunPosts].sort((a,b)=>(b.fire||0)-(a.fire||0))[0];
  const enYorum=[...bugunPosts].sort((a,b)=>b.comments.length-a.comments.length)[0];
  const top=[...new Map([[enFire.id,enFire],[enYorum.id,enYorum]]).values()];
  el.style.display='block';
  el.innerHTML='<div class="gun-baslik">// BUGÜNÜN EN İYİSİ</div>'
    +top.map((p,i)=>`<div class="gun-kart" onclick="document.querySelector('[data-pid=${p.id}]')?.scrollIntoView({behavior:'smooth',block:'center'})">
      <span class="gun-etiket">${i===0?'🔥 en çok beğeni':'💬 en çok yorum'}</span>
      <span class="gun-preview">${esc(p.text.slice(0,80))}${p.text.length>80?'…':''}</span>
      <span class="gun-meta">❤️ ${p.fire||0} · 💬 ${p.comments.length}</span>
    </div>`).join('');
}
function toggleComments(id){document.getElementById('c-'+id).classList.toggle('open');}
async function sendComment(id){
  if(!currentUser)return;
  const {data:banRow}=await sb.from('kullanicilar').select('banli').eq('nick',currentUser).maybeSingle();
  if(banRow?.banli){toast('// hesabın askıya alınmış');logout();return;}
  const inp=document.getElementById('ci-'+id);
  const val=inp.value.trim();if(!val)return;
  inp.value='';
  const p=posts.find(x=>x.id===id);
  if(p)addNotif(p.author,currentUser,p.type==='soru'?'💬 sorunuzu cevapladı':'💬 yorum yaptı');
  const ok=await sbComment(id,currentUser,val);
  if(ok){document.getElementById('c-'+id)?.classList.add('open');toast('// iletildi');}
}

// ── BİLDİRİMLER ──
function cleanOldNotifs(user){
  const cutoff=Date.now()-30*24*60*60*1000;
  const notifs=getNotifs(user).filter(n=>new Date(n.time).getTime()>cutoff);
  saveNotifs(user,notifs);
}
function addNotif(toUser,fromUser,action){
  if(!toUser||toUser===fromUser)return;
  const notifs=getNotifs(toUser);
  // Yinelenen bildirim engelle: aynı from+action 60 dk içinde tekrar gelmesin
  const recent=Date.now()-60*60*1000;
  const dup=notifs.find(n=>n.from===fromUser&&n.action===action&&new Date(n.time).getTime()>recent);
  if(dup)return;
  notifs.unshift({from:fromUser,action,time:new Date().toISOString(),read:false});
  if(notifs.length>50)notifs.pop();
  saveNotifs(toUser,notifs);
  if(toUser===currentUser)checkNotifDot();
}
function checkNotifDot(){
  if(!currentUser)return;
  const n=getNotifs(currentUser).filter(x=>!x.read).length;
  document.getElementById('notifDot').classList.toggle('show',n>0);
}
function openNotifs(){
  if(!currentUser)return;
  closePanels();
  const notifs=getNotifs(currentUser);
  const list=document.getElementById('notifList');
  if(!notifs.length){list.innerHTML='<div class="notif-empty">// henüz bildirim yok</div>';}
  else{
    list.innerHTML=notifs.map(n=>`<div class="notif-item${n.read?'':' unread'}"><div class="notif-text"><strong>@${esc(n.from)}</strong> ${esc(n.action)}</div><div class="notif-time">${relTime(n.time)}</div></div>`).join('');
    const updated=notifs.map(n=>({...n,read:true}));
    saveNotifs(currentUser,updated);
    document.getElementById('notifDot').classList.remove('show');
  }
  document.getElementById('notifPanel').classList.add('open');
  document.getElementById('panelOverlay').classList.add('open');
}

// ── ROZETLER ──
function getRozetler(myPosts,totalLikes){
  const r=[];
  if(myPosts.length>=1)r.push('🏛 ilk adım');
  if(myPosts.length>=5)r.push('✏️ aktif üye');
  if(myPosts.length>=15)r.push('🏗 sütun');
  if(myPosts.length>=30)r.push('🔥 usta');
  if(totalLikes>=10)r.push('❤️ sevilen');
  if(totalLikes>=50)r.push('⭐ popüler');
  if(totalLikes>=100)r.push('👑 efsane');
  const cevap=myPosts.filter(p=>p.comments.length>0&&p.type==='soru').length;
  if(cevap>=3)r.push('💡 yardımsever');
  return r;
}

// ── PROFİL ──
function openProfile(){
  if(!currentUser)return;
  closePanels();
  document.getElementById('profileNick').textContent=currentUser;
  const myPosts=posts.filter(p=>p.author===currentUser);
  const tF=myPosts.reduce((s,p)=>s+(p.fire||0),0);
  document.getElementById('profileStats').innerHTML=`
    <div class="panel-stat"><div class="panel-stat-num">${myPosts.length}</div><div class="panel-stat-label">gönderi</div></div>
    <div class="panel-stat"><div class="panel-stat-num">${tF}</div><div class="panel-stat-label">❤️ toplam</div></div>
    <div class="panel-stat"><div class="panel-stat-num">${myPosts.reduce((s,p)=>s+p.comments.length,0)}</div><div class="panel-stat-label">yorum aldı</div></div>`;
  const rozetler=getRozetler(myPosts,tF);
  document.getElementById('profileRozetler').innerHTML=rozetler.length
    ?rozetler.map(r=>`<span class="rozet">${r}</span>`).join('')
    :'<span style="font-family:Space Mono,monospace;font-size:.62rem;color:var(--muted)">// henüz rozet yok — gönderi at!</span>';
  document.getElementById('myPostsList').innerHTML=myPosts.length
    ?myPosts.map(p=>`<div class="my-post-mini">
      ${p.type?`<span style="font-family:Space Mono,monospace;font-size:.55rem;color:var(--muted)">${typeL[p.type]||p.type} · </span>`:''}
      <div class="my-post-mini-text">${esc(p.text)}</div>
      <div class="my-post-mini-meta"><span>❤️ ${p.fire||0}</span><span>↳ ${p.comments.length}</span><span>${relTime(p.time)}</span></div>
    </div>`).join('')
    :'<div style="font-family:Space Mono,monospace;font-size:.7rem;color:var(--muted);padding:1rem 0">// henüz gönderi yok</div>';
  document.getElementById('profilePanel').classList.add('open');
  document.getElementById('panelOverlay').classList.add('open');
  updatePushBtn();
}
function closePanels(){
  ['profilePanel','notifPanel','dmPanel'].forEach(id=>document.getElementById(id).classList.remove('open'));
  document.getElementById('panelOverlay').classList.remove('open');
}

// ── DM E2EE ──
async function deriveConvKey(nick1,nick2){
  const sorted=[nick1,nick2].sort().join(':');
  const raw=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(sorted+':duvar_dm_e2e_2026'));
  return crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt','decrypt']);
}
async function encryptDM(text,nick1,nick2){
  const key=await deriveConvKey(nick1,nick2);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const enc=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(text));
  const combined=new Uint8Array(iv.byteLength+enc.byteLength);
  combined.set(iv,0);combined.set(new Uint8Array(enc),iv.byteLength);
  return btoa(String.fromCharCode(...combined));
}
async function decryptDM(b64,nick1,nick2){
  try{
    const combined=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
    const iv=combined.slice(0,12),data=combined.slice(12);
    const key=await deriveConvKey(nick1,nick2);
    const dec=await crypto.subtle.decrypt({name:'AES-GCM',iv},key,data);
    return new TextDecoder().decode(dec);
  }catch{return b64;}// eski şifrelenmemiş mesaj fallback
}

// ── DM ──
let dmConversation=null;
async function sbGetDMs(){
  const {data}=await sb.from('mesajlar').select('*')
    .or(`gonderen.eq.${currentUser},alici.eq.${currentUser}`)
    .order('created_at',{ascending:true});
  return data||[];
}
async function sbSendDM(alici,metin){
  const sifreli=await encryptDM(metin,currentUser,alici);
  const {error}=await sb.from('mesajlar').insert({gonderen:currentUser,alici,metin:sifreli});
  return !error;
}
async function sbMarkRead(gonderen){
  await sb.from('mesajlar').update({okundu:true}).eq('gonderen',gonderen).eq('alici',currentUser).eq('okundu',false);
}
async function loadDMDot(){
  if(!currentUser)return;
  const {data}=await sb.from('mesajlar').select('id').eq('alici',currentUser).eq('okundu',false);
  document.getElementById('dmDot').classList.toggle('show',(data||[]).length>0);
}
async function openDMs(){
  if(!currentUser)return;
  dmConversation=null;
  closePanels();
  document.getElementById('dmPanelTitle').textContent='// MESAJLAR';
  const msgs=await sbGetDMs();
  // Konuşmaları grupla
  const convMap={};
  msgs.forEach(m=>{
    const other=m.gonderen===currentUser?m.alici:m.gonderen;
    if(!convMap[other])convMap[other]={last:m,unread:0};
    convMap[other].last=m;
    if(m.alici===currentUser&&!m.okundu)convMap[other].unread++;
  });
  const convs=Object.entries(convMap).sort((a,b)=>new Date(b[1].last.created_at)-new Date(a[1].last.created_at));
  const el=document.getElementById('dmContent');
  if(!convs.length){el.innerHTML='<div style="font-family:Space Mono,monospace;font-size:.7rem;color:var(--muted);padding:1.5rem 1rem">// henüz mesaj yok<br><br>Gönderilerdeki ✉ butonuna tıklayarak mesaj gönderebilirsin.</div>';
  }else{
    // Önizleme metinlerini şifre çöz
    const previews=await Promise.all(convs.map(([nick,{last}])=>{
      const other=last.gonderen===currentUser?last.alici:last.gonderen;
      return decryptDM(last.metin,currentUser,other);
    }));
    el.innerHTML='<div class="dm-panel-list">'+convs.map(([nick,{last,unread}],i)=>`
      <div class="dm-conv${unread?' unread':''}" onclick="openConversation('${esc(nick)}')">
        <div class="dm-conv-nick">@${esc(nick)}${unread?`<span class="dm-unread-dot"></span>`:''}</div>
        <div class="dm-conv-preview">${esc(previews[i])}</div>
      </div>`).join('')+'</div>';
  }
  document.getElementById('dmPanel').classList.add('open');
  document.getElementById('panelOverlay').classList.add('open');
  loadDMDot();
}
async function openConversation(nick){
  if(!currentUser)return;
  dmConversation=nick;
  if(!document.getElementById('dmPanel').classList.contains('open')){
    closePanels();
    document.getElementById('dmPanel').classList.add('open');
    document.getElementById('panelOverlay').classList.add('open');
  }
  document.getElementById('dmPanelTitle').textContent=`// @${nick}`;
  await sbMarkRead(nick);
  loadDMDot();
  const msgs=await sbGetDMs();
  const thread=msgs.filter(m=>(m.gonderen===currentUser&&m.alici===nick)||(m.gonderen===nick&&m.alici===currentUser));
  const el=document.getElementById('dmContent');
  // Mesajları şifre çözerek render et
  let threadHTML='';
  if(thread.length){
    const decrypted=await Promise.all(thread.map(m=>decryptDM(m.metin,currentUser,nick)));
    threadHTML=thread.map((m,i)=>`
      <div class="dm-msg ${m.gonderen===currentUser?'mine':'theirs'}">
        <div>${esc(decrypted[i])}</div>
        <div class="dm-msg-time">${relTime(m.created_at)}</div>
      </div>`).join('');
  }else{
    threadHTML='<div style="font-family:Space Mono,monospace;font-size:.7rem;color:var(--muted)">// henüz mesaj yok</div>';
  }
  el.innerHTML=`<button class="dm-back" onclick="openDMs()">← tüm mesajlar</button>
    <div class="dm-e2ee-badge">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
      uçtan uca şifreli
    </div>
    <div class="dm-thread" id="dmThread">${threadHTML}</div>
    <div class="dm-input-row">
      <input class="dm-input" id="dmInput" placeholder="mesajını yaz..." maxlength="300" onkeydown="if(event.key==='Enter')sendDM()">
      <button class="dm-send" onclick="sendDM()">GÖNDER</button>
    </div>`;
  const thread_el=document.getElementById('dmThread');
  if(thread_el)thread_el.scrollTop=thread_el.scrollHeight;
}
async function sendDM(){
  const inp=document.getElementById('dmInput');
  if(!inp||!dmConversation)return;
  const {data:banRow}=await sb.from('kullanicilar').select('banli').eq('nick',currentUser).maybeSingle();
  if(banRow?.banli){toast('// hesabın askıya alınmış');logout();return;}
  const val=inp.value.trim();if(!val)return;
  inp.value='';
  await sbSendDM(dmConversation,val);
  openConversation(dmConversation);
}

// ── REPORT ──
let reportTargetId=null,reportReason=null;
function openReport(id){reportTargetId=id;reportReason=null;document.querySelectorAll('.report-opt').forEach(o=>o.classList.remove('selected'));document.getElementById('reportModal').classList.remove('hidden');}
function closeReport(){document.getElementById('reportModal').classList.add('hidden');}
function selectReason(el,r){document.querySelectorAll('.report-opt').forEach(o=>o.classList.remove('selected'));el.classList.add('selected');reportReason=r;}
async function submitReport(){
  if(!currentUser){toast('// şikayet için giriş yap');closeReport();showAuth();return;}
  if(!reportReason){toast('// bir neden seç');return;}
  await sbReport(reportTargetId,reportReason,currentUser);
  reportedPosts.add(reportTargetId);
  localStorage.setItem('duvar_reported',JSON.stringify([...reportedPosts]));
  closeReport();toast('// bildirim alındı');render();
}

// ── TERMS / GUIDE ──
function openTerms(firstTime=false){
  document.getElementById('termsOverlay').classList.add('open');
  const btn=document.getElementById('termsCloseBtn');
  btn.textContent=firstTime?'OKUDUM, KABUL EDİYORUM →':'KAPAT';
  btn._firstTime=firstTime;
}
function closeTerms(){
  const btn=document.getElementById('termsCloseBtn');
  document.getElementById('termsOverlay').classList.remove('open');
  if(btn._firstTime){
    localStorage.setItem('duvar_terms','1');
    document.getElementById('authModal').classList.remove('hidden');
    btn._firstTime=false;
  }
}
function toggleCard(el){el.classList.toggle('open');}

// ── WELCOME ──
function dismissWelcome(){
  document.getElementById('welcomeScreen').classList.add('hidden');
  localStorage.setItem('duvar_welcomed','1');
  if(!localStorage.getItem('duvar_terms')){
    openTerms(true); // ilk ziyarette terms göster
  } else {
    document.getElementById('authModal').classList.remove('hidden');
  }
}

// ── ARAÇLAR: ALT SEKME ──
function switchArac(tab){
  ['sayac','juri','olcek','alan','bingo','fikir','yazilim','program2','palet','cv','ai'].forEach(t=>{
    document.getElementById('arac-'+t).classList.toggle('active',t===tab);
    document.getElementById('arac-tab-'+t).classList.toggle('active',t===tab);
  });
  if(tab==='sayac')renderSayac();
  if(tab==='alan')renderAlanProgram();
  if(tab==='bingo'&&!bingoKart.length)newBingo();
  if(tab==='yazilim')renderYazilim('autocad');
  if(tab==='program2')renderProgramSonuc();
  if(tab==='palet')renderPalet();
  if(tab==='cv')renderCvPreview();
  if(tab==='ai')renderAi('konsept');
}

// ── TESLİM SAYACI ──
const SAYAC_KEY='duvar_sayaclar';
function getSayaclar(){try{return JSON.parse(localStorage.getItem(SAYAC_KEY))||[];}catch{return[];}}
function saveSayaclar(s){localStorage.setItem(SAYAC_KEY,JSON.stringify(s));}

function sayacEkle(){
  const ad=document.getElementById('sayacAd').value.trim();
  const tarih=document.getElementById('sayacTarih').value;
  if(!ad||!tarih){toast('// ad ve tarih gir');return;}
  const sayaclar=getSayaclar();
  sayaclar.push({id:Date.now(),ad,tarih});
  saveSayaclar(sayaclar);
  document.getElementById('sayacAd').value='';
  document.getElementById('sayacTarih').value='';
  renderSayac();
  toast('// teslim eklendi');
}

function sayacSil(id){
  saveSayaclar(getSayaclar().filter(s=>s.id!==id));
  renderSayac();
}

function formatSayac(tarih){
  const diff=new Date(tarih)-Date.now();
  if(diff<=0)return{text:'TESLİM GEÇTİ',bitti:true,acil:false};
  const gun=Math.floor(diff/86400000);
  const sa=Math.floor((diff%86400000)/3600000);
  const dk=Math.floor((diff%3600000)/60000);
  const sn=Math.floor((diff%60000)/1000);
  const acil=diff<86400000;
  if(gun>0)return{text:`${gun} gün ${sa} sa ${dk} dk`,bitti:false,acil};
  return{text:`${sa} sa ${dk} dk ${sn} sn`,bitti:false,acil};
}

function renderSayac(){
  const el=document.getElementById('sayacList');
  if(!el)return;
  const sayaclar=getSayaclar();
  if(!sayaclar.length){
    el.innerHTML='<div class="sayac-empty">// henüz teslim eklenmedi — yukarıdan ekle</div>';
    return;
  }
  el.innerHTML=sayaclar.map(s=>{
    const f=formatSayac(s.tarih);
    const d=new Date(s.tarih);
    const tarihStr=d.toLocaleDateString('tr-TR',{day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'});
    return`<div class="sayac-card${f.acil?' acil':''}${f.bitti?' bitti':''}">
      <div class="sayac-name">${esc(s.ad)}</div>
      <div>
        <div class="sayac-display" data-id="${s.id}">${f.text}</div>
        <div class="sayac-date">${tarihStr}</div>
      </div>
      <button class="sayac-del" onclick="sayacSil(${s.id})">✕ sil</button>
    </div>`;
  }).join('');
}

// Sayaç canlı güncelle
setInterval(()=>{
  const sayaclar=getSayaclar();
  document.querySelectorAll('.sayac-display[data-id]').forEach(el=>{
    const id=parseInt(el.dataset.id);
    const s=sayaclar.find(x=>x.id===id);
    if(!s)return;
    const f=formatSayac(s.tarih);
    el.textContent=f.text;
    const card=el.closest('.sayac-card');
    if(card){
      card.classList.toggle('acil',f.acil);
      card.classList.toggle('bitti',f.bitti);
    }
  });
},1000);

// ── JÜRİ SİMÜLATÖRÜ ──
let juriType='genel';

const JURI_HAVUZ={
  genel:[
    {s:'Konseptini 3 cümleyle anlatır mısın?',t:'Açık ve net olmaya çalış. Jüri anlatımı tasarım kadar değerlendiriyor.'},
    {s:'Bu malzemeyi neden seçtin?',t:'Sadece estetik değil; yapısal, çevresel ve maliyet gerekçeleri hazırla.'},
    {s:'Strüktürel sistemi açıklar mısın?',t:'Yük aktarım yolunu net anlat. Kolon-kiriş mi, perde mi, karma mı?'},
    {s:'Doğal ışık tasarımında nasıl bir karar aldın?',t:'Gün boyu ışık değişimini düşün. Yön ve açıklık boyutu kritik.'},
    {s:'Yapıyı çevresiyle nasıl ilişkilendirdin?',t:'Bağlam analizi yaptıysan bunu göster. Yapmadıysan dürüst ol.'},
    {s:'Kullanıcı deneyimini nasıl kurguladın?',t:'Kullanıcı profilini tanımla. Hareket rotalarını anlat.'},
    {s:'En kritik tasarım kararın ne oldu, neden?',t:'Bu soruyu dürüstçe cevapla. Jüri özgünlüğü takdir eder.'},
    {s:'Sürdürülebilirlik açısından ne düşündün?',t:'Pasif sistemler, yön, malzeme ömrü veya enerji verimini anlat.'},
    {s:'Referans aldığın yapılar veya mimarlar var mı?',t:'Referans almak zayıflık değil. Ama "kopyaladım" gibi durma.'},
    {s:'Bu projede neyi farklı yapardın?',t:'Öz eleştiri yapabilmek güçlü bir tasarımcı işaretidir.'},
    {s:'Sirkülasyon kurgusunu açıklar mısın?',t:'Giriş, ana aks, çıkış, servis — hepsini mantıkla bağla.'},
    {s:'Maket ve çizimlerin tasarımı ne ölçüde yansıtıyor?',t:'Temsil araçlarını savunabilmen gerekiyor.'},
    {s:'Bu konsepti neden bu programa uyguladın?',t:'Konsept ile program arasındaki mantıksal bağı kur.'},
  ],
  konut:[
    {s:'Mahremiyet hiyerarşisi nasıl kurgulandı?',t:'Kamusal → yarı kamusal → özel geçişi açıkla.'},
    {s:'Ortak alan ile özel alan dengesi nasıl sağlandı?',t:'Paylaşımlı mekanlar ne kadar büyük, nerede konumlandı?'},
    {s:'Kullanıcı profili kimden oluşuyor, bunu tasarıma nasıl yansıttın?',t:'Tek kişi mi, aile mi, öğrenci mi? Mekan bunu hissettirmeli.'},
    {s:'Komşuluk ilişkileri nasıl ele alındı?',t:'Pencere-pencere karşılaşmaları düşünüldü mü?'},
    {s:'Depolama ve servis mekanları tasarlandı mı?',t:'Çoğu öğrenci bunu unutur. Mutfak depo, çamaşırlık, teknik hacim.'},
  ],
  kultur:[
    {s:'Ziyaretçi sirkülasyonu ile servis sirkülasyonu ayrıldı mı?',t:'Sergi, depo, teknik, personel — hepsinin ayrı yolu olmalı.'},
    {s:'Sergileme alanlarında doğal ışık kontrolü nasıl sağlandı?',t:'Doğrudan güneş ışığı eserlere zarar verir. Nasıl difüze ettin?'},
    {s:'Gece kullanımı ve etkinlik programı düşünüldü mü?',t:'Kültür yapıları çoğu zaman akşam daha yoğundur.'},
    {s:'Erişilebilirlik tasarıma nasıl entegre edildi?',t:'Engelli erişimi sonradan eklenen rampa olmamalı.'},
    {s:'Depolama ve konservasyon mekanları nerede?',t:'Sergi alanının en az 1/3ü kadar depo gerekir.'},
  ],
  ofis:[
    {s:'Bireysel ve grup çalışma modelleri nasıl destekleniyor?',t:'Açık ofis + odaklanma kabinleri + toplantı odaları dengesi.'},
    {s:'Esnek kullanım düşünüldü mü?',t:'Şirketler büyür veya küçülür. Duvarlar taşınabilir mi?'},
    {s:'Servis çekirdeğinin konumu neden burada?',t:'Kolon-çekirdek ilişkisi yapısal ve fonksiyonel açıdan açıklanmalı.'},
    {s:'Çalışan refahı için hangi kararlar alındı?',t:'Terrace, yeşil alan, kafeterya, dinlenme köşesi.'},
  ],
  egitim:[
    {s:'Öğrenci-öğretmen mekansal ilişkisi nasıl kurgulandı?',t:'Otorite mi, işbirliği mi? Bu fikir plana yansımalı.'},
    {s:'Kapasite hesabı yapıldı mı, acil tahliye düşünüldü mü?',t:'Sınıf başına öğrenci, kişi başına alan, çıkış sayısı.'},
    {s:'Dışarı ile bağlantı nasıl kuruldu?',t:'Avlu, bahçe, yarı açık mekan — eğitim yapılarının vazgeçilmezi.'},
    {s:'Farklı yaş grupları veya eğitim modelleri dikkate alındı mı?',t:'Anaokulu ile lise aynı mekan ihtiyacına sahip değil.'},
  ],
  saglik:[
    {s:'Steril ve kirli zonlama nasıl ayrıldı?',t:'Çapraz kontaminasyonu önlemek temel sağlık yapısı ilkesidir.'},
    {s:'Hasta sirkülasyonu ile personel sirkülasyonu ayrıldı mı?',t:'Acil, poliklinik, servis girişleri ayrı olmalı.'},
    {s:'Doğal ışık ve görünüm hasta odaları için nasıl ele alındı?',t:'Araştırmalar doğal ışığın iyileşmeyi hızlandırdığını gösteriyor.'},
    {s:'Hijyen protokolleri tasarıma nasıl yansıdı?',t:'Zemin-duvar köşeleri, kapı kolları, havalandırma.'},
  ],
  karma:[
    {s:'Farklı fonksiyonlar arasındaki çatışmalar nasıl çözüldü?',t:'Gürültü, koku, sirkülasyon çakışmaları var mı?'},
    {s:'Her fonksiyonun bağımsız girişi var mı?',t:'Karma kullanımda her program kendi saatinde çalışabilmeli.'},
    {s:'Karma kullanımın sinerjisini nasıl yarattın?',t:'1+1=3 yapabildin mi? Yoksa sadece yan yana koydun mu?'},
    {s:'Fonksiyonların birbirini etkilemesi tasarıma yansıdı mı?',t:'Aktif-pasif, gündüz-gece kullanım çiftleri düşün.'},
  ],
};

function selectJuriType(el,type){
  juriType=type;
  document.querySelectorAll('.juri-type').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
}

function juriUret(){
  const konsept=document.getElementById('juriKonsept').value.trim();
  const genel=[...JURI_HAVUZ.genel];
  const ozel=juriType!=='genel'?[...(JURI_HAVUZ[juriType]||[])]:[...JURI_HAVUZ.genel];
  // Karıştır
  const shuffle=a=>{for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
  shuffle(genel);shuffle(ozel);
  // 4 genel + 3 türe özel
  const secilen=[...genel.slice(0,4),...ozel.slice(0,3)];
  // Konseptten 1 özel soru üret
  if(konsept){
    const templates=[
      `"${konsept}" kavramını yapının hangi mekansal kararında en net hissedebiliyoruz?`,
      `"${konsept}" fikri cephe tasarımına nasıl yansıdı?`,
      `"${konsept}" konseptini ilk kez nasıl buldun, nasıl geliştirdi?`,
      `"${konsept}" ile bu program arasındaki ilişkiyi açıklar mısın?`,
    ];
    secilen.unshift({s:templates[Math.floor(Math.random()*templates.length)],t:'Konseptine özel bu soruyu güçlü cevapla — jüri burada seni dinliyor.'});
  }
  shuffle(secilen);
  document.getElementById('juriOutput').classList.add('show');
  document.getElementById('juriQuestions').innerHTML=secilen.slice(0,7).map((q,i)=>`
    <div class="juri-q" style="animation-delay:${i*.06}s">
      <span class="juri-qnum">${String(i+1).padStart(2,'0')} —</span>
      <div>
        <div class="juri-qtext">${esc(q.s)}</div>
        ${q.t?`<div class="juri-tip">${esc(q.t)}</div>`:''}
      </div>
    </div>`).join('');
  toast('// '+secilen.slice(0,7).length+' soru üretildi');
}

// ── MİMAR KARTLARI ──
var MIMARLAR=[
  {isim:'Le Corbusier',yillar:'1887–1965',akim:'Modernizm',soz:'"Ev yaşamak için bir makinedir."',yapi:'Villa Savoye',yapiAlt:'Poissy, Fransa · 1931',aciklama:'Modern mimarlığın 5 ilkesini tanımladı. Piloti, çatı bahçesi, serbest plan, şerit pencere, serbest cephe. Mimarlık eğitiminin olmazsa olmazı.',ulke:'İsviçre / Fransa',tags:[]},
  {isim:'Mies van der Rohe',yillar:'1886–1969',akim:'Modernizm',soz:'"Az çoktur."',yapi:'Barcelona Pavyonu',yapiAlt:'Barselona, İspanya · 1929',aciklama:'Saf geometri, cam ve çeliğin ustası. "Evrensel mekan" kavramıyla esnek, sütun destekli açık planı mimarlığa kazandırdı.',ulke:'Almanya / ABD',tags:[]},
  {isim:'Frank Lloyd Wright',yillar:'1867–1959',akim:'Organik Mimarlık',soz:'"Mimarlık doğanın insan dilidir."',yapi:'Şelale Evi (Fallingwater)',yapiAlt:'Pennsylvania, ABD · 1939',aciklama:'Yapıyı araziden koparmak yerine onunla bütünleştirdi. Prairie Style ve organik mimarlığın kurucusu.',ulke:'ABD',tags:[]},
  {isim:'Zaha Hadid',yillar:'1950–2016',akim:'Dekonstruktivizm / Parametrik',soz:'"Yönler her yöndedir."',yapi:'MAXXI Müzesi',yapiAlt:'Roma, İtalya · 2010',aciklama:'İlk Pritzker ödülü alan kadın mimar (2004). Keskin köşeleri ve akışkan formlarıyla mimarlık dilini dönüştürdü. Dijital üretimin öncüsü.',ulke:'Irak / İngiltere',tags:['pritzker']},
  {isim:'Tadao Ando',yillar:'1941–',akim:'Minimalizm / Eleştirel Bölgeselcilik',soz:'"Sessizlik bir konuşma biçimidir."',yapi:'Işık Kilisesi',yapiAlt:'Osaka, Japonya · 1989',aciklama:'Beton duvarlar, keskin geometri ve ışığın mekana sızdığı yarıklar. Japon kültürünü modernist dille buluşturdu. Pritzker 1995. Mimarlık okumadan mimarlık yaptı.',ulke:'Japonya',tags:['pritzker']},
  {isim:'Rem Koolhaas',yillar:'1944–',akim:'Çağdaş / Eleştirel',soz:'"Kentler üzerinde kontrol sahibi olamayız, onlarla müzakere ederiz."',yapi:'CCTV Merkezi',yapiAlt:'Pekin, Çin · 2012',aciklama:'OMA\'nın kurucusu. "Delirious New York" ile teorisyen, CCTV ile mühendis sınırlarını zorladı. Pritzker 2000. Mimarlığı kültürel eleştiri aracı olarak kullandı.',ulke:'Hollanda',tags:['pritzker']},
  {isim:'Frank Gehry',yillar:'1929–',akim:'Dekonstruktivizm',soz:'"Neden yapılar sıkıcı olmak zorunda?"',yapi:'Guggenheim Bilbao',yapiAlt:'Bilbao, İspanya · 1997',aciklama:'Titanium kaplı Guggenheim Bilbao şehri dönüştürdü. "Bilbao etkisi" kavramı ondan geliyor. Pritzker 1989. Formu özgürleştirdi, CAD\'i mimarlığa entegre etti.',ulke:'Kanada / ABD',tags:['pritzker']},
  {isim:'Renzo Piano',yillar:'1937–',akim:'Hi-Tech Mimarlık',soz:'"Güzellik bir amacın ürünüdür."',yapi:'Centre Pompidou',yapiAlt:'Paris, Fransa · 1977',aciklama:'Rogers ile birlikte Pompidou\'yu tasarladı — tüm strüktür ve mekanik dışarıda. Pritzker 1998. Hafiflik ve şeffaflık peşinde koşan bir mühendis-mimar.',ulke:'İtalya',tags:['pritzker']},
  {isim:'Peter Zumthor',yillar:'1943–',akim:'Fenomenolojik Mimarlık',soz:'"Mimarlık duyularla düşünmektir."',yapi:'Therme Vals',yapiAlt:'Vals, İsviçre · 1996',aciklama:'Az yapı, derin düşünce. Her projesinde malzeme, ışık ve sessizliğin mekana dönüşümünü araştırır. Pritzker 2009. "Atmosphere" kitabı tasarım eğitiminin temel metinlerinden.',ulke:'İsviçre',tags:['pritzker']},
  {isim:'Álvaro Siza',yillar:'1933–',akim:'Eleştirel Bölgeselcilik',soz:'"Hiçbir şey icat etmiyorum, onu dönüştürüyorum."',yapi:'Serralves Müzesi',yapiAlt:'Porto, Portekiz · 1999',aciklama:'Portekiz mimarlığını dünyaya açan isim. Arazi, ışık ve yerel kültürü modernizmin ustalığıyla buluşturur. Pritzker 1992. Serbest el çizimleri efsanedir.',ulke:'Portekiz',tags:['pritzker']},
  {isim:'Louis Kahn',yillar:'1901–1974',akim:'Modern Klasikçilik',soz:'"Tuğlaya ne olmak istediğini sor."',yapi:'Salk Enstitüsü',yapiAlt:'La Jolla, ABD · 1965',aciklama:'"Hizmet eden" ve "hizmet edilen" mekan ayrımıyla yapı organizasyonunu yeniden tanımladı. Işık ve ağırlığın şairi.',ulke:'ABD',tags:[]},
  {isim:'Alvar Aalto',yillar:'1898–1976',akim:'Organik Modernizm',soz:'"Mimarlık insanlık için bir sentez yapmalıdır."',yapi:'Paimio Sanatoryumu',yapiAlt:'Paimio, Finlandiya · 1933',aciklama:'Modernizmi insanileştirdi. Ahşap, doğal ışık ve ergonomik detaylarla soğuk fonksiyonalizme sıcaklık kattı. Finlandiya\'nın ulusal mimarı.',ulke:'Finlandiya',tags:[]},
  {isim:'Carlo Scarpa',yillar:'1906–1978',akim:'Zanaatkâr Mimarlık',soz:'"Detay bütünün içindedir."',yapi:'Castelvecchio Müzesi',yapiAlt:'Verona, İtalya · 1973',aciklama:'Tarihi yapıları yeni katmanlarla dönüştürmenin ustası. Her derzi, her bağlantıyı tasarladı. Mimarın elini en çok hissettiren isim.',ulke:'İtalya',tags:[]},
  {isim:'Kengo Kuma',yillar:'1954–',akim:'Çağdaş / Japon Gelenekçiliği',soz:'"Mimarlığı silmek istiyorum."',yapi:'Suntory Müzesi',yapiAlt:'Tokyo, Japonya · 2007',aciklama:'Yapıyı doğaya ve zemine yedirmeyi hedefler. Ahşap, bambu, taş ile geleneksel Japon estetiğini çağdaş yapılara taşıyor.',ulke:'Japonya',tags:[]},
  {isim:'SANAA / Kazuyo Sejima',yillar:'1956–',akim:'Minimal Çağdaş',soz:'"Mimarlık insanların arasındaki ilişkiler hakkındadır."',yapi:'Rolex Öğrenme Merkezi',yapiAlt:'Lozan, İsviçre · 2010',aciklama:'İnce çelik, saydam cam ve akışkan planlarla mekansal sınırları ortadan kaldırdı. Pritzker 2010.',ulke:'Japonya',tags:['pritzker']},
  {isim:'Bjarke Ingels',yillar:'1974–',akim:'Çağdaş / Pragmatik Ütopya',soz:'"Mimarlık hem hayalperest hem de pratik olabilir."',yapi:'8 House',yapiAlt:'Kopenhag, Danimarka · 2010',aciklama:'BIG (Bjarke Ingels Group) ile mimarlığı eğlenceli hale getirdi. Hedonist sürdürülebilirlik: iyi yaşam + iyi çevre.',ulke:'Danimarka',tags:[]},
  {isim:'Diébédo Francis Kéré',yillar:'1965–',akim:'Sürdürülebilir / Toplumsal Mimarlık',soz:'"Mimarlık bir toplumu inşa etme aracıdır."',yapi:'Gando İlköğretim Okulu',yapiAlt:'Gando, Burkina Faso · 2001',aciklama:'Köyü için burs toplayarak okul inşa etti. Yerel malzeme ve toplum katılımıyla sürdürülebilir mimarlığı yeniden tanımladı. Pritzker 2022.',ulke:'Burkina Faso',tags:['pritzker']},
  {isim:'Oscar Niemeyer',yillar:'1907–2012',akim:'Modernizm / Brezilya',soz:'"Düz çizgi beni ilgilendirmiyor — o insan elinin değil, Tanrı\'nın çizgisidir."',yapi:'Brezilya Ulusal Kongresi',yapiAlt:'Brasília, Brezilya · 1960',aciklama:'Le Corbusier\'in betonunu Latin Amerika\'nın kıvrımlarıyla buluşturdu. Başkent Brasília\'nın tamamını tasarladı. Pritzker 1988. 104 yıl yaşadı, son güne kadar çizdi.',ulke:'Brezilya',tags:['pritzker']},
  {isim:'Herzog & de Meuron',yillar:'1950– / 1950–',akim:'Çağdaş',soz:'"Yüzey gerçekliğin kendisidir."',yapi:'Tate Modern',yapiAlt:'Londra, İngiltere · 2000',aciklama:'Cepheyi bir bilgi katmanı olarak kullandılar. Eski Bankside Santrali\'ni Avrupa\'nın en çok ziyaret edilen müzesine dönüştürdüler. Pritzker 2001.',ulke:'İsviçre',tags:['pritzker']},
  {isim:'Sou Fujimoto',yillar:'1971–',akim:'Çağdaş Japon',soz:'"Mimarlık doğanın bir parçasıdır, doğayı taklit etmez."',yapi:'Serpentine Pavilion',yapiAlt:'Londra, İngiltere · 2013',aciklama:'Ağaç gibi büyüyen yapılar tasarlıyor. Sınırları bulanıklaştırmak, iç-dış ayrımını silmek onun temel meselesi.',ulke:'Japonya',tags:[]},
  {isim:'Balkrishna Doshi',yillar:'1927–2023',akim:'Eleştirel Bölgeselcilik / Sosyal Mimarlık',soz:'"Mimarlık yaşamı zenginleştirir."',yapi:'Aranya Konut Projesi',yapiAlt:'Indore, Hindistan · 1989',aciklama:'Le Corbusier ve Kahn ile çalışıp Hindistan\'a döndü. Düşük maliyetli konut ile yüksek mimari kaliteyi buluşturdu. Pritzker 2018.',ulke:'Hindistan',tags:['pritzker']},
  {isim:'Sedad Hakkı Eldem',yillar:'1908–1988',akim:'Türk Evi Geleneği / Modernizm',soz:'"Mimarinin özü dürüstlüktür."',yapi:'Sosyal Sigortalar Kurumu',yapiAlt:'İstanbul, Türkiye · 1963',aciklama:'Türk mimarlık kimliğini modern dünyaya taşımaya çalıştı. Geleneksel Türk evinin mekansal özelliklerini modernizm ile sentezledi.',ulke:'Türkiye',tags:[]},
  {isim:'Turgut Cansever',yillar:'1920–2009',akim:'İslam Geleneği / Bölgeselcilik',soz:'"Mimarlık varoluşun mekânsal ifadesidir."',yapi:'Arap Konutları',yapiAlt:'Bodrum, Türkiye · 1970ler',aciklama:'İslam mimarisinin felsefi derinliğini çağdaş yapılara aktardı. Ağa Han Mimarlık Ödülü\'nü üç kez kazandı.',ulke:'Türkiye',tags:[]},
  {isim:'Robert Venturi',yillar:'1925–2018',akim:'Postmodernizm',soz:'"Az can sıkıcıdır."',yapi:'Vanna Venturi Evi',yapiAlt:'Philadelphia, ABD · 1964',aciklama:'"Complexity and Contradiction in Architecture" ile modernizmin katı kurallarını sorguladı. Tarihsel referans ve ironiyi mimarlığa geri getirdi. Pritzker 1991.',ulke:'ABD',tags:['pritzker']},
  {isim:'Anne Lacaton',yillar:'1955–',akim:'Dönüşüm / Sosyal Mimarlık',soz:'"Asla yıkmayın."',yapi:'Tour Bois le Prêtre',yapiAlt:'Paris, Fransa · 2011',aciklama:'Lacaton & Vassal ile sosyal konut dönüşümünü yeniden tanımladı. Yıkmak yerine genişletmek. Sade malzeme, maksimum alan. Pritzker 2021.',ulke:'Fransa',tags:['pritzker']},
  // Pritzker ağırlıklı yeni eklemeler
  {isim:'Philip Johnson',yillar:'1906–2005',akim:'Modernizm / Postmodernizm',soz:'"Mimarlık sanat değil, sanatın babası."',yapi:'Glass House',yapiAlt:'New Canaan, ABD · 1949',aciklama:'Pritzker\'in ilk sahibi (1979). Mies ile çalışıp ona saygıyla ihanet etti — Modernizm\'den Postmodernizm\'e geçiş köprüsü. Tam şeffaf Glass House hâlâ ders kitaplarında.',ulke:'ABD',tags:['pritzker']},
  {isim:'I.M. Pei',yillar:'1917–2019',akim:'Modernizm / Geometrik',soz:'"İyi mimarlık, olduğu yerle konuşur."',yapi:'Louvre Piramidi',yapiAlt:'Paris, Fransa · 1989',aciklama:'Camdan piramit ile Louvre\'u çağdaş bir deneyime dönüştürdü. Pritzker 1983. Tarihi ve moderniyi buluşturma sanatında eşsiz. Bank of China Tower da ayrı bir ders.',ulke:'Çin / ABD',tags:['pritzker']},
  {isim:'Jean Nouvel',yillar:'1945–',akim:'Çağdaş / Kavramsal',soz:'"Her proje, yeni bir soru sormaktır."',yapi:'Arap Dünyası Enstitüsü',yapiAlt:'Paris, Fransa · 1987',aciklama:'Mekanik güneş ızgarası ile Paris\'te devrim yarattı. Pritzker 2008. Torre Agbar (Barcelona), Fondation Cartier... Her yapı farklı bir malzeme dili konuşuyor.',ulke:'Fransa',tags:['pritzker']},
  {isim:'Toyo Ito',yillar:'1941–',akim:'Çağdaş / Dijital',soz:'"Mimarlık, hareketli bir beden ile sabit bir kabuk arasındaki diyalogdur."',yapi:'Sendai Mediatheque',yapiAlt:'Sendai, Japonya · 2001',aciklama:'Boru kolonlar ve katmanlar arasındaki mekansal akış ile strüktürü yeniden tanımladı. Pritzker 2013. Mimarlık eğitimindeki her strüktür dersinde adı geçer.',ulke:'Japonya',tags:['pritzker']},
  {isim:'Shigeru Ban',yillar:'1957–',akim:'Sürdürülebilir / Acil Durum',soz:'"Mimarlık herkese hizmet etmek zorundadır."',yapi:'Cardboard Cathedral',yapiAlt:'Christchurch, Yeni Zelanda · 2013',aciklama:'Kâğıt tüp ve kartondan acil durum barınaklarına uzanan kariyer. Pritzker 2014. Deprem, sel ve savaş bölgelerinde ücretsiz çalışıyor. Malzeme sınırları zorluyor.',ulke:'Japonya',tags:['pritzker']},
  {isim:'Alejandro Aravena',yillar:'1967–',akim:'Sosyal / Katılımcı',soz:'"Mimarlık, kaynakları en iyi biçimde dağıtma sanatıdır."',yapi:'Quinta Monroy Konutları',yapiAlt:'Iquique, Şili · 2004',aciklama:'"Yarım ev" modeli: Elemental ile devlet bütçesine sığacak, sakinlerin tamamlayabileceği konutlar tasarladı. Pritzker 2016. Mimarlığın sosyal sorumluluk boyutunun güncel sesi.',ulke:'Şili',tags:['pritzker']},
  {isim:'David Chipperfield',yillar:'1953–',akim:'Çağdaş / Arındırılmış',soz:'"Bağlam olmadan form anlamsızdır."',yapi:'Neues Museum Restorasyon',yapiAlt:'Berlin, Almanya · 2009',aciklama:'Tarihi ile modernin titiz diyaloğu. Neues Museum restorasyonuyla yaraları sakladı değil, gösterdi. Pritzker 2023. İnce, sessiz, sağlam bir dil.',ulke:'İngiltere',tags:['pritzker']},
  {isim:'Aldo Rossi',yillar:'1931–1997',akim:'Neorasyon / Yeni Rasyonalizm',soz:'"Şehir, kolektif belleğin deposudur."',yapi:'San Cataldo Mezarlığı',yapiAlt:'Modena, İtalya · 1984',aciklama:'"The Architecture of the City" ile kentsel tipoloji teorisini kurdu. Pritzker 1990. Form ve hafıza üzerine sorgulayıcı yeni rasyonalizmin sesi. Mimarisi ürkütücü ve anlamlı.',ulke:'İtalya',tags:['pritzker']},
  // ── TÜRK MİMARLAR ──
  {isim:'Mimar Kemaleddin',yillar:'1870–1927',akim:'Birinci Ulusal Mimarlık Akımı',soz:'"Bir milletin mimarisi, onun kimliğinin taşıyıcısıdır."',yapi:'Vakıf Han',yapiAlt:'İstanbul, Türkiye · 1926',aciklama:'Osmanlı-Selçuklu geleneğini Cumhuriyet yapılarına taşıyan Birinci Ulusal Mimarlık Akımı\'nın öncüsü. Alman Charlottenburg Politeknik mezunu. Ankara\'nın kuruluş dönemindeki pek çok devlet yapısını tasarladı. Tarihi dokuyu modern programla buluşturma çabasının simgesi.',ulke:'Türkiye',tags:[]},
  {isim:'Vedat Tek',yillar:'1873–1942',akim:'Ulusal Romantizm / Osmanlı Rönesansı',soz:'"Batı\'yı öğren; ama kim olduğunu unutma."',yapi:'İstanbul Büyük Postane',yapiAlt:'Sirkeci, İstanbul · 1909',aciklama:'Paris Ecole des Beaux-Arts mezunu ilk Türk mimar. Osmanlı süsleme anlayışını Batı yapım tekniğiyle birleştirdi. Büyük Postane bugün hâlâ kullanımda — 100 yıl sonra bile görkemini koruyor.',ulke:'Türkiye',tags:[]},
  {isim:'Hayati Tabanlıoğlu',yillar:'1927–1993',akim:'Türk Modernizmi',soz:'"Mimarlık toplumla barışık olmalıdır."',yapi:'Atatürk Kültür Merkezi (AKM)',yapiAlt:'Taksim, İstanbul · 1969',aciklama:'Türkiye\'nin en simgesel çağdaş kamusal yapısını tasarladı. AKM, Taksim Meydanı\'nın yüzü haline geldi. Tabanlıoğlu Mimarlık hanedanının kurucusu. Modern Türk mimarlığının kurucu isimlerinden.',ulke:'Türkiye',tags:[]},
  {isim:'Behruz Çinici',yillar:'1932–',akim:'Brütalizm / Kampüs Mimarlığı',soz:'"Üniversite, kendini mekânıyla da inşa eder."',yapi:'ODTÜ Kampüsü',yapiAlt:'Ankara, Türkiye · 1961–',aciklama:'Can Çinici ile birlikte tasarladığı ODTÜ kampüsü, Türk mimarlık tarihinin en kapsamlı ve özgün brütalist külliyesi. Ağa Han Mimarlık Ödülü sahibi. ODTÜ\'deki her adımda Çinici\'nin izini görürsün.',ulke:'Türkiye',tags:[]},
  {isim:'Cengiz Bektaş',yillar:'1934–2020',akim:'Vernakular / Anadolu Geleneği',soz:'"En iyi mimar, toprağı ve insanı dinleyendir."',yapi:'Ula Köyü Yapıları',yapiAlt:'Muğla, Türkiye · 1970ler–',aciklama:'Anadolu\'nun geleneksel yapı kültürünü belgeleyen ve yaşatan mimar-yazar. Yazıları nesillere rehber oldu. Mimarlığı kimlik, yer ve toplumsal bellek meselesi olarak gördü. Bodrum ve Ege kıyısındaki konut projeleriyle tanınır.',ulke:'Türkiye',tags:[]},
  {isim:'Han Tümertekin',yillar:'1958–',akim:'Eleştirel Minimalizm',soz:'"Az malzeme, dürüst yapı, güçlü yer."',yapi:'B2 Evi',yapiAlt:'Büyükada, İstanbul · 2003',aciklama:'Ağa Han Mimarlık Ödülü 2004 ile uluslararası arenaya çıktı. Coğrafyaya saygılı, minimal malzemeli yapıları ile Türk mimarlığının çağdaş sesi. Doğa ile dürüst diyalog onun imzası.',ulke:'Türkiye',tags:[]},
  {isim:'Emre Arolat',yillar:'1963–',akim:'Çağdaş / Bağlamsal',soz:'"Mimarlık, bir yere ait olmakla başlar."',yapi:'Sancaklar Camii',yapiAlt:'Büyükçekmece, İstanbul · 2013',aciklama:'EAA (Emre Arolat Architecture) ile uluslararası ölçekte tanındı. Toprağa gömülü Sancaklar Camii, geleneksel cami tipini radikal biçimde yeniden yorumladı; dünya basınında büyük yankı uyandırdı. Türk mimarisi için yeni bir ses.',ulke:'Türkiye',tags:[]},
  {isim:'Murat Tabanlıoğlu',yillar:'1966–',akim:'Çağdaş / Kamusal Mimarlık',soz:'"Mimarlık şehrin hafızasını kurar."',yapi:'Zorlu Center',yapiAlt:'Beşiktaş, İstanbul · 2013',aciklama:'Tabanlıoğlu Mimarlık\'ın ikinci kuşak temsilcisi. Zorlu Center ile İstanbul\'un karma kullanım mimarisini dönüştürdü. AKM yenileme projesinin mimarı. Türk mimarlığını küresel sahnede temsil eden isim.',ulke:'Türkiye',tags:[]},
];

var mimarAkim='tümü';

function renderMimarlar(){
  if(!MIMARLAR||!MIMARLAR.length)return; // henüz initialize olmadıysa bekle
  const filtersEl=document.getElementById('mimarFilters');
  const statsEl=document.getElementById('mimarStats');
  const gridEl=document.getElementById('mimarGrid');
  if(!gridEl)return;

  // Filtre butonlarını yalnızca ilk kez oluştur
  if(!filtersEl.innerHTML){
    const akimlar=['tümü','🏆 pritzker','Modernizm','Organik Mimarlık','Dekonstruktivizm','Parametrik','Minimal','Hi-Tech','Çağdaş','Postmodernizm','Sürdürülebilir','Türkiye'];
    filtersEl.innerHTML=akimlar.map(a=>`<button class="mimar-filter${a==='tümü'?' active':''}" onclick="setMimarAkim('${a}',this)">${a}</button>`).join('');
  }

  var liste=MIMARLAR;
  if(mimarAkim!=='tümü'){
    if(mimarAkim==='🏆 pritzker'){
      liste=MIMARLAR.filter(m=>m.tags&&m.tags.includes('pritzker'));
    } else {
      liste=MIMARLAR.filter(m=>{
        const lower=mimarAkim.toLowerCase();
        return m.akim.toLowerCase().includes(lower)||m.ulke.toLowerCase().includes(lower);
      });
    }
  }
  statsEl.textContent=liste.length+' mimar'+(mimarAkim!=='tümü'?' · filtrelendi':'');
  gridEl.innerHTML=liste.map((m,i)=>`
    <div class="mimar-card-wrap" onclick="this.classList.toggle('flipped')" style="animation-delay:${Math.min(i,8)*.04}s;animation:slideIn .3s ease both">
      <div class="mimar-card-inner">
        <div class="mimar-front">
          <div>
            <div class="mimar-akım">${esc(m.akim)}</div>
            <div class="mimar-isim">${esc(m.isim)}${m.tags&&m.tags.includes('pritzker')?'<span class="pritzker-badge">🏆 Pritzker</span>':''}</div>
            <div class="mimar-yillar">${esc(m.yillar)} · ${esc(m.ulke)}</div>
          </div>
          <div class="mimar-soz">"${esc(m.soz.replace(/"/g,''))}"</div>
          <div class="mimar-hint">// çevir →</div>
        </div>
        <div class="mimar-back">
          <div>
            <div class="mimar-back-akım">// en önemli yapı</div>
            <div class="mimar-yapi">${esc(m.yapi)}</div>
            <div class="mimar-yapi-alt">${esc(m.yapiAlt)}</div>
          </div>
          <div class="mimar-aciklama">${esc(m.aciklama)}</div>
          <div class="mimar-ulke">← geri</div>
        </div>
      </div>
    </div>`).join('');
}

function setMimarAkim(akim,el){
  mimarAkim=akim;
  document.querySelectorAll('.mimar-filter').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
  renderMimarlar();
}

// ── SÖZLÜK ──
const SOZLUK=[
  // TEKNİK
  {tr:'Rölöve',en:'Survey Drawing',cat:'teknik',def:'Mevcut bir yapının veya alanın yerinde ölçülerek hazırlanan ölçekli çizimi. Restorasyon projelerinin ilk adımı.',not:'Rölöve olmadan restorasyon olmaz. Doğru ölçüm, doğru proje demektir.',ornek:'"Rölöve çizimini bitirdin mi?" — tarihi yapı dersinin ilk ödevi'},
  {tr:'Restitüsyon',en:'Restitution',cat:'teknik',def:'Bir yapının özgün haline dair hipotezi belgeleyen, araştırmaya dayalı çizim ve rapor çalışması.',not:'Restitüsyon "tahmin" değil, kanıta dayalı yeniden kurgulamadır.'},
  {tr:'Restorasyon',en:'Restoration',cat:'teknik',def:'Tarihi yapının özgün niteliklerini koruyarak onarılması ve işlevlendirilmesi süreci.',not:'Restorasyon; eklemek değil, var olanı yaşatmaktır.'},
  {tr:'Plan',en:'Floor Plan',cat:'teknik',def:'Yapının yatay bir düzlemde, genellikle döşemeden ~1.2m yukarıdan kesilmiş yatay kesit çizimi.',not:'Plan en temel mimari çizimdir. Her şey plandan başlar.',ornek:'"Planı 1/50 çiz" — öğrenci projelerinde standart sunum ölçeği'},
  {tr:'Kesit',en:'Section',cat:'teknik',def:'Yapının dikey bir düzlemde kesilmesiyle elde edilen iç mekan ve strüktür çizimi.',ornek:'"Merdivenden geçen bir kesit al" — iç mekan yüksekliklerini göstermek için'},
  {tr:'Cephe / Görünüş',en:'Elevation / Façade',cat:'teknik',def:'Yapının dışarıdan, düz bir açıyla bakıldığında görünen yüzeyinin ortogonal çizimi.',not:'Cephe hem teknik çizim hem tasarım kararıdır.'},
  {tr:'Aksonometri',en:'Axonometric',cat:'teknik',def:'Üç boyutlu bir objeyi ölçek kaybetmeden göstermek için kullanılan paralel projeksiyon çizim tekniği.',ornek:'"Akso çiz, jüriye hacmi göster" — perspektife göre daha teknik görünür'},
  {tr:'Perspektif',en:'Perspective',cat:'teknik',def:'Yapıyı veya mekanı insan gözüne yakın biçimde gösteren, kaçış noktalı üç boyutlu çizim.',not:'Teknik açıdan perspektif "yanlış" boyutlara sahiptir — ama en çok anlatan çizimdir.'},
  {tr:'Detay',en:'Detail Drawing',cat:'teknik',def:'Yapı elemanlarının bağlantı ve yapım bilgilerini büyük ölçekte (1/5, 1/10, 1/20) gösteren teknik çizim.',ornek:'"Alçıpan-cam bağlantısını detaylandır" — bitirme projelerinde şart'},
  {tr:'Ölçek',en:'Scale',cat:'teknik',def:'Çizimde gösterilen boyutun gerçek boyuta oranı. 1/100 = gerçeğin yüzde biri.',ornek:'"Bu çizim hangi ölçekte?" — jüride mutlaka sorulan soru'},
  {tr:'TAKS',en:'Ground Floor Area Ratio',cat:'teknik',def:'Taban Alanı Kat Sayısı. Yapının oturduğu alanın arsa alanına oranı. İmar planında belirlenir.',not:'TAKS=0.40 ise arsanın en fazla %40ına bina oturabilir.'},
  {tr:'KAKS / Emsal',en:'Floor Area Ratio (FAR)',cat:'teknik',def:'Kat Alanı Kat Sayısı. Toplam inşaat alanının arsa alanına oranı.',ornek:'"Emsal 2.0 ise 500m² arsaya 1000m² inşaat yapılabilir"'},
  {tr:'Gabari',en:'Building Envelope / Height Limit',cat:'teknik',def:'İmar mevzuatında belirlenen maksimum yapı yüksekliği ve hacmini tanımlayan sınır.',not:'Gabari aşımı ruhsat iptali demektir.'},
  {tr:'Aplikasyon',en:'Staking Out',cat:'teknik',def:'Projedeki yapının, arazinin gerçek koordinatlarına işaretlenerek yerleştirilmesi işlemi.',not:'İnşaata başlamadan önce yapılması zorunludur.'},
  {tr:'Kotaj',en:'Dimensioning',cat:'teknik',def:'Çizimlere ölçü ve yükseklik bilgilerinin eklenmesi işlemi.',ornek:'"Kotajlar eksik, ölçüleri yaz" — hoca değerlendirmesi'},
  {tr:'Pafta',en:'Drawing Sheet',cat:'teknik',def:'Mimari çizimlerin üzerine yapıldığı standart boyutlu çizim kağıdı (A0, A1, A2 vb.).',ornek:'"Sunumu A1 paftaya sığdır"'},
  {tr:'Ruhsat',en:'Building Permit',cat:'teknik',def:'Belediyeden alınan, yapı inşaatına başlamayı yasal olarak mümkün kılan resmi izin belgesi.'},
  // TASARIM
  {tr:'Konsept',en:'Concept',cat:'tasarim',def:'Tasarımın arkasındaki temel fikir, kavram veya yönlendirici düşünce. Projenin "neden"ine cevap verir.',not:'Güçlü bir konsept olmadan tasarım yönsüz kalır. Jüri her zaman konsepti sorar.',ornek:'"Konseptin nedir?" — jürideki en sık soru'},
  {tr:'Program',en:'Architectural Program / Brief',cat:'tasarim',def:'Projenin barındırması gereken fonksiyonları, alanları ve ilişkilerini tanımlayan ihtiyaç listesi.',not:'Program olmadan tasarıma başlamak temelsiz bina inşa etmek gibidir.'},
  {tr:'Sirkülasyon',en:'Circulation',cat:'tasarim',def:'Yapı içindeki ve çevresindeki insan, araç veya hizmet hareketinin organizasyonu ve akış şeması.',ornek:'"Servis sirkülasyonu ile misafir sirkülasyonunu ayır"'},
  {tr:'Strüktür',en:'Structure',cat:'tasarim',def:'Yapının yüklerini taşıyan ve aktaran taşıyıcı sistem. Kolon-kiriş, çelik çerçeve, kabuk vb.',not:'Strüktür tasarımı şekillendirir. Mimarlık ve strüktür ayrılmaz.'},
  {tr:'Bağlam / Kontekst',en:'Context',cat:'tasarim',def:'Yapının içinde yer aldığı fiziksel, kültürel, tarihi ve sosyal çevre. Tasarımın cevap verdiği dış koşullar.',not:'Bağlamı okuyan tasarım "yer"e aittir; okumayan ise her yerde olabilir.'},
  {tr:'Oran',en:'Proportion',cat:'tasarim',def:'Bir tasarım içindeki elemanların birbirleriyle ve bütünle olan boyutsal ilişkisi.',ornek:'"Pencere oranları cepheyle uyumsuz" — hoca değerlendirmesi'},
  {tr:'Hiyerarşi',en:'Hierarchy',cat:'tasarim',def:'Tasarım içindeki elemanların önem, boyut veya konum bakımından kademeli düzenlenmesi.',ornek:'"Ana giriş hiyerarşik olarak öne çıkmıyor"'},
  {tr:'Mekan',en:'Space',cat:'tasarim',def:'Sınırlandırılmış, algılanabilir ve deneyimlenebilir üç boyutlu boşluk. Mimarlığın asıl ürünü.',not:'"Mimarlık duvarlar değil, aralarındaki mekandır." — antik söz'},
  {tr:'Kütle',en:'Mass / Volume',cat:'tasarim',def:'Yapının dış dünyaya sunduğu üç boyutlu hacimsel form. Planın değil, hacmin ifadesi.',ornek:'"Kütle çalışmasını maketlemeden önce SketchUp\'ta dene"'},
  {tr:'Aks / Eksen',en:'Axis',cat:'tasarim',def:'Tasarımda düzeni ve simetriyi organize eden soyut doğrusal referans çizgisi.',ornek:'"Ana aks boyunca kapıları hizala"'},
  {tr:'Şeffaflık',en:'Transparency',cat:'tasarim',def:'Hem fiziksel (cam, açıklık) hem kavramsal (katmanların okunabilirliği) anlamda kullanılan tasarım ilkesi.',not:'Le Corbusier\'in "fenomenal şeffaflık" kavramı mimarlık teorisinin köşe taşlarından.'},
  {tr:'Fenomonoloji',en:'Phenomenology',cat:'tasarim',def:'Mimarlıkta mekanın bedensel ve duyusal deneyimine odaklanan teorik yaklaşım.',not:'Peter Zumthor ve Juhani Pallasmaa bu alanın önemli isimleri.'},
  {tr:'Tipoloji',en:'Typology',cat:'tasarim',def:'Benzer plan, form veya fonksiyon özelliklerine göre yapıları sınıflandıran kavramsal çerçeve.',ornek:'"Bu yapı avlulu konut tipolojisine giriyor"'},
  {tr:'Sürdürülebilirlik',en:'Sustainability',cat:'tasarim',def:'Çevresel, ekonomik ve sosyal kaynakları tüketmeden ihtiyaçları karşılayan tasarım yaklaşımı.',not:'Artık her projede sorgulanıyor. Pasif sistemler, yenilenebilir enerji, yeşil çatı.'},
  // MALZEME
  {tr:'Betonarme',en:'Reinforced Concrete',cat:'malzeme',def:'Çelik donatı ile güçlendirilmiş beton yapı malzemesi. Türkiye\'deki yapıların büyük çoğunluğu betonarme.',not:'Basınca dayanıklı beton + çekmeye dayanıklı çelik = betonarme.'},
  {tr:'Perde Duvar',en:'Curtain Wall',cat:'malzeme',def:'Hem hafif cam-metal cephe sistemi anlamında hem de betonarmede yatay yükleri taşıyan düşey perde eleman.',not:'İki farklı anlamı var — bağlama dikkat et.'},
  {tr:'Alüminyum Kompozit',en:'Aluminum Composite Panel (ACP)',cat:'malzeme',def:'İki alüminyum tabaka arasına yerleştirilmiş polietilen çekirdekli hafif cephe kaplama paneli.',ornek:'"Cepheyi alüminyum kompozit kapla" — hızlı ve ekonomik çözüm'},
  {tr:'Polikarbonat',en:'Polycarbonate',cat:'malzeme',def:'Işık geçirgen, hafif, çift cidarlı plastik levha. Atölye, sera ve geçici yapılarda yaygın.',ornek:'"Çatıyı polikarbonat yap, doğal ışık alsın"'},
  {tr:'EPDM',en:'EPDM Membrane',cat:'malzeme',def:'Düz çatılarda su yalıtımı için kullanılan sentetik kauçuk membran.',not:'Düz çatı tasarlarsan su yalıtımını unutursan hoca sormadan geçmez.'},
  {tr:'Doğal Taş',en:'Natural Stone',cat:'malzeme',def:'Kesme veya yarma yoluyla işlenmiş granit, mermer, traverten, bazalt gibi yapı ve kaplama malzemeleri.',not:'Ağırdır, pahalıdır ama devamlıdır. Sürdürülebilirlik tartışmalarında yeniden önem kazandı.'},
  {tr:'Ahşap Kaplama',en:'Timber Cladding',cat:'malzeme',def:'Yapı dış veya iç yüzeylerinde kullanılan ağaç kökenli kaplama elemanları.',ornek:'"Cepheye ipe ahşabı dene, iklime dayanıklı"'},
  {tr:'Yalıtım',en:'Insulation',cat:'malzeme',def:'Enerji kaybını ve ses geçişini azaltmak için kullanılan taş yünü, cam yünü, EPS gibi malzemeler.',not:'Binalarda ısı köprüsü oluşturmadan doğru detaylandırmak kritik.'},
  // YAZILIM
  {tr:'AutoCAD',en:'AutoCAD',cat:'yazilim',def:'2D teknik çizim için endüstri standardı vektör çizim yazılımı. Mimarlıkta plan, kesit, detay çizimlerinde kullanılır.',not:'Kısayolları ezber: L (line), C (circle), TR (trim), EX (extend), O (offset), M (move), CO (copy).',ornek:'"AutoCAD\'de layer yönetimi yapmazsan çizimler karmakarışık olur"'},
  {tr:'SketchUp',en:'SketchUp',cat:'yazilim',def:'Hızlı 3D kütle ve form çalışması için kullanılan, öğrenmesi kolay modelleme yazılımı.',not:'1. ve 2. yıl için yeterli. Kompleks geometrilerde yetersiz kalır.',ornek:'"Hızlı bir kütle çalışması için SketchUp aç"'},
  {tr:'Revit',en:'Revit',cat:'yazilim',def:'BIM (Yapı Bilgi Modellemesi) tabanlı, tüm mimari çizimlerin tek modelden üretildiği Autodesk yazılımı.',not:'İlk yıl için erken. 3-4. yıl veya stajda öğren. Şirketlerde standart.',ornek:'"Revit öğrenmek istiyorum" — o zaman YouTube\'dan başla, kurs para tutar'},
  {tr:'Rhino',en:'Rhinoceros 3D',cat:'yazilim',def:'NURBS tabanlı, kompleks ve organik geometrileri modellemek için kullanılan 3D yazılım.',not:'Grasshopper ile birlikte parametrik tasarımın kapısını açar.'},
  {tr:'Grasshopper',en:'Grasshopper',cat:'yazilim',def:'Rhino içinde çalışan görsel programlama arayüzü. Algoritmik ve parametrik tasarım için kullanılır.',not:'Kod yazmayı bilmesen de mantığını kavramak artık mimarlıkta avantaj.',ornek:'"Grasshopper\'da cephe modülü kurdum" — jüride etkileyici'},
  {tr:'V-Ray',en:'V-Ray',cat:'yazilim',def:'Fotorealistik render üretmek için kullanılan ışık simülasyonlu render motoru. Revit, SketchUp, Rhino ile çalışır.',not:'Render kalitesi malzeme ve ışık ayarına bağlı, yazılımdan çok bilgiye.',ornek:'"V-Ray render 3 saat sürdü, sabahladım"'},
  {tr:'Lumion',en:'Lumion',cat:'yazilim',def:'Mimarlık projeleri için hızlı, gerçek zamanlı render ve animasyon yazılımı.',not:'V-Ray\'den hızlı ama daha az gerçekçi. Sunum videoları için iyi.'},
  {tr:'InDesign',en:'Adobe InDesign',cat:'yazilim',def:'Mimari sunum paftaları ve portfolyo tasarımı için kullanılan sayfa düzeni yazılımı.',not:'Pafta düzeni için Word veya PowerPoint kullanma. Hocalar fark eder.',ornek:'"Paftaları InDesign\'da topla, PDF\'e aktar"'},
  {tr:'Enscape',en:'Enscape',cat:'yazilim',def:'Revit, SketchUp ve Rhino ile entegre çalışan gerçek zamanlı render ve sanal gerçeklik aracı.',not:'Tek tuşla VR deneyimi sunar. Müşteri sunumlarında giderek yaygınlaşıyor.',ornek:'"Enscape\'le yürüyüş videosu çek, jüriye göster"'},
  {tr:'Twinmotion',en:'Twinmotion',cat:'yazilim',def:'Epic Games tarafından geliştirilen mimarlık ve kentsel tasarım için gerçek zamanlı 3D görselleştirme yazılımı.',not:'Ücretsiz sürümü öğrenciler için yeterli. Unreal Engine tabanlı.'},
  {tr:'Blender',en:'Blender',cat:'yazilim',def:'Açık kaynaklı 3D modelleme, animasyon ve render yazılımı. Mimarlıkta görselleştirme ve sunum animasyonları için kullanılır.',not:'Ücretsiz ve güçlü. Cycles/EEVEE render motorlarıyla giderek mimarlıkta da tercih ediliyor.',ornek:'"Blender\'da izometrik sunum çizdim" — sosyal medyada trend'},
  {tr:'3ds Max',en:'3D Studio Max',cat:'yazilim',def:'Autodesk\'in 3D modelleme ve render yazılımı. V-Ray ile kombinasyonu endüstri standardıdır.',not:'Fotorealistik iç mekan görseli üretiminde hâlâ çok yaygın.'},
  {tr:'ArchiCAD',en:'ArchiCAD',cat:'yazilim',def:'Graphisoft tarafından geliştirilen BIM tabanlı mimari tasarım yazılımı. Revit\'in alternatifi.',not:'Avrupa\'da yaygın, Türkiye\'de az kullanılır ama öğrenmesi nispeten kolaydır.'},
  {tr:'QGIS',en:'QGIS',cat:'yazilim',def:'Açık kaynaklı coğrafi bilgi sistemi yazılımı. Kentsel analiz, arazi etüdü ve harita üretiminde kullanılır.',not:'Kentsel tasarım ve peyzaj projelerinde altın değerinde. Ücretsiz.'},
  {tr:'Photoshop',en:'Adobe Photoshop',cat:'yazilim',def:'Görsel düzenleme ve sunum görseli üretimi için kullanılan standart yazılım. Render sonrası post-prodüksiyonun temelidir.',ornek:'"Renderi Photoshop\'ta bitir — insanları ekle, gölgeleri yumuşat"'},
  {tr:'Illustrator',en:'Adobe Illustrator',cat:'yazilim',def:'Vektör tabanlı grafik tasarım yazılımı. Diyagram, analiz çizimi ve sunum paftası grafiklerinde kullanılır.',not:'AutoCAD DWG\'yi Illustrator\'a aktarıp vektörel düzenlemek yaygın bir workflow\'dur.'},
  {tr:'BIM',en:'Building Information Modeling',cat:'yazilim',def:'Yapının tüm verilerini (geometri, malzeme, maliyet, zaman) tek bir dijital modelde toplayan tasarım ve yönetim yaklaşımı.',not:'Revit ve ArchiCAD BIM platformlarıdır. Sektörde giderek zorunlu hale geliyor.',ornek:'"BIM koordinasyonu olmadan çakışma tespit edilemez"'},
  // KÜLTÜR
  {tr:'Jüri',en:'Jury / Crit',cat:'kultur',def:'Mimarlık öğrencilerinin projelerini akademisyen ve davetli mimarlara sunduğu değerlendirme toplantısı.',not:'Jüri seni yıkmak için değil, projeyi anlamak için orada. Bunu unutma.',ornek:'"Jüri yarın sabah 9\'da" — gece uyku uyumanın imkansız olduğu an'},
  {tr:'Atölye / Stüdyo',en:'Studio',cat:'kultur',def:'Mimarlık eğitiminin merkezi. Hem fiziksel çalışma mekanı hem de proje dersi anlamında kullanılır.',not:'Atölye kültürü mimarlığı diğer bölümlerden ayırır. İlişkiler, rekabet, dayanışma hepsi burada.'},
  {tr:'Brief',en:'Brief',cat:'kultur',def:'Projenin hedeflerini, sınırlarını, programını ve tasarım kriterlerini tanımlayan görev tanımı belgesi.',not:'Brief\'i dikkatlice oku. Hocanın istediği orada, başka yerde değil.',ornek:'"Brief\'te toplantı odası yazmıyor" — jüride savunma'},
  {tr:'Maket',en:'Physical Model',cat:'kultur',def:'Projenin fiziksel olarak, belirli bir ölçekte üretilmiş üç boyutlu temsili.',not:'En iyi maket, fikri en net anlatan maket. Malzeme pahalılığı değil.',ornek:'"Maket bitirildi mi?" — teslim gecesi saat 3\'te'},
  {tr:'Crit',en:'Critique / Crit',cat:'kultur',def:'Hoca veya misafir eleştirmenlerle yapılan gayri resmi tasarım değerlendirme toplantısı. Jüriden daha samimi.',not:'Crit\'te "doğru" cevap yoktur; önemli olan savunabilmek.'},
  {tr:'Staj',en:'Internship',cat:'kultur',def:'Mimarlık öğrencilerinin profesyonel ofislerde edindikleri zorunlu veya gönüllü iş deneyimi.',not:'İlk stajında kahve yapacaksın. Ama nasıl çalışıldığını orada öğreneceksin.'},
  {tr:'Portfolyo',en:'Portfolio',cat:'kultur',def:'Mimarlık öğrencisinin projelerini, çizimlerini ve tasarım süreçlerini sergileyen derlenmiş çalışma koleksiyonu.',not:'Portfolyo staj ve iş başvurularında CV\'den daha önemlidir.',ornek:'"Portfolyon hazır mı?" — her dönem sonu sorusu'},
  {tr:'Charrette',en:'Charrette',cat:'kultur',def:'Kısa sürede yoğun, genellikle disiplinlerarası katılımla gerçekleştirilen tasarım sprint etkinliği.',not:'Fransızcada "araba" anlamına gelir — tasarımı son dakikaya taşıyan arabaya atıfla.'},
  {tr:'Poche',en:'Poché',cat:'kultur',def:'Plan çizimlerinde katı yapı elemanlarının (duvar, kolon) dolgu rengi veya desen ile gösterilmesi geleneği.',ornek:'"Duvarları poche yap, masif okusun" — sunum tekniği'},
  {tr:'Mimari Promenad',en:'Promenade Architecturale',cat:'kultur',def:'Le Corbusier\'in önerdiği, yapı içinde hareket eden bedenin mekansal deneyimini ön plana çıkaran tasarım yaklaşımı.',not:'Villa Savoye bunun en iyi örneğidir. Rampayı unutma.'},
  {tr:'Brütalizm',en:'Brutalism',cat:'kultur',def:'Ham beton yüzeyleri, ağır kütleleri ve dürüst malzeme kullanımını ön plana çıkaran mimari akım (1950–70ler).',not:'Son yıllarda yeniden popüler. "Güzel mi? Hayır. Etkileyici mi? Evet."',ornek:'"Bu bina brütalist mi?" — her ham beton yapıya sorulan soru'},
  {tr:'Modernizm',en:'Modernism',cat:'kultur',def:'"Form işlevi takip eder" ilkesiyle süslemeyi reddeden, endüstriyel malzemeyi benimseyen 20. yy mimari akımı.',not:'Le Corbusier, Mies van der Rohe, Walter Gropius modernizmin öncüleridir.'},
  {tr:'Postmodernizm',en:'Postmodernism',cat:'kultur',def:'Modernizmin katı kurallarına tepki olarak tarihsel referansları, ironiyi ve çeşitliliği benimseyen mimari yaklaşım.',not:'Robert Venturi\'nin "az can sıkıcıdır" sözü modernizmin "az çoktur"una cevaptır.'},
  {tr:'Dekonstruktivizm',en:'Deconstructivism',cat:'kultur',def:'Parçalanmış form, çarpık geometri ve kasıtlı kaosa dayanan 1980 sonrası mimari akım.',not:'Zaha Hadid, Frank Gehry, Rem Koolhaas bu akımın temsilcileridir.',ornek:'"Gehry\'nin o binası gerçekten dekonstruktivist mi, yoksa sadece pahalı mı?"'},
  {tr:'Kritik Bölgeselcilik',en:'Critical Regionalism',cat:'kultur',def:'Küresel modernizme karşı yerel iklim, malzeme ve kültürü bilinçli biçimde tasarıma dahil eden yaklaşım.',not:'Kenneth Frampton\'ın geliştirdiği kavram. Tadao Ando ve Alvaro Siza bu anlayışın önemli isimleri.'},
  {tr:'Genius Loci',en:'Genius Loci',cat:'kultur',def:'Latince "yerin ruhu". Bir mekanın kendine özgü kimliğini ve atmosferini tanımlayan fenomenolojik kavram.',not:'Christian Norberg-Schulz\'un mimarlık teorisindeki temel kavramı.'},
  {tr:'Tescilli Yapı',en:'Listed Building',cat:'kultur',def:'Kültürel, tarihi veya mimari değeri nedeniyle koruma altına alınan ve izinsiz değişiklik yapılamayan yapı.',not:'Türkiye\'de Kültür Bakanlığı tescil kararı verir. Her değişiklik kurul onayı gerektirir.'},
  {tr:'Bitirme Projesi',en:'Graduation Project / Thesis',cat:'kultur',def:'Mimarlık eğitiminin son adımı olarak hazırlanan, bağımsız tasarım araştırması ve projesi.',not:'5 yılın özeti. Konu seçimi hayatının en önemli mimarlık kararlarından biri.',ornek:'"Bitirme konunu buldun mu?" — 4. yıl sonundan itibaren her sohbetin açılışı'},
  {tr:'Adaptif Yeniden Kullanım',en:'Adaptive Reuse',cat:'kultur',def:'Var olan bir yapıya yeni bir işlev kazandırarak dönüştürme ve yeniden hayata geçirme uygulaması.',not:'Sürdürülebilirlik açısından yıkıp yapmaktan çok daha değerlidir.',ornek:'"Fabrikayı kültür merkezine dönüştürdüler" — adaptif yeniden kullanımın klasik örneği'},
  // TEKNİK (ek)
  {tr:'Vaziyet Planı',en:'Site Plan',cat:'teknik',def:'Yapının arsa sınırları, komşu yapılar, yollar ve peyzajla ilişkisini gösteren kuşbakışı çizimi.',ornek:'"Vaziyet planında park yeri hesabını unutma"'},
  {tr:'Konsol',en:'Cantilever',cat:'teknik',def:'Yalnızca bir ucundan mesnet alan, diğer ucu serbest kalan yapı elemanı veya çıkma.',not:'Ne kadar uzun konsol, o kadar büyük moment. Strüktür mühendisi olmadan karar verme.',ornek:'"5 metrelik konsol istemek hocanın gözünü korkutabilir"'},
  {tr:'Kaba Yapı',en:'Shell / Rough Structure',cat:'teknik',def:'Yapının taşıyıcı sisteminden oluşan ilk inşaat aşaması. İnce yapı (kaplama, boya) henüz yapılmamış hali.',ornek:'"Bina kaba yapıda kaldı" — yatırımcı krizi haberi'},
  {tr:'Isı Köprüsü',en:'Thermal Bridge',cat:'teknik',def:'Yapı kabuğunda ısı iletiminin yoğunlaştığı nokta veya bölge. Enerji kaybı ve yoğuşmaya yol açar.',not:'Doğru detaylandırılmamış her bağlantı potansiyel ısı köprüsüdür.'},
  {tr:'Zemin Etüdü',en:'Soil Investigation / Geotechnical Survey',cat:'teknik',def:'Yapı inşaatından önce zeminin taşıma kapasitesi, sıkışma ve yeraltı suyu durumunu belirleyen araştırma.',not:'Zemin etüdü olmadan temel projesi yapılmaz. Türkiye gibi deprem kuşağındaki ülkelerde kritik.',ornek:'"Zemin zayıf çıktı, temel sistemi değiştirmek gerekiyor"'},
  {tr:'Yangın Merdiveni',en:'Fire Escape Stair',cat:'teknik',def:'Yangın anında güvenli tahliyeyi sağlamak üzere tasarlanan, yangına dayanıklı kapalı merdiven hacmi.',not:'Belirli kat sayısının üzerindeki yapılarda zorunludur. Yönetmeliği iyi bil.'},
  {tr:'Derz',en:'Joint',cat:'teknik',def:'İki yapı elemanı veya malzeme arasındaki birleşim çizgisi veya boşluğu. Hem teknik hem estetik önemi vardır.',not:'Genleşme derzini unutursan bina çatlar. Gerçekten.',ornek:'"Derz aralıklarını 6 metrede bir bırak"'},
  // TASARIM (ek)
  {tr:'Avlu',en:'Courtyard',cat:'tasarim',def:'Yapı kütlesiyle çevrili veya yarı çevrili açık ya da yarı açık dış mekan.',not:'Anadolu mimarisinin temel mekansal örgütleyicisidir.',ornek:'"Avluyu programın merkezi yap, tüm fonksiyonlar oraya baksın"'},
  {tr:'Atrium',en:'Atrium',cat:'tasarim',def:'Birden fazla katta devam eden, üstten ışık alan büyük iç mekan boşluğu.',not:'Kamuya açık binalarda dramatik etki yaratır. Yangın yönetmeliğini de iyi incele.',ornek:'"Atrium kütüphanenin kalbine yerleştiriliyor"'},
  {tr:'Grid Sistemi',en:'Grid System',cat:'tasarim',def:'Tasarımın düzenini ve modüler koordinasyonu sağlamak için kullanılan ızgara referans çerçevesi.',ornek:'"6x6 metrelik grid üzerine kurgulandı" — kolon yerleşimini de belirler'},
  {tr:'Çift Kabuk Cephe',en:'Double Skin Façade',cat:'tasarim',def:'İki katmanlı, aralarında hava boşluğu olan cephe sistemi. Enerji verimliliği ve doğal havalandırma sağlar.',not:'Yapım maliyeti yüksek ama uzun vadede işletme maliyetini düşürür.'},
  {tr:'Doğal Havalandırma',en:'Natural Ventilation',cat:'tasarim',def:'Mekanik sistemler olmadan rüzgar ve sıcaklık farkı ile hava sirkülasyonunu sağlayan pasif tasarım stratejisi.',not:'Sürdürülebilir mimarinin temel araçlarından biri. Baca etkisi en yaygın yöntemi.',ornek:'"Koridoru baca gibi çalıştır, üstten hava çeksin"'},
  {tr:'Biyofillik Tasarım',en:'Biophilic Design',cat:'tasarim',def:'İnsanların doğayla bağlantısını güçlendirmek için doğal malzeme, ışık, bitki ve su ögelerini mimarlığa entegre eden yaklaşım.',not:'Araştırmalar biyofillik ortamların üretkenlik ve iyilik halini artırdığını gösteriyor.'},
  {tr:'Pasif Güneş Tasarımı',en:'Passive Solar Design',cat:'tasarim',def:'Güneş enerjisini mekanik sistem olmadan ısıtma ve aydınlatma amacıyla kullanan bina tasarım stratejisi.',ornek:'"Güney cepheyi büyüt, kış güneşinden yararlan"'},
  {tr:'Topografya',en:'Topography',cat:'tasarim',def:'Arazinin yüzey biçimini, eğim ve yükseklik farklarını tanımlayan fiziksel yapı.',not:'Topografyayı tasarımla entegre etmek yerine sıfırlamak genellikle yanlış bir karardır.',ornek:'"Eğimi bastırma, rampa olarak değerlendir"'},
  // MALZEME (ek)
  {tr:'CLT',en:'Cross Laminated Timber',cat:'malzeme',def:'Çapraz katmanlarda yapıştırılmış ahşap levhalardan üretilen yapısal ahşap sistem. Betonarmeni alternatifi.',not:'Karbon ayak izi düşük, hızlı montajlı. Sürdürülebilir yapılarda popülerleşiyor.',ornek:'"CLT ile 10 katlı yapı mümkün" — endüstriyel ahşap mimarisinin geleceği'},
  {tr:'Terrakota',en:'Terracotta',cat:'malzeme',def:'Pişirilmiş kil esaslı, cephe kaplama ve seramik ürünü. Hem geleneksel hem çağdaş cephelerde kullanılır.',not:'Uzun ömürlü, bakım gerektirmeyen sürdürülebilir bir seçenek.',ornek:'"Terrakota panel cephe hem estetik hem de iklime dayanıklı"'},
  {tr:'Mikrobeton',en:'Microcement',cat:'malzeme',def:'İnce katmanlarda uygulanan, pürüzsüz ve derzsiz beton görünümlü kaplama malzemesi.',ornek:'"Zemine mikrobeton döktürdük, endüstriyel his verdi"'},
  {tr:'Akustik Panel',en:'Acoustic Panel',cat:'malzeme',def:'Ses yansımasını azaltmak ve akustik konforu artırmak için kullanılan yutucu yüzey malzemesi.',not:'Konser salonu, sinema, ofis gibi programlarda akustik tasarım ihmal edilemez.',ornek:'"Ahşap akustik panel hem fonksiyonel hem de estetik"'},
  {tr:'Çelik Profil',en:'Steel Section / Profile',cat:'malzeme',def:'HEB, IPE, UPN gibi standart kesitlerde üretilen yapısal çelik eleman. Kolon, kiriş ve çatı sistemlerinde kullanılır.',not:'Çelik beton kadar ağır değil, hızlı monte edilir, geri dönüştürülebilir.',ornek:'"HEB200 yerine HEB240 kullanmak gerekiyor, moment fazla"'},
  {tr:'Cam Yünü',en:'Glass Wool',cat:'malzeme',def:'Cam elyafından üretilen ısı ve ses yalıtım malzemesi. Duvar, tavan ve çatı uygulamalarında yaygın.',ornek:'"50mm cam yünü yeterli mi?" — enerji hesabı yapmadan cevap verilmez'},
  {tr:'Tuğla',en:'Brick',cat:'malzeme',def:'Pişirilmiş ya da sıkıştırılmış kilden üretilen, duvar örgüsünde kullanılan geleneksel yapı elemanı.',not:'Hem taşıyıcı hem dolgu duvar olarak kullanılabilir. Düşük enerji değeri bir dezavantaj.'},
  // TEKNİK (genişleme)
  {tr:'Temel',en:'Foundation',cat:'teknik',def:'Yapının yüklerini zemine aktaran, zeminde ya da zemin altında yer alan taşıyıcı yapı elemanı.',not:'Temel tasarımı zemin etüdü sonuçlarına göre yapılır. Yanlış temel = yanlış yapı.',ornek:'"Tekil mi, radye mi?" — zemin raporu gelmeden karar verilmez'},
  {tr:'Radye Temel',en:'Raft Foundation',cat:'teknik',def:'Tüm yapı tabanını örten, yükleri geniş alana dağıtan betonarme döşeme temel sistemi.',not:'Zayıf ve heterojen zeminlerde, çok katlı yapılarda tercih edilir.',ornek:'"Zemin taşıma gücü düşük, radye şart"'},
  {tr:'Kazık Temel',en:'Pile Foundation',cat:'teknik',def:'Yükleri derinlerdeki sağlam zemine aktarmak için zemine çakılan ya da delinen uzun taşıyıcı eleman.',not:'Gevşek, sıvılaşma riski taşıyan ya da su altı zeminlerde zorunludur.',ornek:'"Sahil kenarına bina yapılıyor, kazık kaçınılmaz"'},
  {tr:'Yapı Kabuğu',en:'Building Envelope',cat:'teknik',def:'Yapının iç ve dış mekânı birbirinden ayıran tüm yüzeyler: duvarlar, çatı, döşeme ve cepheler.',not:'Enerji verimliliği büyük ölçüde yapı kabuğunun kalitesine bağlıdır.'},
  {tr:'İskelet Sistem',en:'Skeleton Frame',cat:'teknik',def:'Yükleri kolon ve kirişlerden oluşan bir çerçeveyle taşıyan, dolgu duvarlarının taşıyıcı olmadığı yapı sistemi.',not:'Modern binaların büyük çoğunluğu iskelet sistemdir. Plan esnekliği sağlar.'},
  {tr:'Yığma Yapı',en:'Masonry Construction',cat:'teknik',def:'Taşıyıcı işlevi duvarların üstlendiği, kolon-kiriş sistemi olmayan geleneksel yapı biçimi.',not:'Genellikle 3-4 kattan fazla uygun değil. Deprem riski yüksek.',ornek:'"Köyde yığma yapı restore edilecek" — rölöve zorunlu'},
  {tr:'Prefabrik',en:'Prefabricated',cat:'teknik',def:'Fabrikada üretilip şantiyede monte edilen yapı elemanları veya bütünsel yapı sistemi.',not:'Hız ve kalite avantajı sağlar. Mimari özelleştirme kısıtlı olabilir.',ornek:'"Okul binası prefabrik sistemle 3 ayda tamamlandı"'},
  {tr:'Avan Proje',en:'Schematic Design',cat:'teknik',def:'Tasarım sürecinin ilk resmi aşaması; konseptin plan, kesit ve görünüşlerle genel hatlarıyla aktarıldığı proje.',not:'Uygulama projesinden önce onay alınan aşamadır.',ornek:'"Belediyeye avan proje sunduk, onay bekliyoruz"'},
  {tr:'Uygulama Projesi',en:'Construction Documents',cat:'teknik',def:'İnşaatın yapılabilmesi için gerekli tüm teknik bilgileri içeren detaylı mimari ve mühendislik çizimleri.',not:'Her detay tanımlıdır. Eksik uygulama projesi şantiyede kaos demektir.',ornek:'"Uygulama projesi bitmeden ihaleye çıkılmaz"'},
  {tr:'Şap',en:'Screed',cat:'teknik',def:'Döşeme kaplaması öncesinde yüzeyi düzleştirmek ve eğim vermek amacıyla uygulanan ince çimento-kum katmanı.',ornek:'"Banyo şabına %2 eğim ver, su akmalı"'},
  {tr:'Su Basman',en:'Plinth / Damp Course',cat:'teknik',def:'Yapının zemin ile birleştiği bölgede nem ve su etkisine karşı koruyan alçak duvar ya da kaplama kuşağı.',not:'Yüksekliği imar yönetmeliğine göre belirlenir.',ornek:'"Su basman kotu tamamlandı, kaba yapıya geçiliyor"'},
  {tr:'Hareket Derzi',en:'Expansion Joint',cat:'teknik',def:'Sıcaklık değişimi ve yapısal hareketlere bağlı çatlama riskini önlemek için bırakılan planlı boşluk.',not:'Uzun yapılarda zorunludur. Atlanırsa beton kendi derzini yaratır — kırılarak.',ornek:'"30 metrede bir hareket derzi bırak"'},
  {tr:'Saçak',en:'Eave',cat:'teknik',def:'Çatının duvarın ötesine taşan alt kenarı. Yağış suyunu duvardan uzaklaştırır.',not:'Saçak uzunluğu hem iklimsel hem estetik bir karardır.',ornek:'"Geniş saçak cepheyi yağmurdan korur"'},
  {tr:'Yeşil Çatı',en:'Green Roof',cat:'teknik',def:'Üzerinde bitki katmanı barındıran, yalıtım, yağmursuyu yönetimi ve kentsel ısı adası azaltımına katkı sağlayan çatı sistemi.',not:'Strüktürün ek yükü taşıması gerekir. Drenaj ve kök bariyeri kritik.',ornek:'"Yeşil çatı LEED puanına katkı sağlar"'},
  {tr:'Asma Tavan',en:'Suspended Ceiling',cat:'teknik',def:'Döşemeden aşağıya sarkıtılan, mekanik tesisat ve akustik düzenlemeler için kullanılan ikincil tavan sistemi.',ornek:'"Tesisat asma tavanın içinden geçecek"'},
  {tr:'Güneş Kırıcı',en:'Brise Soleil / Sun Breaker',cat:'teknik',def:'Doğrudan güneş ışınımını kesen, aşırı ısı kazanımını önleyen yatay ya da dikey cephe elemanı.',not:'Le Corbusier\'in önerdiği iklimsel tasarım aracıdır.',ornek:'"Batı cephesine güneş kırıcı eklemeden render sunma"'},
  {tr:'Evrensel Tasarım',en:'Universal Design',cat:'teknik',def:'Her yaş ve yetenekteki insanın yapıyı bağımsızca kullanabilmesi için erişilebilirlik standartlarını gözeten tasarım yaklaşımı.',not:'Türkiye\'de engelli erişimi yönetmeliklere tabidir. Jürilerde sıkça sorulur.',ornek:'"Rampa eğimi 1/12\'yi geçemez"'},
  {tr:'Yüksek Yapı',en:'High-Rise Building',cat:'teknik',def:'Genellikle 8 katın ya da 30 metrenin üzerinde kalan, özel strüktürel ve yangın güvenliği gereksinimleri olan bina.',not:'Çekirdek sistemi ve rüzgar yükü hesabı kritik önem taşır.',ornek:'"50 katlı yapıda çift kat koridoru zorunlu"'},
  {tr:'Yangın Yönetmeliği',en:'Fire Code',cat:'teknik',def:'Binalarda yangın güvenliğini düzenleyen yasal kurallar bütünü; kaçış yolları, kapı genişlikleri, yangın dayanımı vb.',not:'Türkiye\'de Binaların Yangından Korunması Yönetmeliği geçerlidir.',ornek:'"30 m çıkış mesafesini aştın, ek merdiven şart"'},
  {tr:'Zemin Islahı',en:'Ground Improvement',cat:'teknik',def:'Yapı öncesinde zeminin taşıma kapasitesini artırmak için uygulanan çeşitli yöntemler.',not:'Zeminkoşullandırma da denir. Derin karıştırma, jet grouting en yaygın yöntemler.',ornek:'"Zemin ıslahı olmadan temel tasarımı yapılamaz"'},
  {tr:'Lümen / Aydınlatma Şiddeti',en:'Lumen / Illuminance',cat:'teknik',def:'Bir yüzeye düşen ışık miktarını ifade eden ölçü (lux). Mimari tasarımda aydınlık düzeyi hesabı için kullanılır.',not:'Ofislerde 500 lux, koridorlarda 100 lux standart değerlerdir.',ornek:'"Çalışma odası aydınlatma hesabı yapmadan bitmez"'},
  {tr:'Akustik',en:'Acoustics',cat:'teknik',def:'Ses dalgalarının bir mekânda yayılma, yansıma ve soğurulma biçimini inceleyen ve tasarıma entegre eden disiplin.',not:'Konser salonu, sinema, dershane gibi programlarda ihmal edilemez.',ornek:'"Hacim oranı ve malzeme seçimi reverberasyon süresini belirler"'},
  // TASARIM (genişleme)
  {tr:'İnsan Ölçeği',en:'Human Scale',cat:'tasarim',def:'Mimari elemanların insanın beden ölçüleri ve algısıyla uyumlu biçimde boyutlandırılması ilkesi.',not:'Dev cepheler insanı küçültür. İnsan ölçeği kaybedilince mekan ürpertici olur.',ornek:'"Giriş kapısı çok büyük, insan ölçeği yok"'},
  {tr:'Eşik / Geçiş Mekânı',en:'Threshold',cat:'tasarim',def:'İki farklı mekânı birbirine bağlayan geçiş noktası ya da bölgesi. Hem fiziksel hem sembolik anlamı vardır.',not:'Eşik tasarımı iyi yapılan yapılar içeri alındığını hissettirip geçişi tanımlar.',ornek:'"Antre eşik rolü üstleniyor, iç–dış gerilimi var"'},
  {tr:'Çift Yükseklik',en:'Double Height',cat:'tasarim',def:'İki katı birleştiren, üst kotta tavan bulunmayan yüksek iç mekân boşluğu.',not:'Dramatik etki ve ışık derinliği sağlar ama ısıtma-soğutma maliyetini artırır.',ornek:'"Oturma odasına çift yükseklik ver, ferah hissettirsin"'},
  {tr:'Işık Kuyusu',en:'Light Well',cat:'tasarim',def:'Derin plan kütlelerinde doğal ışığı ve hava akışını iç mekânlara taşıyan dar dikey boşluk.',ornek:'"Orta koridora ışık kuyusu açılmalı, yoksa karanlık kalır"'},
  {tr:'Simetri',en:'Symmetry',cat:'tasarim',def:'Tasarım elemanlarının bir eksen etrafında yansımalı olarak düzenlenmesi. Denge ve otorite hissi verir.',not:'Her iyi mimarlık simetrik değildir; simetri bir araçtır, amaç değil.',ornek:'"Klasik saraylar simetrik planlanır; anlam yüklüdür"'},
  {tr:'Ritim',en:'Rhythm',cat:'tasarim',def:'Tekrar eden elemanlarda düzenli ya da değişken aralıklarla oluşturulan görsel devamlılık ve hareket hissi.',ornek:'"Cephedeki pencere ritmi bozuluyor, tarama yap"'},
  {tr:'Kentsel Tasarım',en:'Urban Design',cat:'tasarim',def:'Kentsel mekânların — sokak, meydan, mahalle — fiziksel ve sosyal boyutlarıyla planlanması ve tasarlanması disiplini.',not:'Mimarlık ve şehir planlaması arasındaki köprü disiplindir.',ornek:'"Proje kentsel tasarım kararlarına dayanmalı"'},
  {tr:'Kamusal Alan',en:'Public Space',cat:'tasarim',def:'Her kesimden insanın serbestçe kullanabileceği, sosyal etkileşimi teşvik eden kentsel açık ya da kapalı mekân.',not:'İyi kamusal alan şehri yaşatan unsurdur. Sahiplenilmezse dönüşür ya da ölür.'},
  {tr:'Geçirgenlik',en:'Permeability',cat:'tasarim',def:'Kentsel doku ya da yapının yayaların hareketine ne ölçüde olanak tanıdığını ifade eden tasarım niteliği.',ornek:'"Blok içinden geçiş yok, geçirgenlik sıfır"'},
  {tr:'Topoğrafya ile Entegrasyon',en:'Topographic Integration',cat:'tasarim',def:'Yapının eğimi düzleştirmek yerine arazi biçimini okuyarak tasarıma katan yaklaşım.',not:'Doğal topoğrafyayı yok eden yapılar hafızasız görünür.',ornek:'"Yapıyı eğime gömün, topoğrafyayla konuşsun"'},
  {tr:'Güneş Analizi',en:'Solar Analysis',cat:'tasarim',def:'Güneşin mevsimsel ve saatsel hareketinin bina ve çevresine etkisini inceleyen simülasyon çalışması.',not:'Erken tasarım aşamasında yapılırsa cephe ve açıklık kararlarını doğrudan etkiler.',ornek:'"Kış gündönümünde güneş avluya girmiyor, analiz yanlış"'},
  {tr:'Rüzgar Analizi',en:'Wind Analysis',cat:'tasarim',def:'Rüzgarın yapı kütlesi ve çevresindeki yayalar üzerindeki etkisini inceleyen hesaplamalı ya da deneysel çalışma.',not:'Yüksek yapılarda ve kentsel tasarım projelerinde zorunlu hale geliyor.',ornek:'"Giriş önünde hortum etkisi var, kütle düzenlemesi değişmeli"'},
  {tr:'Sekans',en:'Sequence',cat:'tasarim',def:'Mekânların birbiri ardına deneyimlenmesini düzenleyen, anlatısal bir sıra ve gerilim yaratan tasarım kurgusu.',not:'Le Corbusier\'in mimari promenadı sekansı mekânsal tecrübe olarak sunar.',ornek:'"Giriş → avlu → salon sekansı güçlü bir anlatı oluşturuyor"'},
  {tr:'Pasif Güneş Tasarımı',en:'Passive Solar Design',cat:'tasarim',def:'Güneş enerjisini mekanik sistem olmadan ısıtma ve aydınlatmada kullanan bina tasarım stratejisi.',ornek:'"Güney cepheyi büyüt, kış güneşini içeri al"'},
  {tr:'Biyofillik Tasarım',en:'Biophilic Design',cat:'tasarim',def:'İnsanların doğayla bağlantısını güçlendirmek için doğal malzeme, ışık, bitki ve su ögelerini mimarlığa entegre eden yaklaşım.',not:'Araştırmalar biyofillik ortamların üretkenlik ve iyilik halini artırdığını gösteriyor.'},
  {tr:'Çift Kabuk Cephe',en:'Double Skin Façade',cat:'tasarim',def:'İki katmanlı, aralarında hava boşluğu olan cephe sistemi. Enerji verimliliği ve doğal havalandırma sağlar.',not:'Yapım maliyeti yüksek ama uzun vadede işletme maliyetini düşürür.'},
  {tr:'Doğal Havalandırma',en:'Natural Ventilation',cat:'tasarim',def:'Mekanik sistemler olmadan rüzgar ve sıcaklık farkıyla hava sirkülasyonunu sağlayan pasif tasarım stratejisi.',not:'Sürdürülebilir mimarinin temel araçlarından biri. Baca etkisi en yaygın yöntemdir.',ornek:'"Koridoru baca gibi çalıştır, üstten hava çeksin"'},
  // MALZEME (genişleme)
  {tr:'Ytong / Gazbeton',en:'AAC – Autoclaved Aerated Concrete',cat:'malzeme',def:'Hafif, gözenekli, ısı yalıtım değeri yüksek beton blok. Hızlı kuru örme ve işlenebilirliği ile yaygın.',not:'İnce kesme ve kolay delik açma avantajı var ama darbe dayanımı düşük.',ornek:'"İç bölme duvarlarına ytong yeterli"'},
  {tr:'XPS',en:'Extruded Polystyrene',cat:'malzeme',def:'Su emmez, yüksek basınç dayanımlı köpük yalıtım levhası. Zemin altı, teras ve temel uygulamalarında tercih edilir.',not:'EPS\'e göre daha pahalı ama nemli ortamlarda üstündür.',ornek:'"Teras döşemesine XPS şart, su alıyor"'},
  {tr:'Taş Yünü',en:'Rock Wool / Mineral Wool',cat:'malzeme',def:'Bazalt ve diğer volkanik kayaçlardan üretilen, ısı ve ses yalıtımı ile yangın direnci sağlayan elyaflı malzeme.',not:'Yanmaz oluşu cam yününe göre büyük avantaj sağlar.',ornek:'"Yangın duvarında taş yünü kullan, yönetmelik şartı"'},
  {tr:'OSB',en:'Oriented Strand Board',cat:'malzeme',def:'Yönlendirilmiş ahşap yonga parçaların yapıştırılmasıyla elde edilen yapısal levha malzemesi.',not:'Ahşap çerçeve yapılarda yaygın. Göründüğü kadar güçlü.',ornek:'"Çatı kaplamasına OSB kullan, sonra membran"'},
  {tr:'Cor-Ten Çeliği',en:'Weathering Steel',cat:'malzeme',def:'Atmosfer koşullarına maruz bırakıldığında paslanmadan koruyucu pas tabakası oluşturan özel çelik alaşımı.',not:'Bakım gerektirmez. Zaman içinde değişen görünümü estetik tercih sebebidir.',ornek:'"Cephede Cor-Ten kullandım, jüride hoca çok beğendi"'},
  {tr:'ETFE Membran',en:'ETFE Membrane',cat:'malzeme',def:'Çelik konstrüksiyona gergin olarak bağlanan, ışık geçirgen, hafif ve dayanıklı polimer membran.',not:'Beijing Ulusal Yüzme Merkezi ve Eden Projesi\'nin kabuğu ETFE.',ornek:'"Spor salonu çatısına ETFE yap, gün ışığı içeri girsin"'},
  {tr:'GRC / GFRC',en:'Glass Reinforced Concrete',cat:'malzeme',def:'Cam elyafıyla güçlendirilmiş ince kesitli beton panel sistemi. Hafif ama sağlam cephe kaplamasında kullanılır.',not:'Karmaşık form ve dokuların ekonomik cephe çözümüdür.',ornek:'"Cephe panelleri GRC, betondan 5 kat daha hafif"'},
  {tr:'Kerpiç / Adobe',en:'Adobe / Rammed Earth',cat:'malzeme',def:'Kil, kum ve saman karışımıyla üretilen ya da sıkıştırılarak kürletilen doğal toprak yapı malzemesi.',not:'Düşük karbon, yerel kaynak. Sürdürülebilir mimarlığın yeniden gündemindeki malzemesi.',ornek:'"Kerpiç atölyesi projesinde hem malzeme hem konsept"'},
  {tr:'Lamine Cam',en:'Laminated Glass',cat:'malzeme',def:'İki cam tabakanın arasına PVB filmi eklenerek üretilen, kırıldığında parçalanmayan güvenlik camı.',not:'Şeffaf cephe detaylarında insan güvenliği için zorunludur.',ornek:'"Düşme koruması olan tüm yüzeylerde lamine cam şart"'},
  {tr:'Akıllı Cam',en:'Smart Glass / Electrochromic',cat:'malzeme',def:'Elektrik akımı ya da ışık etkisiyle saydamlığını değiştirebilen ileri teknoloji cam.',not:'Güneş kontrolü ve gizlilik sağlar. Yüksek maliyet kısıtlayıcı.',ornek:'"Ofis toplantı odasına akıllı cam kondu, perde yok"'},
  {tr:'Bambu',en:'Bamboo',cat:'malzeme',def:'Hızlı büyüyen, yüksek çekme dayanımlı ve karbon depolayan bitkisel yapı ve kaplama malzemesi.',not:'Çeliğe yakın çekme dayanımı var. Tropikal ve yarı tropikal iklimlerde yapı malzemesi olarak kullanılıyor.',ornek:'"Sürdürülebilir tasarım stüdyosunda bambu strüktür incelendi"'},
  {tr:'Polimer Beton',en:'Polymer Concrete',cat:'malzeme',def:'Çimento yerine polimer reçinelerin bağlayıcı olarak kullanıldığı yüksek dayanımlı beton türü.',not:'Kimyasal dayanımı ve pürüzsüz yüzeyi nedeniyle sanayi yapılarında tercih edilir.'},
  {tr:'Paslanmaz Çelik',en:'Stainless Steel',cat:'malzeme',def:'Krom alaşımlı, korozyona karşı dirençli çelik türü. Mutfak, banyo, cephe detayları ve mobilyada kullanılır.',ornek:'"Merdiven korkuluklarına paslanmaz çelik profil"'},
  // YAZILIM (genişleme)
  {tr:'Dynamo',en:'Dynamo',cat:'yazilim',def:'Revit içinde çalışan görsel programlama aracı. Tekrarlayan görevleri otomatikleştirir ve parametrik BIM nesneleri üretir.',not:'Revit\'i etkin kullanmak isteyenler için Grasshopper\'ın BIM karşılığı.',ornek:'"Dynamo ile 500 odanın numaralandırması 5 dakikada bitti"'},
  {tr:'Navisworks',en:'Navisworks',cat:'yazilim',def:'Farklı disiplinlerin BIM modellerini birleştirerek çakışma (clash) tespiti yapan koordinasyon yazılımı.',not:'İnşaat öncesinde boru-kiriş çakışmalarını bulmak için sektörde standart.',ornek:'"Navisworks clash raporu: 47 çakışma — proje revize"'},
  {tr:'Unreal Engine',en:'Unreal Engine',cat:'yazilim',def:'Epic Games\'in gerçek zamanlı render motoru. Fotorealistik mimari görselleştirme ve VR deneyimleri için giderek yaygınlaşıyor.',not:'Mimarlıkta oyun motorlarının kullanımı artık mainstream.',ornek:'"Unreal\'de walk-through yaptık, müşteri şok oldu"'},
  {tr:'Midjourney / AI Render',en:'Midjourney / AI Rendering',cat:'yazilim',def:'Yapay zeka destekli görsel üretim araçları. Kavramsal aşamada hızlı imge üretimi için mimarlıkta kullanılıyor.',not:'Fikir aşamasında vizyon kurmak için kullanışlı. Sonuç "mimari gerçek" değildir, yanıltıcı olabilir.',ornek:'"AI render sunum için değil, fikir aramak için kullan"'},
  {tr:'DaVinci Resolve',en:'DaVinci Resolve',cat:'yazilim',def:'Profesyonel video düzenleme ve renk düzeltme yazılımı. Mimari proje tanıtım videolarında kullanılır.',not:'Ücretsiz sürümü çoğu proje için yeterlidir.',ornek:'"Twinmotion animasyonunu DaVinci\'de kurguladım"'},
  {tr:'Figma',en:'Figma',cat:'yazilim',def:'Tarayıcı tabanlı arayüz ve sunum tasarımı aracı. Mimarlıkta proje web sayfaları ve dijital portfolyo için kullanılıyor.',not:'Gerçek zamanlı işbirliği en büyük avantajı.',ornek:'"Portfolyoyu Figma\'da tasarladım, PDF\'e aktardım"'},
  {tr:'IFC',en:'IFC – Industry Foundation Classes',cat:'yazilim',def:'Farklı BIM yazılımları arasında veri alışverişini sağlayan açık format standardı.',not:'Revit\'ten ArchiCAD\'e model aktarımında IFC kullanılır. Veri kaybı olabilir.',ornek:'"IFC formatında ihaleye model sunmak zorunlu oldu"'},
  {tr:'Procreate',en:'Procreate',cat:'yazilim',def:'iPad için dijital çizim ve eskiz uygulaması. Tasarım sürecinde hızlı kavramsal eskizler için kullanılır.',not:'Kalem hassasiyetiyle elle çizime en yakın dijital deneyim.',ornek:'"Tasarımı önce Procreate\'de eskizledim, sonra modele geçtim"'},
  {tr:'Notion',en:'Notion',cat:'yazilim',def:'Proje yönetimi ve belgeleme için kullanılan all-in-one organizasyon aracı. Stüdyo takibinde ve portfolyo sürecinde işe yarar.',ornek:'"Tez sürecimi Notion\'da takip ediyorum"'},
  // KÜLTÜR (genişleme)
  {tr:'Bauhaus',en:'Bauhaus',cat:'kultur',def:'1919\'da Walter Gropius\'un kurduğu, sanat-zanaat-teknolojiyi birleştiren Almanya kökenli tasarım okulu ve hareketi.',not:'Modern tasarım eğitiminin temeli. "Form işlevi takip eder" anlayışının okulu.',ornek:'"Bauhaus müfredatı bugünkü mimarlık eğitimini hâlâ şekillendiriyor"'},
  {tr:'Uluslararası Üslup',en:'International Style',cat:'kultur',def:'1930\'larda yayılan, düz çatı, beyaz yüzey, yatay pencereler ve strüktürel dürüstlüğü öne çıkaran modernist mimari akım.',not:'Eleştirmenler: Her yerde aynı görünmesini sağlıyor; yer duygusu yok.',ornek:'"İstanbul\'daki kutu binalar International Style mirasının ucuz kopyası"'},
  {tr:'Organik Mimarlık',en:'Organic Architecture',cat:'kultur',def:'Frank Lloyd Wright\'ın geliştirdiği, yapının doğal çevresiyle uyum içinde, organik formlar kullanarak tasarlanması yaklaşımı.',not:'Fallingwater bu anlayışın simgesidir. Yapı doğayı tahrip etmez, onunla bütünleşir.',ornek:'"Wright bağlamı mimarlığın özü olarak görüyordu"'},
  {tr:'Hi-Tech Mimarlık',en:'High-Tech Architecture',cat:'kultur',def:'Strüktürel ve mekanik bileşenleri estetik öge olarak kullanan, endüstriyel malzemeleri öne çıkaran akım.',not:'Centre Pompidou (Rogers & Piano) ve Lloyd\'s binası (Foster) bu akımın simgeleri.',ornek:'"Boruları dışarı çıkar, bina cepheye dönüşsün" — hi-tech mantığı'},
  {tr:'Minimalizm',en:'Minimalism',cat:'kultur',def:'Gereksiz her şeyi soyutlayan, saf formlar, nötr malzeme ve sessizlik ile güçlü mekânsal deneyim yaratan tasarım anlayışı.',not:'Mies van der Rohe\'nin "az çoktur" sözü minimalizmin manifesto cümlesidir.',ornek:'"Tadao Ando beton, ışık ve sessizlikle minimalizmi yaşatıyor"'},
  {tr:'Parametrik Mimarlık',en:'Parametric Architecture',cat:'kultur',def:'Algoritma ve hesaplamalı tasarım araçlarıyla oluşturulan, değişkenlerin biçimi belirlediği tasarım yaklaşımı.',not:'Grasshopper ve Dynamo bu yaklaşımın araçlarıdır. Zaha Hadid Architects öncü.',ornek:'"Parametrik cephe, 5000 farklı panel — hepsi CNC\'den"'},
  {tr:'LEED Sertifikasyonu',en:'LEED Certification',cat:'kultur',def:'Amerika kaynaklı, enerji verimliliği, su tasarrufu ve iç mekân kalitesini puanlayan uluslararası yeşil bina belgesi.',not:'LEED Gold ve Platinum düzeyleri en prestijli. Türkiye\'de giderek yaygınlaşıyor.',ornek:'"LEED platin almak için tüm cephe yeniden hesaplandı"'},
  {tr:'Pasif Ev',en:'Passive House',cat:'kultur',def:'Alman kökenli enerji standardı; son derece yüksek yalıtım, ısı geri kazanım ve hava sızdırmazlığıyla ısıtma ihtiyacını sıfıra yaklaştıran bina konsepti.',not:'Normal binadan 10 kat daha az enerji kullanır.',ornek:'"Pasif ev kurallarıyla yapılan binanın kalorifer faturası yok"'},
  {tr:'Net Sıfır Enerji Binası',en:'Net Zero Energy Building',cat:'kultur',def:'Yıl boyunca tükettiği enerji kadar yenilenebilir enerji üreten bina.',not:'Güneş paneli ve enerji depolama olmadan net sıfıra ulaşmak çok zor.',ornek:'"2030\'dan itibaren AB\'de tüm yeni binalar net sıfır olacak"'},
  {tr:'Kentsel Dönüşüm',en:'Urban Regeneration',cat:'kultur',def:'Kentsel alandaki köhnemiş ya da riskli yapıların yenilenmesi, işlevinin değiştirilmesi veya yıkılıp yeniden yapılması süreci.',not:'Türkiye\'de deprem riski nedeniyle kapsamlı kentsel dönüşüm uygulamaları var.',ornek:'"Kentsel dönüşüm projesinde tarihi doku korunabilir mi?" — tartışma sürüyor'},
  {tr:'Pritzker Ödülü',en:'Pritzker Architecture Prize',cat:'kultur',def:'Her yıl verilen, mimarlıktaki Nobel olarak kabul edilen uluslararası prestij ödülü.',not:'Türkiye\'den henüz kazanan yok. Türk mimarların ödüle yaklaştığı dönemler oldu.',ornek:'"Pritzker alan mimarların yapılarını incele — stil değil, düşünce öğrenilir"'},
  {tr:'Vitruvius İlkeleri',en:'Vitruvian Principles',cat:'kultur',def:'MÖ 1. yy\'da Romalı mimar Vitruvius\'un öne sürdüğü, iyi mimarlığın üç temel niteliği: Firmitas (sağlamlık), Utilitas (kullanışlılık), Venustas (güzellik).',not:'2000 yıllık ama hâlâ geçerli. Her tasarım sorusunun cevabı bu üç kavramda.',ornek:'"Sağlam mı, işlevli mi, güzel mi?" — bu üçü bir aradaysa Vitruvius mutlu'},
  {tr:'Çevre Etki Değerlendirmesi',en:'Environmental Impact Assessment (EIA)',cat:'kultur',def:'Büyük ölçekli yapı ve kentsel projelerin çevresel etkilerini önceden inceleyen zorunlu rapor süreci.',not:'Türkiye\'de belirli eşik değerlerin üzerindeki projeler için yasal zorunluluk.',ornek:'"ÇED raporu onaylanmadan inşaata başlanamaz"'},
  {tr:'Yapı Denetimi',en:'Building Inspection',cat:'kultur',def:'İnşaat sürecinde projeye ve mevzuata uygunluğun denetlenmesi işlevi.',not:'Türkiye\'de 2000 yılında zorunlu hale geldi. Deprem sonrası büyük önem kazandı.',ornek:'"Yapı denetim firması şantiyeyi haftada bir denetliyor"'},
  {tr:'Mimarlık Odası',en:'Union of Chambers of Turkish Engineers and Architects (TMMOB)',cat:'kultur',def:'Türk mimarların üyesi olduğu meslek kuruluşu. Mesleki sicil, staj tescili ve mimar yetki belgesi buradan alınır.',not:'Mezun olmadan mezun olunmuş sayılmaz — oda kaydı şart.',ornek:'"Mimarlar Odası\'na kaydolmadan proje imzalanamaz"'},
  {tr:'Genius Loci',en:'Genius Loci',cat:'kultur',def:'Latince "yerin ruhu". Bir mekânın kendine özgü kimliğini ve atmosferini tanımlayan fenomenolojik kavram.',not:'Christian Norberg-Schulz\'un mimarlık teorisindeki temel kavramı.',ornek:'"Bu yapı yerin ruhunu taşıyor — zeminden, iklimden besleniyor"'},
  {tr:'Charrette',en:'Charrette',cat:'kultur',def:'Kısa sürede yoğun, genellikle disiplinlerarası katılımla gerçekleştirilen tasarım sprint etkinliği.',not:'Fransızcada "araba" anlamına gelir — tasarımı son dakikaya taşıyan arabaya atıfla.'},
  {tr:'Poche',en:'Poché',cat:'kultur',def:'Plan çizimlerinde katı yapı elemanlarının (duvar, kolon) dolgu rengi veya desenle gösterilmesi geleneği.',ornek:'"Duvarları poche yap, masif okusun" — sunum tekniği'},
  {tr:'Kolektif Bellek',en:'Collective Memory',cat:'kultur',def:'Aldo Rossi\'nin geliştirdiği, kentin ve yapılarının toplumun ortak deneyim ve hatırasını taşıdığı fikri.',not:'Tarihi yapıların korunması bu kavramla da meşrulaştırılır.',ornek:'"O köprüyü yıkamazsın, kolektif bellekte yer etmiş"'},
  {tr:'Metabolizm',en:'Metabolism',cat:'kultur',def:'1960\'lı yıllarda Japon mimarların geliştirdiği, yapıları değiştirilebilir modüller halinde tasarlayan fütüristik akım.',not:'Kurokawa, Kikutake öncü isimler. Nakagin Capsule Tower bunun sembolüydü.',ornek:'"Metabolizm: bina artık değişen bir organizma"'},
  {tr:'Art Deco',en:'Art Deco',cat:'kultur',def:'1920-30\'larda hakim olan, geometrik süsleme, zengin malzeme ve gösterişli cephelerle tanınan tasarım akımı.',not:'Chrysler Binası Art Deco\'nun zirvesidir.',ornek:'"Binanın girişindeki süslemeler Art Deco\'dan ilham alıyor"'},
];

let sozlukCat='all';

function setSozlukCat(cat,el){
  sozlukCat=cat;
  document.querySelectorAll('.sozluk-cat').forEach(c=>c.classList.remove('active'));
  el.classList.add('active');
  renderSozluk();
}

function renderSozluk(){
  const q=(document.getElementById('sozlukSearch')?.value||'').toLowerCase().trim();
  let items=[...SOZLUK];
  if(sozlukCat!=='all')items=items.filter(i=>i.cat===sozlukCat);
  if(q)items=items.filter(i=>i.tr.toLowerCase().includes(q)||i.en.toLowerCase().includes(q)||i.def.toLowerCase().includes(q));
  // alfabetik sırala
  items.sort((a,b)=>a.tr.localeCompare(b.tr,'tr'));
  const grid=document.getElementById('sozlukGrid');
  const stats=document.getElementById('sozlukStats');
  if(!grid)return;
  stats.textContent=`${items.length} terim`+(sozlukCat!=='all'||q?' · filtrelendi':'');
  if(!items.length){grid.innerHTML='<div class="sozluk-empty">// arama sonucu bulunamadı</div>';return;}
  const catLabel={teknik:'teknik',tasarim:'tasarım',malzeme:'malzeme',yazilim:'yazılım',kultur:'kültür'};
  grid.innerHTML=items.map((it,i)=>`
    <div class="sozluk-item" id="sitem-${i}" onclick="toggleSozlukItem(this)">
      <div class="sozluk-item-head">
        <span class="sozluk-term">${esc(it.tr)}</span>
        <span class="sozluk-en">${esc(it.en)}</span>
        <span class="sozluk-cat-badge cat-${it.cat}">${catLabel[it.cat]||it.cat}</span>
      </div>
      <div class="sozluk-item-body">
        <div class="sozluk-def">${esc(it.def)}</div>
        ${it.not?`<div class="sozluk-note">${esc(it.not)}</div>`:''}
        ${it.ornek?`<div class="sozluk-ornek">${esc(it.ornek)}</div>`:''}
      </div>
    </div>`).join('');
}

function toggleSozlukItem(el){el.classList.toggle('open');}

// ── ÖLÇEK HESAPLAYICI ──
function olcekHesapla(){
  const gercek=parseFloat(document.getElementById('olcekGercek').value);
  const olcek=parseInt(document.getElementById('olcekOlcek').value);
  document.getElementById('olcekCizim').value='';
  if(!gercek||gercek<=0){document.getElementById('olcekSonuc').classList.remove('show');return;}
  const cizim=gercek/olcek;
  renderOlcekSonuc(gercek,cizim,olcek);
}
function olcekTersHesapla(){
  const cizim=parseFloat(document.getElementById('olcekCizim').value);
  const olcek=parseInt(document.getElementById('olcekOlcek').value);
  document.getElementById('olcekGercek').value='';
  if(!cizim||cizim<=0){document.getElementById('olcekSonuc').classList.remove('show');return;}
  const gercek=cizim*olcek;
  renderOlcekSonuc(gercek,cizim,olcek);
}
function renderOlcekSonuc(gercek,cizim,olcek){
  const el=document.getElementById('olcekSonucText');
  const gStr=gercek>=1000?(gercek/1000).toFixed(3)+' m':gercek+' mm';
  el.innerHTML=`<div class="olcek-sonuc-line">Gerçek boyut: <strong>${gStr}</strong></div><div class="olcek-sonuc-line">Çizimde (1:${olcek}): <strong>${cizim.toFixed(2)} mm &nbsp;/&nbsp; ${(cizim/10).toFixed(3)} cm</strong></div>`;
  const olcekler=[20,50,100,200,500,1000];
  document.getElementById('olcekTabloBody').innerHTML=olcekler.map(o=>`<tr style="${o===olcek?'background:var(--surface)':''}"><td>1:${o}</td><td>${(gercek/o).toFixed(2)}</td><td>${(gercek/o/10).toFixed(3)}</td></tr>`).join('');
  document.getElementById('olcekSonuc').classList.add('show');
}

// ── ALAN PROGRAMI ──
const ALAN_DATA={
  konut:{note:'Tek aile konutu için tipik program. Büyüklük arsa ve bütçeye göre değişir.',mekanlar:[
    {ad:'Giriş / Hol',min:6,oner:10,ac:'Dolaşım kurulumu için kritik'},
    {ad:'Oturma Odası',min:20,oner:30,ac:'Günlük kullanım merkezi'},
    {ad:'Mutfak + Yemek',min:18,oner:25,ac:'Açık plan akustik sorun yaratabilir'},
    {ad:'Ana Yatak Odası',min:14,oner:20,ac:'Gardrop+banyo dahil değil'},
    {ad:'Yatak Odası (x2)',min:10,oner:14,ac:'Her biri için'},
    {ad:'Banyo (Ana)',min:6,oner:9,ac:'Duş+küvet+lavabo+WC'},
    {ad:'WC',min:2.5,oner:4,ac:'Misafir tuvaleti'},
    {ad:'Çamaşır / Depo',min:4,oner:8,ac:'Sıklıkla atlanan ama kritik'},
    {ad:'Garaj / Otopark',min:16,oner:25,ac:'2 araç için'},
    {ad:'Teknik Hacim',min:4,oner:6,ac:'Kazan, elektrik panosu vb.'},
  ]},
  kultur:{note:'Küçük/orta ölçekli kültür merkezi. Program büyüklüğe göre ölçeklenir.',mekanlar:[
    {ad:'Giriş / Foyer',min:60,oner:100,ac:'Danışma ve silahlık dahil'},
    {ad:'Çok Amaçlı Salon',min:150,oner:300,ac:'150 kişilik ~150m²'},
    {ad:'Sergi Alanı',min:80,oner:150,ac:'Tavan min 3.5m önerilir'},
    {ad:'Atölye (x2)',min:40,oner:70,ac:'Her biri için'},
    {ad:'Kafe / Kantin',min:50,oner:100,ac:'Mutfak dahil'},
    {ad:'İdari Ofis',min:20,oner:40,ac:'3-5 kişilik'},
    {ad:'WC (Genel)',min:20,oner:35,ac:'Engelli WC dahil'},
    {ad:'Depo / Teknik',min:30,oner:60,ac:'Sahne malzemesi için ekstra'},
    {ad:'Dış Alan / Teras',min:80,oner:200,ac:'İklime göre değişir'},
  ]},
  egitim:{note:'İlk/orta öğretim okulu başına tipik değerler. Yönetmelik kontrol edilmeli.',mekanlar:[
    {ad:'Derslik (30 kişi)',min:54,oner:63,ac:'Kişi başı 1.8-2.1m²'},
    {ad:'Laboratuvar',min:60,oner:80,ac:'Kimya/Fen/Bilişim farklı gerektirir'},
    {ad:'Spor Salonu',min:200,oner:450,ac:'Std basketbol: 28x15m'},
    {ad:'Kütüphane',min:60,oner:120,ac:'Okuma+raf+bilgisayar'},
    {ad:'Yönetim / Rehberlik',min:40,oner:80,ac:'Müdür, müd. yrd., rehberlik'},
    {ad:'Öğretmenler Odası',min:30,oner:60,ac:'Öğretmen sayısına göre'},
    {ad:'Yemekhane',min:100,oner:200,ac:'Mutfak dahil değil'},
    {ad:'WC Blokları',min:30,oner:50,ac:'Kız/erkek ayrı, engelli dahil'},
    {ad:'Depo / Teknik',min:20,oner:40,ac:''},
  ]},
  ofis:{note:'Açık plan ofis. Kişi başı net m² 8-12m² standart kabul görür.',mekanlar:[
    {ad:'Resepsiyon / Lobi',min:20,oner:40,ac:'Şirket imajını temsil eder'},
    {ad:'Açık Çalışma Alanı',min:8,oner:12,ac:'Kişi başı — x çalışan sayısıyla çarp'},
    {ad:'Toplantı Odası (küçük)',min:16,oner:25,ac:'6-8 kişi için'},
    {ad:'Toplantı Odası (büyük)',min:30,oner:50,ac:'12-16 kişi için'},
    {ad:'Müdür Ofisi',min:16,oner:25,ac:'Ses yalıtımı kritik'},
    {ad:'Kafe / Dinlenme',min:20,oner:50,ac:'Sosyal alan üretkenliği artırır'},
    {ad:'Sunucu / Teknik Oda',min:10,oner:20,ac:'İklimlendirme gerekli'},
    {ad:'WC',min:12,oner:20,ac:'Engelli dahil'},
    {ad:'Depo',min:8,oner:15,ac:''},
  ]},
  saglik:{note:'Birinci basamak sağlık merkezi / küçük klinik. Yönetmelik esas alınmalı.',mekanlar:[
    {ad:'Bekleme Salonu',min:20,oner:40,ac:'5-7m²/kişi önerilir'},
    {ad:'Muayene Odası',min:12,oner:18,ac:'Her biri; doğal ışık önerilir'},
    {ad:'Danışma / Kayıt',min:8,oner:15,ac:'Hasta mahremiyeti önemli'},
    {ad:'Tıbbi Depo / Eczane',min:10,oner:20,ac:'Sıcaklık kontrolü gerekli'},
    {ad:'Hemşire İstasyonu',min:8,oner:15,ac:'Merkezi konumda olmalı'},
    {ad:'Sterilizasyon Odası',min:8,oner:12,ac:'Kirli-temiz ayrımı kritik'},
    {ad:'WC (Hasta/Personel)',min:10,oner:20,ac:'Engelli WC zorunlu'},
    {ad:'Personel Odası',min:10,oner:20,ac:'Dinlenme+soyunma'},
    {ad:'Teknik / Temizlik',min:6,oner:12,ac:''},
  ]}
};
let aktifAlanTip='konut';
function setAlanTip(el,tip){
  aktifAlanTip=tip;
  document.querySelectorAll('.alan-tip').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
  renderAlanProgram();
}
function renderAlanProgram(){
  const data=ALAN_DATA[aktifAlanTip];
  const wrap=document.getElementById('alanTabloWrap');
  if(!wrap||!data)return;
  const tMin=data.mekanlar.reduce((s,m)=>s+m.min,0);
  const tOner=data.mekanlar.reduce((s,m)=>s+m.oner,0);
  wrap.innerHTML=`<table class="alan-table">
    <thead><tr><th>mekan</th><th>min m²</th><th>önerilen m²</th><th>not</th></tr></thead>
    <tbody>
      ${data.mekanlar.map(m=>`<tr><td>${esc(m.ad)}</td><td>${m.min}</td><td>${m.oner}</td><td>${esc(m.ac)}</td></tr>`).join('')}
      <tr style="border-top:2px solid var(--border)"><td><strong>TOPLAM</strong></td><td><strong>${tMin}</strong></td><td><strong>${tOner}</strong></td><td></td></tr>
    </tbody>
  </table>
  <div class="alan-note">// ${esc(data.note)}</div>`;
}

// ── BİNGO ──
const BINGO_HAVUZ=[
  'Bu çok komplike','Revize lazım','Neden eğik?','Işığı düşündün mü?','Bağlam ne?',
  'Maket yok mu?','Ölçek sorunu var','Referansın ne?','Strüktür nasıl?','Çok dekoratif',
  'Daha sade olsa','Bu fonksiyon nerede?','Giriş net değil','Program tutmuyor','Neden bu malzeme?',
  'Akış şeması?','İnsan ölçeği kaybolmuş','Sürdürülebilirlik?','Bütçeyi düşündün mü?','Erişilebilirlik?',
  'Genel dokudan kopuk','Bu form nereden geldi?','Konsept tutarsız','İyi başlangıç ama...','Daha cesur olabilirdin',
  'Neden bu yönelim?','Harika fikir ama...','Tekrar düşün','Acele edilmiş gibi','Potansiyeli var',
  'Yapılabilir mi?','Yönetmeliğe uygun mu?','Keşke daha erken gelseydin','Bu proje seni anlatıyor mu?','Projeyi sahiplen',
];
let bingoKart=[],bingoIsaretli=new Set();
function newBingo(){
  const k=[...BINGO_HAVUZ].sort(()=>Math.random()-.5).slice(0,24);
  k.splice(12,0,'★ FREE');
  bingoKart=k;
  bingoIsaretli=new Set([12]);
  renderBingo();
}
function toggleBingo(i){
  if(i===12)return;
  if(bingoIsaretli.has(i))bingoIsaretli.delete(i);
  else bingoIsaretli.add(i);
  renderBingo();
}
function checkBingo(){
  const lines=[[0,1,2,3,4],[5,6,7,8,9],[10,11,12,13,14],[15,16,17,18,19],[20,21,22,23,24],[0,5,10,15,20],[1,6,11,16,21],[2,7,12,17,22],[3,8,13,18,23],[4,9,14,19,24],[0,6,12,18,24],[4,8,12,16,20]];
  const bl=lines.filter(l=>l.every(i=>bingoIsaretli.has(i)));
  return{bingo:bl.length>0,lines:new Set(bl.flat())};
}
function renderBingo(){
  const grid=document.getElementById('bingoGrid');
  const status=document.getElementById('bingoStatus');
  if(!grid||!bingoKart.length)return;
  const{bingo,lines}=checkBingo();
  grid.innerHTML=bingoKart.map((cell,i)=>{
    const free=i===12,line=lines.has(i),marked=bingoIsaretli.has(i);
    const cls=free?'bingo-cell free':line?'bingo-cell bingo-line':marked?'bingo-cell marked':'bingo-cell';
    return`<div class="${cls}" onclick="toggleBingo(${i})">${esc(cell)}</div>`;
  }).join('');
  status.textContent=bingo?'🎉 BİNGO! Jüriler tahmin edilebilir.':bingoIsaretli.size>1?`${bingoIsaretli.size-1} işaretli`:'';
}

// ── PROJE FİKİR ÜRETİCİ ──
const FIKIR_DATA={
  program:['Toplumsal mutfak','Kayıp nesneler müzesi','Gezici kütüphane','Dönüşüm atölyesi','Kent arşivi','Buluşma pavyonu','Küçük opera sahnesi','Çocuk bahçesi & atölye','Yaşlı aktivite merkezi','Kentsel tarım kulesi','Tamir kafe','Hafıza merkezi','Su üstü yapı','Yer altı parkı dönüşümü','Acil barınak','Açık hava sineması','Sokak kütüphanesi','Biyoçeşitlilik noktası'],
  arazi:['Terk edilmiş fabrika','Köprü altı','Boş ada ortası','Eğimli kent parçası','Kıyı şeridi','Tarihi yapı bitişiği','Çatı katı','Metro çıkışı çevresi','Eski mezarlık','Terk edilmiş istasyon','Yıkılmak üzere bina','Sanayi bölgesi sınırı','Pazar yeri alanı','Su kenarı set','Tünel girişi','Otopark üstü','Boş köşe arsa'],
  kisit:['Yalnızca ahşap malzeme','Mobil / sökülebilir','Minimal bütçe','Işık tek tasarım aracı','Tek malzeme cephe','Yer altında','Yerden 5m yukarıda','Kamuya tam şeffaf','Kullanıcı kendin yapabilmeli','Atık malzemeden','Hiç pencere yok','Yalnızca geri dönüştürülmüş','Sıfır sert zemin','Mevsimsel','Hiç kolon yok','24 saat açık','Sessiz yapı'],
  kavram:['Geçicilik ve iz','Eşik ve geçiş','Sessizlik','Kolektif bellek','Saydamlık ve mahremiyet','Toprak ve köklenmek','Su ve akış','Işık ve gölge ritmi','Yoğunlaşma ve dağılma','Ağırlık ve hafiflik','Görünürlük ve saklanma','İç ve dışın bulanması','Zaman katmanları','Tamamlanmamışlık','Parça ve bütün','Tekrar ve ritim','Boşluk ve doluluk']
};
function projeUret(){
  const rand=arr=>arr[Math.floor(Math.random()*arr.length)];
  const s=[{l:'program',v:rand(FIKIR_DATA.program)},{l:'arazi',v:rand(FIKIR_DATA.arazi)},{l:'kısıt',v:rand(FIKIR_DATA.kisit)},{l:'kavram',v:rand(FIKIR_DATA.kavram)}];
  document.getElementById('fikirdegerler').innerHTML=s.map(x=>`<div class="fikir-satir"><span class="fikir-label">// ${esc(x.l)}</span><span class="fikir-deger">${esc(x.v)}</span></div>`).join('');
  document.getElementById('fikirkart').classList.add('show');
}

// ── ETKİNLİKLER ──
const ETKINLIK_KEY='duvar_etkinlikler';
let etkinlikFilter='all';
function setEtkinlikFilter(f,el){
  etkinlikFilter=f;
  document.querySelectorAll('.etkinlik-filter').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
  renderEtkinlikler();
}
async function renderEtkinlikler(){
  const {data}=await sb.from('etkinlikler').select('*').eq('aktif',true).order('created_at',{ascending:false});
  const all=data||[];
  const filtered=etkinlikFilter==='all'?all:all.filter(e=>e.tip===etkinlikFilter);
  const grid=document.getElementById('etkinlikGrid');
  const stats=document.getElementById('etkinlikStats');
  if(!grid)return;
  stats.textContent=`${filtered.length} etkinlik`+(etkinlikFilter!=='all'?' · filtrelendi':'');
  if(!filtered.length){
    grid.innerHTML='<div class="etkinlik-empty">// şu an duyuru yok · yeni etkinlikler eklendiğinde burada görünür</div>';
    return;
  }
  const tipLabel={yarisma:'yarışma',festival:'festival',etkinlik:'etkinlik',workshop:'workshop',seminer:'seminer'};
  const bugun=Date.now();
  grid.innerHTML=[...filtered].reverse().map(e=>{
    const etkinlikTarih=e.etkinlikTarih?new Date(e.etkinlikTarih):null;
    const son=e.son?new Date(e.son):null;
    const gecti=son&&son.getTime()<bugun;
    return`<div class="etkinlik-card ${e.tip}">
      <div class="etkinlik-head">
        <div>
          <div class="etkinlik-baslik">${esc(e.baslik)}</div>
          ${e.organizator?`<div class="etkinlik-org">${esc(e.organizator)}</div>`:''}
        </div>
        <span class="etkinlik-tip-badge tip-${e.tip}">${tipLabel[e.tip]||e.tip}</span>
      </div>
      <div class="etkinlik-aciklama">${esc(e.aciklama)}</div>
      <div class="etkinlik-meta">
        ${e.sehir?`<span>📍 ${esc(e.sehir)}</span>`:''}
        ${etkinlikTarih?`<span>📅 ${etkinlikTarih.toLocaleDateString('tr-TR',{day:'numeric',month:'long',year:'numeric'})}</span>`:''}
        ${son?`<span style="${gecti?'color:var(--red)':''}">⏳ son başvuru: ${son.toLocaleDateString('tr-TR',{day:'numeric',month:'long'})}${gecti?' (sona erdi)':''}</span>`:''}
      </div>
      ${e.link?`<div class="etkinlik-link">→ ${esc(e.link)}</div>`:''}
    </div>`;
  }).join('');
}

// ── İLANLAR ──
let ilanFilter='all';
function setIlanFilter(f,el){
  ilanFilter=f;
  document.querySelectorAll('.ilan-filter').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
  renderIlanlar();
}
async function renderIlanlar(){
  const {data}=await sb.from('ilanlar').select('*').eq('aktif',true).order('created_at',{ascending:false});
  const all=data||[];
  const filtered=ilanFilter==='all'?all:all.filter(il=>il.tip===ilanFilter);
  const grid=document.getElementById('ilanlarGrid');
  const stats=document.getElementById('ilanlarStats');
  if(!grid)return;
  stats.textContent=`${filtered.length} ilan`+(ilanFilter!=='all'?' · filtrelendi':'');
  if(!filtered.length){
    grid.innerHTML='<div class="ilan-empty">// şu an ilan yok · yeni ilanlar eklendiğinde burada görünür</div>';
    return;
  }
  const tipLabel={staj:'staj',tam:'tam zamanlı',yari:'yarı zamanlı'};
  const bugun=Date.now();
  grid.innerHTML=[...filtered].reverse().map(il=>{
    const son=il.son?new Date(il.son):null;
    const gecti=son&&son.getTime()<bugun;
    const sonStr=son?son.toLocaleDateString('tr-TR',{day:'numeric',month:'long',year:'numeric'}):'';
    return`<div class="ilan-card ${il.tip}">
      <div class="ilan-head">
        <div>
          <div class="ilan-ofis">${esc(il.sirket||il.ofis||'')}</div>
          <div class="ilan-baslik">${esc(il.baslik)}</div>
        </div>
        <span class="ilan-tip-badge ilan-tip-${il.tip}">${tipLabel[il.tip]||il.tip}</span>
      </div>
      <div class="ilan-aciklama">${esc(il.aciklama)}</div>
      <div class="ilan-meta">
        ${il.sehir?`<span>📍 ${esc(il.sehir)}</span>`:''}
        ${sonStr?`<span style="${gecti?'color:var(--red)':''}">⏳ son: ${sonStr}${gecti?' (sona erdi)':''}</span>`:''}
        <span>📅 ${new Date(il.tarih).toLocaleDateString('tr-TR')}</span>
      </div>
      ${il.iletisim?`<div class="ilan-iletisim">→ ${esc(il.iletisim)}</div>`:''}
    </div>`;
  }).join('');
}

// ── GERİ BİLDİRİM ──
const FEEDBACK_KEY='duvar_feedback';
let feedbackType='oneri';
function openFeedback(){document.getElementById('feedbackModal').classList.remove('hidden');document.getElementById('feedbackText').value='';}
function closeFeedback(){document.getElementById('feedbackModal').classList.add('hidden');}
function selectFeedbackType(el,type){
  feedbackType=type;
  document.querySelectorAll('.feedback-type').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
}
async function submitFeedback(){
  const text=document.getElementById('feedbackText').value.trim();
  if(text.length<5){toast('// en az 5 karakter yaz');return;}
  const ok=await sbFeedback(feedbackType,text);
  closeFeedback();
  toast(ok?'// geri bildirim gönderildi, teşekkürler':'// hata oluştu, tekrar dene');
}

// ── INIT: STATIK EVENT LISTENER'LAR ──

// Tag-link delegation (XSS güvenli)
document.getElementById('postsGrid').addEventListener('click',e=>{
  const tl=e.target.closest('.tag-link');
  if(tl&&tl.dataset.tag)setTagFilter(tl.dataset.tag);
  const db=e.target.closest('.devami-btn');
  if(db&&db.dataset.pid)expandPost(parseInt(db.dataset.pid));
});

// Welcome
document.querySelectorAll('.welcome-cta,.welcome-skip').forEach(b=>b.addEventListener('click',dismissWelcome));

// Auth sekmeler
document.querySelectorAll('.modal-tab[data-tab]').forEach(b=>b.addEventListener('click',()=>switchAuthTab(b.dataset.tab)));

// Auth şifre gücü
document.getElementById('authPass').addEventListener('input',function(){checkPassStrength(this.value);});

// Auth button, misafir
document.getElementById('authBtn').addEventListener('click',handleAuth);
document.querySelector('.guest-btn').addEventListener('click',enterAsGuest);

// Panel overlay + tüm panel-close butonları
document.getElementById('panelOverlay').addEventListener('click',closePanels);
document.querySelectorAll('.panel-close').forEach(b=>b.addEventListener('click',closePanels));

// Nick değiştir
const showNickBtn=document.getElementById('showNickChangeBtn');
if(showNickBtn)showNickBtn.addEventListener('click',showNickChange);
const nickSaveBtn=document.getElementById('nickSaveBtn');
if(nickSaveBtn)nickSaveBtn.addEventListener('click',changeNick);
const newNickInput=document.getElementById('newNickInput');
if(newNickInput)newNickInput.addEventListener('keydown',e=>{if(e.key==='Enter')changeNick();});

// Push, çıkış, hesap sil
const pushBtn=document.getElementById('pushToggleBtn');
if(pushBtn)pushBtn.addEventListener('click',togglePushBtn);
const logoutBtn=document.getElementById('logoutBtn');
if(logoutBtn)logoutBtn.addEventListener('click',logout);
const deleteAccountBtn=document.getElementById('deleteAccountBtn');
if(deleteAccountBtn)deleteAccountBtn.addEventListener('click',deleteAccount);

// Report seçenekleri (delegation)
document.querySelectorAll('.report-opt[data-reason]').forEach(b=>b.addEventListener('click',()=>selectReason(b,b.dataset.reason)));
document.getElementById('reportSendBtn').addEventListener('click',submitReport);
document.getElementById('reportCancelBtn').addEventListener('click',closeReport);

// Terms
document.getElementById('termsCloseBtn').addEventListener('click',closeTerms);

// Header kontrolleri
document.getElementById('themeBtn').addEventListener('click',toggleTheme);
document.getElementById('dmBtn').addEventListener('click',openDMs);
document.getElementById('notifBtn').addEventListener('click',openNotifs);
document.getElementById('userNickDisplay').addEventListener('click',openProfile);
document.getElementById('loginBtn').addEventListener('click',showAuth);
const lockLink=document.getElementById('lockNoticeLink');
if(lockLink)lockLink.addEventListener('click',showAuth);

// Nav tabları
document.querySelectorAll('.nav-tab[data-nav]').forEach(b=>b.addEventListener('click',()=>switchNav(b.dataset.nav)));

// Filter chips (delegation)
document.querySelector('.filter-bar').addEventListener('click',e=>{
  const chip=e.target.closest('.filter-chip[data-filter]');
  if(!chip)return;
  setFilter(chip.dataset.filter,chip,chip.dataset.kind||null);
});

// Search
document.getElementById('searchInput').addEventListener('input',render);

// Sort butonları
document.querySelectorAll('.sort-btn[data-sort]').forEach(b=>b.addEventListener('click',()=>setSort(b.dataset.sort,b)));

// Anket toggle
document.getElementById('anketToggle').addEventListener('click',toggleAnket);

// Draft kaydet
document.getElementById('mainInput').addEventListener('input',saveDraft);

// Gönderi gönder
document.getElementById('addPostBtn').addEventListener('click',addPost);

// Mood ve Type pill'leri (delegation)
document.querySelector('.write-box').addEventListener('click',e=>{
  const moodBtn=e.target.closest('.pill[data-mood]');
  if(moodBtn){selectMood(moodBtn,moodBtn.dataset.mood);return;}
  const typeBtn=e.target.closest('.pill[data-type]');
  if(typeBtn)selectType(typeBtn,typeBtn.dataset.type);
});

// Guide card'lar (delegation)
document.querySelectorAll('.guide-grid').forEach(g=>g.addEventListener('click',e=>{
  const card=e.target.closest('.guide-card');
  if(card)toggleCard(card);
}));

// Footer
const openFeedbackBtn=document.getElementById('openFeedbackBtn')||document.getElementById('openFeedbackBtn2');
if(openFeedbackBtn)openFeedbackBtn.addEventListener('click',openFeedback);
const openTermsBtn=document.getElementById('openTermsBtn')||document.getElementById('openTermsBtn2');
if(openTermsBtn)openTermsBtn.addEventListener('click',openTerms);
const modLoginBtnEl=document.getElementById('modLoginBtn');
if(modLoginBtnEl)modLoginBtnEl.addEventListener('click',openModLogin);
const modLogoutBtnEl=document.getElementById('modLogoutBtn');
if(modLogoutBtnEl)modLogoutBtnEl.addEventListener('click',modLogout);

// Mod giriş modal
const modLoginBtn2=document.getElementById('modLoginBtn2');
if(modLoginBtn2)modLoginBtn2.addEventListener('click',modLogin);
const modCloseBtn=document.getElementById('modCloseBtn');
if(modCloseBtn)modCloseBtn.addEventListener('click',closeModLogin);
const modBarLogout=document.getElementById('modBarLogoutBtn');
if(modBarLogout)modBarLogout.addEventListener('click',modLogout);

// Feedback modal
const feedbackFloatBtn=document.getElementById('feedbackFloatBtn');
if(feedbackFloatBtn)feedbackFloatBtn.addEventListener('click',openFeedback);
document.querySelectorAll('.feedback-type[data-feedback-type]').forEach(b=>b.addEventListener('click',()=>selectFeedbackType(b,b.dataset.feedbackType)));
const feedbackCancelBtn=document.getElementById('feedbackCancelBtn');
if(feedbackCancelBtn)feedbackCancelBtn.addEventListener('click',closeFeedback);
const feedbackSendBtn=document.getElementById('feedbackSendBtn');
if(feedbackSendBtn)feedbackSendBtn.addEventListener('click',submitFeedback);

// Uprofile overlay kapat
const uprofileOverlay=document.getElementById('uprofileOverlay');
if(uprofileOverlay)uprofileOverlay.addEventListener('click',closeUProfile);
const uprofileBox=document.getElementById('uprofileBox');
if(uprofileBox)uprofileBox.addEventListener('click',e=>e.stopPropagation());
const uprofileCloseBtn=document.getElementById('uprofileCloseBtn');
if(uprofileCloseBtn)uprofileCloseBtn.addEventListener('click',closeUProfile);

// Araç tabları
document.querySelectorAll('.arac-tab[data-arac]').forEach(b=>b.addEventListener('click',()=>switchArac(b.dataset.arac)));

// Araç: Teslim sayacı
const sayacEkleBtn=document.getElementById('sayacEkleBtn');
if(sayacEkleBtn)sayacEkleBtn.addEventListener('click',sayacEkle);

// Araç: Jüri simülatörü
document.querySelectorAll('.juri-type[data-juri-type]').forEach(b=>b.addEventListener('click',()=>selectJuriType(b,b.dataset.juriType)));
const juriUretBtn=document.getElementById('juriUretBtn');
if(juriUretBtn)juriUretBtn.addEventListener('click',juriUret);
const juriRegenBtn=document.getElementById('juriRegenBtn');
if(juriRegenBtn)juriRegenBtn.addEventListener('click',juriUret);

// Araç: Ölçek hesap
const olcekGercek=document.getElementById('olcekGercek');
if(olcekGercek)olcekGercek.addEventListener('input',olcekHesapla);
const olcekOlcek=document.getElementById('olcekOlcek');
if(olcekOlcek)olcekOlcek.addEventListener('change',olcekHesapla);
const olcekCizim=document.getElementById('olcekCizim');
if(olcekCizim)olcekCizim.addEventListener('input',olcekTersHesapla);

// Araç: Alan programı
document.querySelectorAll('.alan-tip[data-alan-tip]').forEach(b=>b.addEventListener('click',()=>setAlanTip(b,b.dataset.alanTip)));

// Araç: Bingo
const newBingoBtn=document.getElementById('newBingoBtn');
if(newBingoBtn)newBingoBtn.addEventListener('click',newBingo);

// Araç: Proje fikir
const projeUretBtn=document.getElementById('projeUretBtn');
if(projeUretBtn)projeUretBtn.addEventListener('click',projeUret);

// Araç: Yazılım rehberi
document.querySelectorAll('.yazilim-tab[data-yazilim]').forEach(b=>b.addEventListener('click',()=>switchYazilim(b.dataset.yazilim)));

// Araç: Program hesaplayıcı
const programHesaplaBtn=document.getElementById('programHesaplaBtn');
if(programHesaplaBtn)programHesaplaBtn.addEventListener('click',renderProgramSonuc);
const programAlan=document.getElementById('programAlan');
if(programAlan)programAlan.addEventListener('input',renderProgramSonuc);
const programTur=document.getElementById('programTur');
if(programTur)programTur.addEventListener('change',renderProgramSonuc);
const programKat=document.getElementById('programKat');
if(programKat)programKat.addEventListener('input',renderProgramSonuc);

// Araç: Renk paleti
document.querySelectorAll('.palet-kat[data-palet]').forEach(b=>b.addEventListener('click',()=>setPalet(b.dataset.palet)));
const paletUretBtn=document.getElementById('paletUretBtn');
if(paletUretBtn)paletUretBtn.addEventListener('click',renderPalet);

// Araç: Yapay Zeka
document.querySelectorAll('#aiTablar .yazilim-tab[data-ai]').forEach(b=>b.addEventListener('click',()=>switchAiTab(b.dataset.ai)));

// Araç: CV şablonu
document.querySelectorAll('.cv-input,.cv-textarea').forEach(el=>el.addEventListener('input',renderCvPreview));
const cvYazdirBtn=document.getElementById('cvYazdir');
if(cvYazdirBtn)cvYazdirBtn.addEventListener('click',cvYazdir);

// Sözlük
const sozlukSearch=document.getElementById('sozlukSearch');
if(sozlukSearch)sozlukSearch.addEventListener('input',renderSozluk);
document.querySelectorAll('.sozluk-cat[data-sozluk-cat]').forEach(b=>b.addEventListener('click',()=>setSozlukCat(b.dataset.sozlukCat,b)));

// Etkinlik filter
document.querySelectorAll('.etkinlik-filter[data-etkinlik-filter]').forEach(b=>b.addEventListener('click',()=>setEtkinlikFilter(b.dataset.etkinlikFilter,b)));

// İlan filter
document.querySelectorAll('.ilan-filter[data-ilan-filter]').forEach(b=>b.addEventListener('click',()=>setIlanFilter(b.dataset.ilanFilter,b)));

// Radyo
(function(){
  const floatBtn=document.getElementById('radioFloatBtn');
  const player=document.getElementById('radioPlayer');
  const closeBtn=document.getElementById('radioCloseBtn');
  if(!floatBtn||!player)return;
  floatBtn.addEventListener('click',()=>player.classList.toggle('open'));
  closeBtn.addEventListener('click',()=>player.classList.remove('open'));
  document.querySelectorAll('.radio-tab[data-radio]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('.radio-tab').forEach(b=>b.classList.remove('active'));
      document.querySelectorAll('.radio-panel').forEach(p=>p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('radio-'+btn.dataset.radio).classList.add('active');
    });
  });
})();


document.getElementById('mainInput').addEventListener('input',function(){
  const l=500-this.value.length;
  const el=document.getElementById('charCount');
  el.textContent=l+' karakter kaldı';
  el.classList.toggle('warn',l<50);
});
document.getElementById('mainInput').addEventListener('keydown',e=>{if(e.ctrlKey&&e.key==='Enter')addPost();});
document.getElementById('modPass').addEventListener('keydown',e=>{if(e.key==='Enter')modLogin();});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModLogin();});
document.getElementById('authPass').addEventListener('keydown',e=>{if(e.key==='Enter')handleAuth();});
document.getElementById('authPassConfirm').addEventListener('keydown',e=>{if(e.key==='Enter')handleAuth();});
document.addEventListener('keydown',e=>{
  if(e.key==='Enter'&&!e.shiftKey&&e.target.classList.contains('comment-input')){
    e.preventDefault();
    const id=e.target.id.replace('ci-','');
    sendComment(id);
  }
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeReport();closeTerms();closePanels();closeUProfile();}});
document.addEventListener('keydown',e=>{
  if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA')return;
  if(e.key==='/'){ e.preventDefault();const s=document.getElementById('searchInput');s.focus();s.scrollIntoView({behavior:'smooth',block:'center'});}
  if((e.key==='n'||e.key==='N')&&!e.ctrlKey&&!e.metaKey){
    if(!currentUser)return;
    e.preventDefault();const m=document.getElementById('mainInput');m.focus();m.scrollIntoView({behavior:'smooth',block:'center'});
  }
});

function showWelcomeOrAuth(){
  if(localStorage.getItem('duvar_welcomed')){document.getElementById('authModal').classList.remove('hidden');}
  else{document.getElementById('welcomeScreen').classList.remove('hidden');}
}

// ── CANLI ZAMAN ──
setInterval(()=>render(),60000);

// Eski localStorage auth sisteminden temizlik (bir kerelik)
if(localStorage.getItem('duvar_users')){localStorage.removeItem('duvar_users');localStorage.removeItem('duvar_session');}

// ── POSTLARI YÜKLE + SESSION RESTORE ──
(()=>{
  const g=document.getElementById('postsGrid');
  const sk=()=>'<div class="skel"><div class="skel-line short"></div><div class="skel-line full"></div><div class="skel-line med"></div></div>';
  g.innerHTML=sk()+sk()+sk()+sk()+sk();
})();
// Supabase Auth session kontrol (sunucu doğrulamalı)
(async()=>{
  const {data:{session}}=await sb.auth.getSession();
  if(session){
    // session.user.user_metadata.nick'ten nick al (kayıt sırasında set edildi)
    const nick=session.user.user_metadata?.nick;
    if(nick){
      // Ban kontrolü
      const {data:row}=await sb.from('kullanicilar').select('banli').eq('nick',nick).maybeSingle();
      if(row&&!row.banli){loginSuccess(nick);}
      else{await sb.auth.signOut();showWelcomeOrAuth();}
    }else{await sb.auth.signOut();showWelcomeOrAuth();}
  }else{showWelcomeOrAuth();}
  await loadPosts();
  handlePermalink();
  restoreDraft();
  // ziyaret kaydı — bot/crawler hariç
  if(!navigator.userAgent.match(/bot|crawl|spider|slurp|facebook|twitter/i)){
    sb.from('page_views').insert({}).then(()=>{}).catch(()=>{});
  }
})();
if('serviceWorker' in navigator){navigator.serviceWorker.register('sw.js').catch(()=>{});}