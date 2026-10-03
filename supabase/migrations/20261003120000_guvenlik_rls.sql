-- ════════════════════════════════════════════════════════════════════════════
-- DUVAR — veritabanı güvenlik kuralları (RLS) sıkılaştırması
-- Tablo yapısı ve veri değişmez; sadece kim neyi okuyup yazabilir.
-- Geri dönüş: supabase/guvenlik/eski-kurallar-geri-donus.sql
-- ════════════════════════════════════════════════════════════════════════════

-- ── Yardımcı fonksiyonlar ──────────────────────────────────────────────────
-- Oturumdaki kullanıcının nick'i (auth_id üzerinden; kullanıcı değiştiremez)
create or replace function public.my_nick() returns text
language sql stable security definer set search_path = public as $$
  select nick from public.kullanicilar where auth_id = auth.uid()
$$;

-- Admin (site sahibi e-postası) veya banlı olmayan moderatör
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
  -- servis anahtarı (edge function), SQL editörü ve adminler serbest
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
drop trigger if exists kullanicilar_koru on public.kullanicilar;
create trigger kullanicilar_koru before insert or update on public.kullanicilar
  for each row execute function public.kullanicilar_koru();

-- ── Eski (açık) kuralları kaldır ───────────────────────────────────────────
do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies where schemaname = 'public'
           and tablename in ('anket_oylar','begeni','begenmeme','etkinlikler','feedback','ilanlar','kullanicilar',
                             'mesajlar','notifications','page_views','posts','push_subscriptions','raporlar',
                             'sozluk_basliklar','sozluk_entriler','yorumlar')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- ── kullanicilar ───────────────────────────────────────────────────────────
create policy kul_oku      on public.kullanicilar for select using (true);
create policy kul_ekle     on public.kullanicilar for insert to authenticated with check (auth_id = auth.uid());
create policy kul_guncelle on public.kullanicilar for update to authenticated
  using (auth_id = auth.uid() or public.is_admin()) with check (auth_id = auth.uid() or public.is_admin());
create policy kul_sil      on public.kullanicilar for delete to authenticated using (auth_id = auth.uid() or public.is_admin());

-- ── posts ──────────────────────────────────────────────────────────────────
create policy post_oku on public.posts for select using (true);
create policy post_ekle on public.posts for insert to authenticated with check (
  author = public.my_nick() and not public.is_banned()
  and coalesce(pinned, false) = false and coalesce(fire, 0) = 0 and coalesce(disfire, 0) = 0
  and coalesce(aktif, true) = true and char_length(text) <= 2000
);
create policy post_guncelle on public.posts for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy post_sil on public.posts for delete to authenticated using (author = public.my_nick() or public.is_admin());

-- ── yorumlar ───────────────────────────────────────────────────────────────
create policy yorum_oku  on public.yorumlar for select using (true);
create policy yorum_ekle on public.yorumlar for insert to authenticated
  with check (nick = public.my_nick() and not public.is_banned() and char_length(text) <= 1000);
create policy yorum_sil  on public.yorumlar for delete to authenticated using (nick = public.my_nick() or public.is_admin());

-- ── begeni / begenmeme (sayaçlar RPC ile, satırlar kendi adına) ─────────────
create policy begeni_oku  on public.begeni for select using (true);
create policy begeni_ekle on public.begeni for insert to authenticated with check (nick = public.my_nick());
create policy begeni_sil  on public.begeni for delete to authenticated using (nick = public.my_nick() or public.is_admin());

create policy begenmeme_oku  on public.begenmeme for select using (true);
create policy begenmeme_ekle on public.begenmeme for insert to authenticated with check (nick = public.my_nick());
create policy begenmeme_sil  on public.begenmeme for delete to authenticated using (nick = public.my_nick() or public.is_admin());

-- ── anket_oylar ────────────────────────────────────────────────────────────
create policy oy_oku      on public.anket_oylar for select using (true);
create policy oy_ekle     on public.anket_oylar for insert to authenticated with check (nick = public.my_nick() and not public.is_banned());
create policy oy_guncelle on public.anket_oylar for update to authenticated using (nick = public.my_nick()) with check (nick = public.my_nick());
create policy oy_sil      on public.anket_oylar for delete to authenticated using (nick = public.my_nick() or public.is_admin());

-- ── mesajlar (özel: sadece taraflar) ───────────────────────────────────────
create policy dm_oku      on public.mesajlar for select to authenticated
  using (gonderen = public.my_nick() or alici = public.my_nick() or public.is_admin());
