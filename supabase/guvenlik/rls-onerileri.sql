-- ════════════════════════════════════════════════════════════════════════════
-- DUVAR — Supabase güvenlik kuralları (RLS) önerileri
-- ════════════════════════════════════════════════════════════════════════════
-- BU DOSYA OTOMATİK UYGULANMAZ. Tablo yapısını / veriyi değiştirmez; sadece kim
-- neyi okuyup yazabilir kurallarını sıkılaştırır.
--
-- Neden gerekli: Sitedeki anon anahtar herkese açıktır (bu normaldir). Bu yüzden
-- tarayıcıdaki "moderatör mü?", "kendi gönderisi mi?" kontrolleri tek başına
-- koruma DEĞİLDİR; herkes konsoldan doğrudan Supabase'e istek atabilir. Asıl
-- koruma aşağıdaki gibi veritabanı kurallarıdır.
--
-- NASIL UYGULANIR:
--   1) Önce ADIM 0'daki sorgularla mevcut durumu gör (SQL Editor'da çalıştır).
--   2) Mümkünse önce bir test projesinde / yedek aldıktan sonra uygula.
--   3) Bölüm bölüm çalıştır, her bölümden sonra siteyi (gönderi yaz, yanıtla,
--      destek ver, mod paneli) dene.
--   4) 'ADMIN_EPOSTA_BURAYA' yazan yere admin e-postanı yaz.
-- ════════════════════════════════════════════════════════════════════════════


-- ── ADIM 0: Mevcut durumu gör ───────────────────────────────────────────────
-- RLS kapalı tablo kalmamalı (rowsecurity = false olan her tablo herkese açık):
select tablename, rowsecurity from pg_tables where schemaname = 'public' order by 1;
-- Tanımlı kurallar:
select tablename, policyname, cmd, roles, qual, with_check from pg_policies where schemaname = 'public' order by 1, 2;
-- Beğeni RPC'lerinin tanımı (p_nick parametresine güveniyorlar mı?):
select proname, prosecdef, pg_get_functiondef(oid) from pg_proc
 where pronamespace = 'public'::regnamespace and proname in ('artir_begen','geri_al_begen','artir_begenmeme','geri_al_begenmeme');


-- ── ADIM 1: Yardımcı fonksiyonlar ───────────────────────────────────────────
-- Oturumdaki kullanıcının nick'i (kullanicilar.auth_id üzerinden)
create or replace function public.my_nick() returns text
language sql stable security definer set search_path = public as $$
  select nick from kullanicilar where auth_id = auth.uid() limit 1
$$;

-- Moderatör mü? (kullanicilar.mod = true veya admin e-postası)
create or replace function public.is_mod() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select mod from kullanicilar where auth_id = auth.uid() limit 1), false)
      or coalesce(auth.jwt() ->> 'email', '') = 'ADMIN_EPOSTA_BURAYA'
$$;

-- Banlı mı?
create or replace function public.is_banned() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select banli from kullanicilar where auth_id = auth.uid() limit 1), false)
$$;


-- ── ADIM 2: kullanicilar — kimse kendini mod yapamasın / banını kaldıramasın ─
-- Şu an istemci kendi satırını güncelleyebiliyor (avatar, nick). Kolon kontrolü
-- yoksa aynı yetkiyle  update({mod:true, banli:false})  de çalışır.
-- Bu tetikleyici mod/banli/auth_id değişikliğini sadece moderatöre bırakır.
create or replace function public.kullanicilar_koru() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Servis anahtarı / SQL Editor (oturumsuz) ve moderatörler serbest
  if coalesce(auth.role(), 'service_role') = 'service_role' or public.is_mod() then return new; end if;
  if tg_op = 'INSERT' then
    new.mod := false;
    new.banli := false;
    new.auth_id := auth.uid();
    return new;
  end if;
  if new.mod is distinct from old.mod or new.banli is distinct from old.banli then
    raise exception 'yetkisiz alan değişikliği';
  end if;
  -- auth_id sadece boşsa ve kullanıcının kendi id'si yazılıyorsa (eski hesap bağlama) değişebilir
  if new.auth_id is distinct from old.auth_id
     and not (old.auth_id is null and new.auth_id = auth.uid()) then
    raise exception 'yetkisiz alan değişikliği';
  end if;
  return new;
end $$;
drop trigger if exists kullanicilar_koru on public.kullanicilar;
create trigger kullanicilar_koru before insert or update on public.kullanicilar
  for each row execute function public.kullanicilar_koru();

-- alter table public.kullanicilar enable row level security;
-- Örnek kurallar (mevcut kurallarınla çakışıyorsa önce onları gözden geçir):
-- create policy kul_oku   on public.kullanicilar for select using (true);
-- create policy kul_ekle  on public.kullanicilar for insert to authenticated with check (auth_id = auth.uid());
-- create policy kul_guncelle on public.kullanicilar for update to authenticated
--   using (auth_id = auth.uid() or (auth_id is null and nick = (auth.jwt()->'user_metadata'->>'nick')) or public.is_mod());
-- create policy kul_sil   on public.kullanicilar for delete to authenticated using (auth_id = auth.uid() or public.is_mod());


-- ⚠ DİKKAT: Aşağıdaki "alter table … enable row level security" satırları bilerek yorum
-- satırı. RLS'i kuralı olmayan bir tabloda açmak o tabloyu herkese KAPATIR (site bozulur).
-- Önce ADIM 0 çıktısına bak; bir tablo için kuralları yazıp test ettikten sonra RLS'i aç.

