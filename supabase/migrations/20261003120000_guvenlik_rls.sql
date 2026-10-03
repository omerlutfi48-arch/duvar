-- ════════════════════════════════════════════════════════════════════════════
-- DUVAR — veritabanı güvenlik kuralları (RLS) sıkılaştırması
-- Tablo yapısı ve veri değişmez; sadece kim neyi okuyup yazabilir.
--
-- Yöntem: eski (gevşek) PERMISSIVE kurallar silinmeden yerinde bırakıldı; üzerlerine
-- RESTRICTIVE kurallar eklendi. Postgres'te bir satıra erişim için en az bir permissive
-- kural VE tüm restrictive kurallar geçmelidir → etkisi eski kuralları sıkılaştırmakla aynı.
-- (Hiçbir şey silinmediği için geri almak sadece bu dosyadaki kuralları kaldırmaktır:
--  supabase/guvenlik/eski-kurallar-geri-donus.sql)
-- ════════════════════════════════════════════════════════════════════════════

-- ── Yardımcı fonksiyonlar ──────────────────────────────────────────────────
create or replace function public.my_nick() returns text
language sql stable security definer set search_path = public as $$
  select nick from public.kullanicilar where auth_id = auth.uid()
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'omerlutfi48@gmail.com'
      or exists (select 1 from public.kullanicilar where auth_id = auth.uid() and mod = true and coalesce(banli, false) = false)
$$;

create or replace function public.is_banned() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select banli from public.kullanicilar where auth_id = auth.uid()), false)
$$;

-- ── kullanicilar: mod / ban / auth_id sadece admin değiştirebilir ───────────
create or replace function public.kullanicilar_koru() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), 'service_role') = 'service_role' or public.is_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.mod := false;
    new.banli := false;
    new.auth_id := auth.uid();
    return new;
  end if;
  if new.mod is distinct from old.mod
     or new.banli is distinct from old.banli
     or new.auth_id is distinct from old.auth_id then
    raise exception 'yetkisiz alan değişikliği' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger kullanicilar_koru before insert or update on public.kullanicilar
  for each row execute function public.kullanicilar_koru();

-- ── RESTRICTIVE kurallar (eski permissive kuralları daraltır) ───────────────
-- kullanicilar
create policy r_kul_ekle     on public.kullanicilar as restrictive for insert with check (auth_id = auth.uid());
create policy r_kul_guncelle on public.kullanicilar as restrictive for update
  using (auth_id = auth.uid() or public.is_admin()) with check (auth_id = auth.uid() or public.is_admin());
create policy r_kul_sil      on public.kullanicilar as restrictive for delete using (auth_id = auth.uid() or public.is_admin());

-- posts
create policy r_post_ekle on public.posts as restrictive for insert with check (
  author = public.my_nick() and not public.is_banned()
  and coalesce(pinned, false) = false and coalesce(fire, 0) = 0 and coalesce(disfire, 0) = 0
  and coalesce(aktif, true) = true and char_length(text) <= 2000
);
create policy r_post_guncelle on public.posts as restrictive for update using (public.is_admin()) with check (public.is_admin());
create policy r_post_sil      on public.posts as restrictive for delete using (author = public.my_nick() or public.is_admin());

-- yorumlar
create policy r_yorum_ekle on public.yorumlar as restrictive for insert
  with check (nick = public.my_nick() and not public.is_banned() and char_length(text) <= 1000);
create policy r_yorum_sil  on public.yorumlar as restrictive for delete using (nick = public.my_nick() or public.is_admin());

-- begeni
create policy r_begeni_ekle on public.begeni as restrictive for insert with check (nick = public.my_nick());
create policy r_begeni_sil  on public.begeni as restrictive for delete using (nick = public.my_nick() or public.is_admin());

-- begenmeme (hiç kuralı yoktu → okuma da kapalıydı; permissive eklenir)
create policy begenmeme_oku  on public.begenmeme for select using (true);
create policy begenmeme_ekle on public.begenmeme for insert to authenticated with check (nick = public.my_nick());
create policy begenmeme_sil  on public.begenmeme for delete to authenticated using (nick = public.my_nick() or public.is_admin());