create policy dm_gonder   on public.mesajlar for insert to authenticated with check (gonderen = public.my_nick() and not public.is_banned());
create policy dm_okundu   on public.mesajlar for update to authenticated using (alici = public.my_nick()) with check (alici = public.my_nick());
create policy dm_sil      on public.mesajlar for delete to authenticated
  using (gonderen = public.my_nick() or alici = public.my_nick() or public.is_admin());

-- ── notifications ──────────────────────────────────────────────────────────
create policy bildirim_oku     on public.notifications for select to authenticated
  using (to_user = public.my_nick() or from_user = public.my_nick());
create policy bildirim_ekle    on public.notifications for insert to authenticated
  with check (from_user = public.my_nick() and char_length(action) <= 200);
create policy bildirim_okundu  on public.notifications for update to authenticated
  using (to_user = public.my_nick()) with check (to_user = public.my_nick());
create policy bildirim_sil     on public.notifications for delete to authenticated using (to_user = public.my_nick() or public.is_admin());

-- ── push_subscriptions ─────────────────────────────────────────────────────
create policy push_kendi on public.push_subscriptions for all to authenticated
  using (nick = public.my_nick()) with check (nick = public.my_nick());

-- ── raporlar / feedback (okuma ve silme sadece admin) ──────────────────────
create policy rapor_ekle on public.raporlar for insert to authenticated with check (bildiren = public.my_nick());
create policy rapor_oku  on public.raporlar for select to authenticated using (public.is_admin());
create policy rapor_sil  on public.raporlar for delete to authenticated using (public.is_admin());

create policy fb_ekle     on public.feedback for insert to anon, authenticated
  with check (coalesce(tip, 'oneri') in ('oneri', 'sikayet') and char_length(mesaj) <= 2000 and coalesce(okundu, false) = false);
create policy fb_oku      on public.feedback for select to authenticated using (public.is_admin());
create policy fb_guncelle on public.feedback for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy fb_sil      on public.feedback for delete to authenticated using (public.is_admin());

-- ── etkinlikler / ilanlar (yazma sadece admin) ─────────────────────────────
create policy etk_oku   on public.etkinlikler for select using (true);
create policy etk_ekle  on public.etkinlikler for insert to authenticated with check (public.is_admin());
create policy etk_guncelle on public.etkinlikler for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy etk_sil   on public.etkinlikler for delete to authenticated using (public.is_admin());

create policy ilan_oku   on public.ilanlar for select using (true);
create policy ilan_ekle  on public.ilanlar for insert to authenticated with check (public.is_admin());
create policy ilan_guncelle on public.ilanlar for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy ilan_sil   on public.ilanlar for delete to authenticated using (public.is_admin());

-- ── page_views (herkes kayıt bırakır, sadece admin okur/temizler) ──────────
create policy ziyaret_ekle on public.page_views for insert to anon, authenticated with check (true);
create policy ziyaret_oku  on public.page_views for select to authenticated using (public.is_admin());
create policy ziyaret_sil  on public.page_views for delete to authenticated using (public.is_admin());

-- ── sözlük (KESİT) ─────────────────────────────────────────────────────────
create policy baslik_oku  on public.sozluk_basliklar for select using (true);
create policy baslik_ekle on public.sozluk_basliklar for insert to authenticated
  with check (olusturan = public.my_nick() and not public.is_banned() and char_length(baslik) <= 100);
create policy baslik_sil  on public.sozluk_basliklar for delete to authenticated using (public.is_admin());

create policy entry_oku  on public.sozluk_entriler for select using (true);
create policy entry_ekle on public.sozluk_entriler for insert to authenticated
  with check (yazar = public.my_nick() and not public.is_banned() and char_length(icerik) <= 1000);
create policy entry_sil  on public.sozluk_entriler for delete to authenticated using (yazar = public.my_nick() or public.is_admin());

-- ── Beğeni RPC'leri: sadece kendi adına, sayaç gerçek sayıdan ──────────────
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

revoke execute on function public.artir_begen(bigint, text), public.geri_al_begen(bigint, text),
  public.artir_begenmeme(bigint, text), public.geri_al_begenmeme(bigint, text) from public, anon;
grant execute on function public.artir_begen(bigint, text), public.geri_al_begen(bigint, text),
  public.artir_begenmeme(bigint, text), public.geri_al_begenmeme(bigint, text) to authenticated;

-- Tetikleyici fonksiyonu API'den çağrılamasın
alter function public.handle_auth_user_deleted() set search_path = public;
revoke execute on function public.handle_auth_user_deleted() from public, anon, authenticated;
revoke execute on function public.kullanicilar_koru() from public, anon, authenticated;

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
revoke execute on function public.nick_degistir(text) from public, anon;
grant execute on function public.nick_degistir(text) to authenticated;
