set local lock_timeout='3s';
create or replace function public.duvar_my_profile()
returns table (nick text, banli boolean, mod boolean, display_name text, is_anonymous boolean)
language sql stable security definer set search_path = ''
as $$
  select k.nick,k.banli,k.mod,k.display_name,k.is_anonymous
  from public.kullanicilar k
  where k.auth_id = (select auth.uid())
$$;
revoke all on function public.duvar_my_profile() from public, anon;
grant execute on function public.duvar_my_profile() to authenticated;