-- anket_oylar (güncelleme kuralı yoktu → oy değiştirme hiç çalışmıyordu)
create policy oy_guncelle   on public.anket_oylar for update to authenticated using (nick = public.my_nick()) with check (nick = public.my_nick());
create policy r_oy_ekle     on public.anket_oylar as restrictive for insert with check (nick = public.my_nick() and not public.is_banned());
create policy r_oy_sil      on public.anket_oylar as restrictive for delete using (nick = public.my_nick() or public.is_admin());

-- mesajlar (özel: sadece taraflar)
create policy r_dm_oku    on public.mesajlar as restrictive for select
  using (gonderen = public.my_nick() or alici = public.my_nick() or public.is_admin());
create policy r_dm_gonder on public.mesajlar as restrictive for insert with check (gonderen = public.my_nick() and not public.is_banned());
create policy r_dm_okundu on public.mesajlar as restrictive for update using (alici = public.my_nick()) with check (alici = public.my_nick());
create policy r_dm_sil    on public.mesajlar as restrictive for delete
  using (gonderen = public.my_nick() or alici = public.my_nick() or public.is_admin());

-- notifications
create policy r_bildirim_oku    on public.notifications as restrictive for select using (to_user = public.my_nick() or from_user = public.my_nick());
create policy r_bildirim_ekle   on public.notifications as restrictive for insert with check (from_user = public.my_nick() and char_length(action) <= 200);
create policy r_bildirim_okundu on public.notifications as restrictive for update using (to_user = public.my_nick()) with check (to_user = public.my_nick());
create policy r_bildirim_sil    on public.notifications as restrictive for delete using (to_user = public.my_nick() or public.is_admin());

