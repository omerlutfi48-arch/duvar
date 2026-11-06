set local lock_timeout='3s';
create schema if not exists duvar_private;
revoke all on schema duvar_private from public, anon, authenticated;

create table duvar_private.ai_global_quota (
  singleton boolean primary key default true check (singleton),
  window_start timestamptz not null,
  used integer not null check (used between 0 and 400)
);

create table duvar_private.ai_user_quota (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_start timestamptz not null,
  used integer not null check (used between 0 and 20)
);

create function public.duvar_take_ai_quota(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  v_now timestamptz;
  v_hour timestamptz;
  v_ten_minutes timestamptz;
  v_global_window timestamptz;
  v_global_used integer;
  v_user_used integer;
begin
  insert into duvar_private.ai_global_quota(singleton,window_start,used)
    values(true,pg_catalog.clock_timestamp(),0) on conflict(singleton) do nothing;
  select window_start,used into v_global_window,v_global_used
    from duvar_private.ai_global_quota where singleton for update;
  v_now := pg_catalog.clock_timestamp();
  v_hour := pg_catalog.date_bin(interval '1 hour',v_now,timestamptz '2000-01-01 UTC');
  v_ten_minutes := pg_catalog.date_bin(interval '10 minutes',v_now,timestamptz '2000-01-01 UTC');
  if v_global_window<>v_hour then v_global_used := 0; end if;
  if v_global_used>=400 then return false; end if;
  select case when window_start=v_ten_minutes then used else 0 end
    into v_user_used from duvar_private.ai_user_quota where user_id=p_user_id;
  v_user_used := coalesce(v_user_used,0);
  if v_user_used>=20 then return false; end if;

  insert into duvar_private.ai_user_quota(user_id,window_start,used)
    values(p_user_id,v_ten_minutes,v_user_used+1)
    on conflict(user_id) do update set window_start=excluded.window_start,used=excluded.used;
  update duvar_private.ai_global_quota
    set window_start=v_hour,used=v_global_used+1 where singleton;
  return true;
end $$;
revoke all on function public.duvar_take_ai_quota(uuid) from public, anon, authenticated;
grant execute on function public.duvar_take_ai_quota(uuid) to service_role;
