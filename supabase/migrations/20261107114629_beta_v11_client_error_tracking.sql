set local lock_timeout='3s';
create table duvar_private.client_errors (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check(kind in ('script','promise')),
  source text not null check(source in ('main.js','features.js','utils.js','other')),
  line integer not null check(line between 0 and 100000),
  occurred_at timestamptz not null default now()
);
alter table duvar_private.client_errors enable row level security;
create index client_errors_user_time_idx on duvar_private.client_errors(user_id,occurred_at);
revoke all on duvar_private.client_errors from public,anon,authenticated;
create function public.duvar_record_client_error(p_kind text,p_source text,p_line integer) returns void
language plpgsql security definer set search_path='' as $$
declare v_user uuid := (select auth.uid());
begin
  if v_user is null or (select public.my_nick()) is null then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text,5));
  if (select count(*) from duvar_private.client_errors where user_id=v_user and occurred_at>now()-interval '1 hour')>=10 then return; end if;
  insert into duvar_private.client_errors(user_id,kind,source,line) values(v_user,p_kind,p_source,p_line);
end $$;
revoke all on function public.duvar_record_client_error(text,text,integer) from public,anon;
grant execute on function public.duvar_record_client_error(text,text,integer) to authenticated;
create function public.duvar_client_error_summary() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if (select auth.uid()) is null or not coalesce((select public.is_admin()),false) then
    raise exception 'Unauthorized' using errcode='42501';
  end if;
  return (select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) from (
    select kind,source,line,count(*) as total,max(occurred_at) as latest
    from duvar_private.client_errors where occurred_at>now()-interval '7 days'
    group by kind,source,line order by count(*) desc limit 20
  ) s);
end $$;
revoke all on function public.duvar_client_error_summary() from public,anon;
grant execute on function public.duvar_client_error_summary() to authenticated;