-- push_subscriptions (eski kural JWT'de olmayan bir alana bakıyordu → abonelik hiç çalışmıyordu)
create policy push_kendi on public.push_subscriptions for all to authenticated
  using (nick = public.my_nick()) with check (nick = public.my_nick());

-- raporlar
create policy r_rapor_ekle on public.raporlar as restrictive for insert with check (bildiren = public.my_nick());
create policy r_rapor_oku  on public.raporlar as restrictive for select using (public.is_admin());
create policy r_rapor_sil  on public.raporlar as restrictive for delete using (public.is_admin());

-- feedback
create policy r_fb_ekle     on public.feedback as restrictive for insert
  with check (coalesce(tip, 'oneri') in ('oneri', 'sikayet') and char_length(mesaj) <= 2000 and coalesce(okundu, false) = false);
create policy r_fb_oku      on public.feedback as restrictive for select using (public.is_admin());
create policy r_fb_guncelle on public.feedback as restrictive for update using (public.is_admin()) with check (public.is_admin());
create policy r_fb_sil      on public.feedback as restrictive for delete using (public.is_admin());

-- etkinlikler / ilanlar
create policy r_etk_ekle     on public.etkinlikler as restrictive for insert with check (public.is_admin());
create policy r_etk_guncelle on public.etkinlikler as restrictive for update using (public.is_admin()) with check (public.is_admin());
create policy r_etk_sil      on public.etkinlikler as restrictive for delete using (public.is_admin());
create policy r_ilan_ekle     on public.ilanlar as restrictive for insert with check (public.is_admin());
create policy r_ilan_guncelle on public.ilanlar as restrictive for update using (public.is_admin()) with check (public.is_admin());
create policy r_ilan_sil      on public.ilanlar as restrictive for delete using (public.is_admin());

-- page_views (girişli kullanıcı da kayıt bırakabilsin; okuma/temizleme sadece admin)
create policy ziyaret_ekle_girisli on public.page_views for insert to authenticated with check (true);
create policy ziyaret_sil          on public.page_views for delete to authenticated using (public.is_admin());
create policy r_ziyaret_oku        on public.page_views as restrictive for select using (public.is_admin());

-- sözlük (KESİT)
create policy r_baslik_ekle     on public.sozluk_basliklar as restrictive for insert
  with check (olusturan = public.my_nick() and not public.is_banned() and char_length(baslik) <= 100);
create policy r_baslik_guncelle on public.sozluk_basliklar as restrictive for update using (public.is_admin()) with check (public.is_admin());
create policy r_baslik_sil      on public.sozluk_basliklar as restrictive for delete using (public.is_admin());
create policy r_entry_ekle      on public.sozluk_entriler as restrictive for insert
  with check (yazar = public.my_nick() and not public.is_banned() and char_length(icerik) <= 1000);
create policy r_entry_guncelle  on public.sozluk_entriler as restrictive for update using (public.is_admin()) with check (public.is_admin());
create policy r_entry_sil       on public.sozluk_entriler as restrictive for delete using (yazar = public.my_nick() or public.is_admin());

-- ── Beğeni RPC'leri: sadece kendi adına, sayaç gerçek sayıdan ──────────────
-- (misafirde my_nick() boş → 'yetkisiz')
create or replace function public.artir_begen(p_id bigint, p_nick text) returns void
language plpgsql security definer set search_path = public as $$
declare v_nick text := public.my_nick();
begin
  if v_nick is null or p_nick is distinct from v_nick then raise exception 'yetkisiz' using errcode = '42501'; end if;
  insert into begeni (post_id, nick) values (p_id, v_nick) on conflict do nothing;
  update posts set fire = (select count(*) from begeni where post_id = p_id) where id = p_id;
end $$;

create or replace function public.geri_al_begen(p_id bigint, p_nick text) returns void
language plpgsql security definer set search_path = public as $$
declare v_nick text := public.my_nick();
begin
  if v_nick is null or p_nick is distinct from v_nick then raise exception 'yetkisiz' using errcode = '42501'; end if;
  delete from begeni where post_id = p_id and nick = v_nick;
  update posts set fire = (select count(*) from begeni where post_id = p_id) where id = p_id;
end $$;

create or replace function public.artir_begenmeme(p_id bigint, p_nick text) returns void
language plpgsql security definer set search_path = public as $$
declare v_nick text := public.my_nick();
begin
  if v_nick is null or p_nick is distinct from v_nick then raise exception 'yetkisiz' using errcode = '42501'; end if;
  insert into begenmeme (post_id, nick) values (p_id, v_nick) on conflict do nothing;
  update posts set disfire = (select count(*) from begenmeme where post_id = p_id) where id = p_id;
end $$;

create or replace function public.geri_al_begenmeme(p_id bigint, p_nick text) returns void
language plpgsql security definer set search_path = public as $$
declare v_nick text := public.my_nick();
begin
  if v_nick is null or p_nick is distinct from v_nick then raise exception 'yetkisiz' using errcode = '42501'; end if;
  delete from begenmeme where post_id = p_id and nick = v_nick;
  update posts set disfire = (select count(*) from begenmeme where post_id = p_id) where id = p_id;
end $$;

-- Tetikleyici fonksiyonu: search_path sabitlendi (gövde aynı)
create or replace function public.handle_auth_user_deleted() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.kullanicilar where auth_id = old.id;
  return old;
end $$;

-- ── Nick değiştirme: tüm tablolarda tek seferde, sadece kendi nick'i ───────
create or replace function public.nick_degistir(p_yeni text) returns void
language plpgsql security definer set search_path = public as $$
declare v_eski text := public.my_nick();
begin
  if v_eski is null then raise exception 'oturum yok' using errcode = '42501'; end if;
  if public.is_banned() then raise exception 'hesap askıya alınmış' using errcode = '42501'; end if;
  if p_yeni is null or p_yeni !~ '^[a-z0-9_çğıöşü]{2,20}$' then raise exception 'geçersiz nickname'; end if;
  if p_yeni = v_eski then return; end if;
  if exists (select 1 from kullanicilar where nick = p_yeni) then raise exception 'bu nickname alınmış'; end if;
  update kullanicilar       set nick = p_yeni      where auth_id = auth.uid();
  update posts              set author = p_yeni    where author = v_eski;
  update yorumlar           set nick = p_yeni      where nick = v_eski;
  update mesajlar           set gonderen = p_yeni  where gonderen = v_eski;
  update mesajlar           set alici = p_yeni     where alici = v_eski;
  update begeni             set nick = p_yeni      where nick = v_eski;
  update begenmeme          set nick = p_yeni      where nick = v_eski;
  update anket_oylar        set nick = p_yeni      where nick = v_eski;
  update notifications      set to_user = p_yeni   where to_user = v_eski;
  update notifications      set from_user = p_yeni where from_user = v_eski;
  update push_subscriptions set nick = p_yeni      where nick = v_eski;
  update raporlar           set bildiren = p_yeni  where bildiren = v_eski;
  update sozluk_basliklar   set olusturan = p_yeni where olusturan = v_eski;
  update sozluk_entriler    set yazar = p_yeni     where yazar = v_eski;
end $$;
