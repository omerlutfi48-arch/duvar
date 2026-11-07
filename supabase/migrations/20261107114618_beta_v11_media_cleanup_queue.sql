set local lock_timeout='3s';
create index if not exists posts_solution_comment_idx on public.posts(solution_comment_id) where solution_comment_id is not null;
create index if not exists duvar_controls_target_idx on public.duvar_controls(target_nick);

create table duvar_private.media_cleanup_jobs (
  id uuid primary key default gen_random_uuid(),
  url text,
  object_key text,
  status text not null default 'pending' check(status in ('pending','done','retained','invalid','failed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now()+interval '1 hour',
  claimed_at timestamptz,
  last_code integer,
  created_at timestamptz not null default now()
);
alter table duvar_private.media_cleanup_jobs enable row level security;
revoke all on duvar_private.media_cleanup_jobs from public,anon,authenticated;
create index media_cleanup_pending_idx on duvar_private.media_cleanup_jobs(available_at) where status='pending';

create function duvar_private.enqueue_removed_media() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_table_name='posts' then
    if old.image_url is not null then insert into duvar_private.media_cleanup_jobs(url) values(old.image_url); end if;
    if old.file_url is not null then insert into duvar_private.media_cleanup_jobs(url) values(old.file_url); end if;
  elsif tg_op='DELETE' or old.avatar_url is distinct from new.avatar_url then
    if old.avatar_url is not null then insert into duvar_private.media_cleanup_jobs(url) values(old.avatar_url); end if;
  end if;
  return old;
end $$;
revoke all on function duvar_private.enqueue_removed_media() from public,anon,authenticated;
create trigger enqueue_post_media after delete on public.posts for each row execute function duvar_private.enqueue_removed_media();
create trigger enqueue_avatar_media after delete or update of avatar_url on public.kullanicilar for each row execute function duvar_private.enqueue_removed_media();

create function duvar_private.cloudinary_object_key(p_url text) returns text
language plpgsql immutable set search_path='' as $$
declare parts text[]; ident text;
begin
  parts:=regexp_match(p_url,'^https://res\.cloudinary\.com/dxsvzlv1m/(image|raw)/upload/(?:v[0-9]+/)?([^?]+)(?:\?.*)?$');
  if parts is null then return null; end if;
  ident:=parts[2];
  if parts[1]='image' then ident:=regexp_replace(ident,'\.[A-Za-z0-9]+$',''); end if;
  if ident !~ '^[A-Za-z0-9_./-]+$' or ident ~ '(^|/)\.\.?(/|$)' then return null; end if;
  return parts[1]||':'||ident;
end $$;
revoke all on function duvar_private.cloudinary_object_key(text) from public,anon,authenticated;

create function public.duvar_claim_media_jobs() returns setof duvar_private.media_cleanup_jobs
language plpgsql security definer set search_path='' as $$
declare job duvar_private.media_cleanup_jobs; v_key text;
begin
  for job in select * from duvar_private.media_cleanup_jobs
    where status='pending' and available_at<=now() and attempts<5
      and (claimed_at is null or claimed_at<now()-interval '15 minutes')
    order by available_at for update skip locked limit 10
  loop
    v_key:=duvar_private.cloudinary_object_key(job.url);
    if v_key is not null then perform pg_advisory_xact_lock(hashtextextended(v_key,3)); end if;
    return query update duvar_private.media_cleanup_jobs
      set claimed_at=now(),attempts=attempts+1,object_key=v_key where id=job.id returning *;
  end loop;
end
$$;

create function duvar_private.guard_media_reference() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_urls text[]; v_key text;
begin
  if tg_table_name='posts' then v_urls:=array[new.image_url,new.file_url];
  else v_urls:=array[new.avatar_url]; end if;
  for v_key in select distinct duvar_private.cloudinary_object_key(u) from unnest(v_urls) u
    where duvar_private.cloudinary_object_key(u) is not null order by 1
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_key,3));
    if exists(select 1 from duvar_private.media_cleanup_jobs j where j.object_key=v_key
      and (j.status='done' or (j.status='pending' and j.claimed_at is not null))) then
      raise exception 'Bu dosya temizleniyor. Dosyayı yeniden yükle.';
    end if;
  end loop;
  return new;
end $$;
revoke all on function duvar_private.guard_media_reference() from public,anon,authenticated;
create trigger guard_post_media_reference before insert or update of image_url,file_url on public.posts
for each row execute function duvar_private.guard_media_reference();
create trigger guard_avatar_media_reference before insert or update of avatar_url on public.kullanicilar
for each row execute function duvar_private.guard_media_reference();
create function public.duvar_media_is_used(p_url text) returns boolean
language sql stable security definer set search_path='' as $$
  select duvar_private.cloudinary_object_key(p_url) is null or exists (
    select 1 from public.posts p where duvar_private.cloudinary_object_key(p.image_url)=duvar_private.cloudinary_object_key(p_url)
      or duvar_private.cloudinary_object_key(p.file_url)=duvar_private.cloudinary_object_key(p_url)
  ) or exists (
    select 1 from public.kullanicilar k where duvar_private.cloudinary_object_key(k.avatar_url)=duvar_private.cloudinary_object_key(p_url)
  )
$$;
create function public.duvar_finish_media_job(p_id uuid,p_state text,p_code integer default null) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_state not in ('pending','done','retained','invalid') then raise exception 'Invalid state'; end if;
  update duvar_private.media_cleanup_jobs set
    status=case when p_state='pending' and attempts>=5 then 'failed' else p_state end,
    url=case when p_state in ('done','retained','invalid') then null else url end,
    last_code=p_code,claimed_at=null,available_at=now()+interval '1 hour'
  where id=p_id;
end $$;
revoke all on function public.duvar_claim_media_jobs() from public,anon,authenticated;
revoke all on function public.duvar_media_is_used(text) from public,anon,authenticated;
revoke all on function public.duvar_finish_media_job(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.duvar_claim_media_jobs(),public.duvar_media_is_used(text),public.duvar_finish_media_job(uuid,text,integer) to service_role;

create function public.duvar_media_queue_stats() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not coalesce((select public.is_admin()),false) or (select auth.uid()) is null then raise exception 'Unauthorized' using errcode='42501'; end if;
  return (select coalesce(jsonb_object_agg(status,total),'{}'::jsonb) from
    (select status,count(*) total from duvar_private.media_cleanup_jobs group by status) counts);
end $$;
revoke all on function public.duvar_media_queue_stats() from public,anon;
grant execute on function public.duvar_media_queue_stats() to authenticated;
