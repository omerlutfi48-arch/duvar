set local lock_timeout = '3s';
revoke select on public.kullanicilar from public, anon, authenticated;
grant select (nick, created_at, banli, mod, avatar_url, display_name, is_anonymous)
on public.kullanicilar to anon, authenticated;
revoke delete on public.kullanicilar from public, anon, authenticated;
do $$
begin
  if has_column_privilege('anon','public.kullanicilar','auth_id','SELECT')
     or has_column_privilege('authenticated','public.kullanicilar','auth_id','SELECT')
     or has_table_privilege('authenticated','public.kullanicilar','DELETE') then
    raise exception 'Private account columns still exposed';
  end if;
end $$;
