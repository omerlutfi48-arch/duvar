-- DUVAR — 2026-10-03 güvenlik migration'ından ÖNCEKİ RLS kuralları (birebir kopya).
-- Sadece yeni kurallar siteyi bozarsa acil geri dönüş için. Bu kurallar güvensizdir
-- (herkes her gönderiyi değiştirebilir, özel mesajlar herkese açıktır).
-- Kullanım: önce yeni kuralları kaldır, sonra aşağıyı çalıştır:
--   do $$ declare r record; begin for r in select tablename, policyname from pg_policies where schemaname='public'
--   loop execute format('drop policy %I on public.%I', r.policyname, r.tablename); end loop; end $$;
--   drop trigger if exists kullanicilar_koru on public.kullanicilar;
create policy admin_delete_anket_oylar on public.anket_oylar as PERMISSIVE for DELETE to public using (((auth.jwt() ->> 'email'::text) = 'omerlutfi48@gmail.com'::text));
create policy anket_delete on public.anket_oylar as PERMISSIVE for DELETE to public using (true);
create policy anket_insert on public.anket_oylar as PERMISSIVE for INSERT to public with check (true);
create policy anket_select on public.anket_oylar as PERMISSIVE for SELECT to public using (true);
create policy admin_delete_begeni on public.begeni as PERMISSIVE for DELETE to public using (((auth.jwt() ->> 'email'::text) = 'omerlutfi48@gmail.com'::text));
create policy begeni_delete on public.begeni as PERMISSIVE for DELETE to public using (true);
create policy begeni_insert on public.begeni as PERMISSIVE for INSERT to public with check (true);
create policy begeni_select on public.begeni as PERMISSIVE for SELECT to public using (true);
create policy etkinlikler_delete on public.etkinlikler as PERMISSIVE for DELETE to public using ((auth.role() = 'authenticated'::text));
create policy etkinlikler_insert on public.etkinlikler as PERMISSIVE for INSERT to public with check ((auth.role() = 'authenticated'::text));
create policy etkinlikler_select on public.etkinlikler as PERMISSIVE for SELECT to public using (true);
create policy etkinlikler_update on public.etkinlikler as PERMISSIVE for UPDATE to public using ((auth.role() = 'authenticated'::text));
create policy feedback_delete on public.feedback as PERMISSIVE for DELETE to public using ((auth.role() = 'authenticated'::text));
create policy feedback_insert on public.feedback as PERMISSIVE for INSERT to public with check (true);
create policy feedback_select on public.feedback as PERMISSIVE for SELECT to public using ((auth.role() = 'authenticated'::text));
create policy feedback_update on public.feedback as PERMISSIVE for UPDATE to public using ((auth.role() = 'authenticated'::text));
create policy ilanlar_delete on public.ilanlar as PERMISSIVE for DELETE to public using ((auth.role() = 'authenticated'::text));
create policy ilanlar_insert on public.ilanlar as PERMISSIVE for INSERT to public with check ((auth.role() = 'authenticated'::text));
create policy ilanlar_select on public.ilanlar as PERMISSIVE for SELECT to public using (true);
create policy ilanlar_update on public.ilanlar as PERMISSIVE for UPDATE to public using ((auth.role() = 'authenticated'::text));
create policy "Users can delete own profile" on public.kullanicilar as PERMISSIVE for DELETE to public using ((auth.uid() = auth_id));
create policy admin_delete_kullanicilar on public.kullanicilar as PERMISSIVE for DELETE to public using (((auth.jwt() ->> 'email'::text) = 'omerlutfi48@gmail.com'::text));
create policy kayit_ol on public.kullanicilar as PERMISSIVE for INSERT to public with check (true);
create policy kullanicilar_insert on public.kullanicilar as PERMISSIVE for INSERT to public with check (true);
create policy kullanicilar_select on public.kullanicilar as PERMISSIVE for SELECT to public using (true);
create policy kullanicilar_update on public.kullanicilar as PERMISSIVE for UPDATE to public using ((auth.role() = 'authenticated'::text));
create policy nick_oku on public.kullanicilar as PERMISSIVE for SELECT to public using (true);
create policy admin_delete_mesajlar on public.mesajlar as PERMISSIVE for DELETE to public using (((auth.jwt() ->> 'email'::text) = 'omerlutfi48@gmail.com'::text));
create policy mesaj_gonder on public.mesajlar as PERMISSIVE for INSERT to public with check (true);
create policy mesaj_guncelle on public.mesajlar as PERMISSIVE for UPDATE to public using (true);
create policy mesaj_oku on public.mesajlar as PERMISSIVE for SELECT to public using (true);
create policy "allow all" on public.notifications as PERMISSIVE for ALL to public using (true) with check (true);
create policy "anon insert" on public.page_views as PERMISSIVE for INSERT to anon with check (true);
create policy "insert anon" on public.page_views as PERMISSIVE for INSERT to anon with check (true);
create policy "select admin" on public.page_views as PERMISSIVE for SELECT to public using (true);
create policy admin_delete_posts on public.posts as PERMISSIVE for DELETE to public using (((auth.jwt() ->> 'email'::text) = 'omerlutfi48@gmail.com'::text));
create policy kendi_post_sil on public.posts as PERMISSIVE for UPDATE to public using (true) with check (true);
create policy posts_delete on public.posts as PERMISSIVE for DELETE to public using ((auth.role() = 'authenticated'::text));
create policy posts_insert on public.posts as PERMISSIVE for INSERT to public with check (true);
create policy posts_select on public.posts as PERMISSIVE for SELECT to public using (true);
create policy posts_update on public.posts as PERMISSIVE for UPDATE to public using ((auth.role() = 'authenticated'::text));
create policy "kullanici kendi aboneliğini yönetir" on public.push_subscriptions as PERMISSIVE for ALL to public using ((nick = (auth.jwt() ->> 'nick'::text)));
create policy raporlar_delete on public.raporlar as PERMISSIVE for DELETE to public using ((auth.role() = 'authenticated'::text));
create policy raporlar_insert on public.raporlar as PERMISSIVE for INSERT to public with check (true);
create policy raporlar_select on public.raporlar as PERMISSIVE for SELECT to public using ((auth.role() = 'authenticated'::text));
create policy "allow all" on public.sozluk_basliklar as PERMISSIVE for ALL to public using (true) with check (true);
create policy "allow all" on public.sozluk_entriler as PERMISSIVE for ALL to public using (true) with check (true);
create policy admin_delete_yorumlar on public.yorumlar as PERMISSIVE for DELETE to public using (((auth.jwt() ->> 'email'::text) = 'omerlutfi48@gmail.com'::text));
create policy yorumlar_delete on public.yorumlar as PERMISSIVE for DELETE to public using ((auth.role() = 'authenticated'::text));
create policy yorumlar_insert on public.yorumlar as PERMISSIVE for INSERT to public with check (true);
create policy yorumlar_select on public.yorumlar as PERMISSIVE for SELECT to public using (true);
