set local lock_timeout = '3s';
create or replace function public.handle_auth_user_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nick text;
  v_liked bigint[];
  v_disliked bigint[];
begin
  select nick into v_nick from public.kullanicilar where auth_id = old.id for update;
  if v_nick is null then
    return old;
  end if;

  delete from public.raporlar r
  where r.bildiren = v_nick
     or exists (select 1 from public.posts p where p.id = r.post_id and p.author = v_nick);
  delete from public.posts where author = v_nick;
  delete from public.yorumlar where nick = v_nick;
  delete from public.mesajlar where gonderen = v_nick or alici = v_nick;
  delete from public.notifications where to_user = v_nick or from_user = v_nick;
  delete from public.push_subscriptions where nick = v_nick;
  delete from public.anket_oylar where nick = v_nick;

  with removed as (
    delete from public.begeni where nick = v_nick returning post_id
  )
  select array_agg(post_id) into v_liked from removed;
  with removed as (
    delete from public.begenmeme where nick = v_nick returning post_id
  )
  select array_agg(post_id) into v_disliked from removed;

  update public.posts p
  set fire = (select count(*) from public.begeni b where b.post_id = p.id)
  where p.id = any(v_liked);
  update public.posts p
  set disfire = (select count(*) from public.begenmeme b where b.post_id = p.id)
  where p.id = any(v_disliked);

  delete from public.sozluk_entriler where yazar = v_nick;
  delete from public.sozluk_basliklar b where b.olusturan = v_nick
    and not exists (select 1 from public.sozluk_entriler e where e.baslik_id = b.id);
  update public.sozluk_basliklar set olusturan = '' where olusturan = v_nick;

  delete from public.kullanicilar where auth_id = old.id;
  return old;
end
$$;
revoke execute on function public.handle_auth_user_deleted() from public, anon, authenticated;
