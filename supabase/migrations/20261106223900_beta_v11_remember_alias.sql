set local lock_timeout='3s';
alter table public.kullanicilar add column anonymous_alias text
  check (anonymous_alias is null or anonymous_alias ~ '^[a-z0-9_çğıöşü]{2,20}$');

update public.kullanicilar
set anonymous_alias=display_name
where is_anonymous and display_name is not null;

create unique index kullanicilar_reserved_alias_key on public.kullanicilar (
  lower(case when is_anonymous then coalesce(display_name,nick)
             else coalesce(anonymous_alias,nick) end)
);

create function public.duvar_my_alias()
returns text
language sql stable security definer set search_path=''
as $$
  select anonymous_alias from public.kullanicilar where auth_id=(select auth.uid())
$$;
revoke all on function public.duvar_my_alias() from public, anon;
grant execute on function public.duvar_my_alias() to authenticated;