-- ── ADIM 3: Başkası adına yazılamasın ───────────────────────────────────────
-- İstemci author / nick / from_user alanlarını kendisi gönderiyor; veritabanı
-- bunun oturumdaki kullanıcıya ait olduğunu kontrol etmeli.
-- alter table public.posts enable row level security;
-- create policy posts_oku    on public.posts for select using (aktif = true or public.is_mod() or author = public.my_nick());
-- create policy posts_ekle   on public.posts for insert to authenticated
--   with check (author = public.my_nick() and not public.is_banned() and coalesce(pinned,false) = false);
-- create policy posts_guncelle on public.posts for update to authenticated using (public.is_mod());   -- sabitleme vb. sadece mod
-- create policy posts_sil    on public.posts for delete to authenticated using (author = public.my_nick() or public.is_mod());
-- NOT: nick değiştirme (changeNick) posts.author'u istemciden güncelliyor; posts_guncelle
-- sadece mod'a izin verirse bu adım bir edge function'a / security definer fonksiyona taşınmalı.

-- alter table public.yorumlar enable row level security;
-- create policy yorum_oku  on public.yorumlar for select using (true);
-- create policy yorum_ekle on public.yorumlar for insert to authenticated with check (nick = public.my_nick() and not public.is_banned());
-- create policy yorum_sil  on public.yorumlar for delete to authenticated using (nick = public.my_nick() or public.is_mod());

-- alter table public.notifications enable row level security;
-- create policy bildirim_oku  on public.notifications for select to authenticated using (to_user = public.my_nick());
-- create policy bildirim_ekle on public.notifications for insert to authenticated with check (from_user = public.my_nick());
-- create policy bildirim_okundu on public.notifications for update to authenticated using (to_user = public.my_nick());

-- alter table public.anket_oylar enable row level security;
-- create policy oy_oku  on public.anket_oylar for select using (true);
-- create policy oy_yaz  on public.anket_oylar for all to authenticated using (nick = public.my_nick()) with check (nick = public.my_nick());

-- alter table public.mesajlar enable row level security;   -- DM arayüzde kapalı; veriler sadece taraflarca okunabilsin
-- create policy dm_oku  on public.mesajlar for select to authenticated using (gonderen = public.my_nick() or alici = public.my_nick());
-- create policy dm_ekle on public.mesajlar for insert to authenticated with check (gonderen = public.my_nick());

-- alter table public.push_subscriptions enable row level security;
-- create policy push_kendi on public.push_subscriptions for all to authenticated using (nick = public.my_nick()) with check (nick = public.my_nick());

-- alter table public.raporlar enable row level security;
-- create policy rapor_ekle on public.raporlar for insert to authenticated with check (bildiren = public.my_nick());
-- create policy rapor_mod  on public.raporlar for select to authenticated using (public.is_mod());

-- alter table public.feedback enable row level security;
-- create policy fb_ekle on public.feedback for insert with check (true);
-- create policy fb_mod  on public.feedback for select to authenticated using (public.is_mod());

-- alter table public.etkinlikler enable row level security;
-- alter table public.ilanlar enable row level security;
-- create policy etk_oku on public.etkinlikler for select using (aktif = true or public.is_mod());
-- create policy etk_mod on public.etkinlikler for all to authenticated using (public.is_mod()) with check (public.is_mod());
-- (ilanlar için aynısı)


-- ── ADIM 4: Beğeni RPC'leri ─────────────────────────────────────────────────
-- artir_begen(p_id, p_nick) nick'i istemciden alıyor. Fonksiyon "security definer"
-- ise herkes başka nick'ler göndererek beğeni sayısını şişirebilir. Fonksiyonun
-- içinde p_nick yerine public.my_nick() kullan (parametre imzası aynı kalabilir):
--   if p_nick is distinct from public.my_nick() then raise exception 'yetkisiz'; end if;


-- ── ADIM 5 (isteğe bağlı): Değer kısıtları ──────────────────────────────────
-- Bunlar tabloya kısıt ekler (veriyi değiştirmez, ama mevcut veride aykırı değer varsa
-- eklenemez — önce kontrol sorgusunu çalıştır). İstemci artık bu alanları kaçırarak
-- basıyor; kısıt, ileride yazılacak kodu da korur.
-- select distinct type from posts; select distinct mood from posts; select distinct tip from feedback;
-- alter table public.posts    add constraint posts_type_chk check (type is null or type in ('soru','dert','kaynak','acil'));
-- alter table public.posts    add constraint posts_mood_chk check (mood is null or mood in ('yorgun','yardim','iyi','tesekkur'));
-- alter table public.feedback add constraint feedback_tip_chk check (tip in ('oneri','sikayet'));
-- alter table public.kullanicilar add constraint kullanicilar_nick_chk check (nick ~ '^[a-z0-9_çğıöşü]{2,20}$');


-- ── ADIM 6: Edge Function secret'ları (Dashboard → Edge Functions → Secrets) ──
-- ADMIN_EMAIL     → delete-user için admin e-postası (koddan kaldırıldı)
-- WEBHOOK_SECRET  → send-push için uzun rastgele bir değer; Database Webhook'una
--                   "x-webhook-secret: <aynı değer>" başlığı eklenmeli. Ayarlanmazsa
--                   send-push hiçbir isteği kabul etmez (bildirimler durur).
