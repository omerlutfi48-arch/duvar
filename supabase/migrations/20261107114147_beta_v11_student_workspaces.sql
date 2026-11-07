set local lock_timeout = '3s';

alter table public.posts
  add column resolved boolean not null default false,
  add column solution_comment_id bigint references public.yorumlar(id) on delete set null,
  add column project_details jsonb check (project_details is null or (
    jsonb_typeof(project_details) = 'object' and octet_length(project_details::text) <= 3000
    and project_details ?& array['stage','focus']
    and jsonb_typeof(project_details->'stage') = 'string'
    and jsonb_typeof(project_details->'focus') = 'string'
    and char_length(project_details->>'stage') between 1 and 80
    and char_length(project_details->>'focus') between 1 and 500
  ));

create function public.duvar_solution(p_post bigint, p_comment bigint, p_resolved boolean)
returns void language plpgsql security definer set search_path='' as $$
declare v_author text;
begin
  select author into v_author from public.posts where id=p_post and type='soru' for update;
  if v_author is null or v_author is distinct from (select public.my_nick()) or (select public.is_banned()) then
    raise exception 'Bu sorunun sahibi olmalısın' using errcode='42501';
  end if;
  if p_comment is not null and (not p_resolved or not exists (
    select 1 from public.yorumlar where id=p_comment and post_id=p_post
  )) then raise exception 'Yanıt bu soruya ait değil'; end if;
  update public.posts set resolved=p_resolved,solution_comment_id=p_comment where id=p_post;
end $$;
revoke all on function public.duvar_solution(bigint,bigint,boolean) from public,anon;
grant execute on function public.duvar_solution(bigint,bigint,boolean) to authenticated;

create function duvar_private.guard_post_extensions() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' and (new.resolved or new.solution_comment_id is not null) then
    raise exception 'Yeni soru çözülmüş olarak gönderilemez';
  end if;
  if tg_op='UPDATE' and old.solution_comment_id is not null and new.solution_comment_id is null then
    new.resolved := false;
  end if;
  return new;
end $$;
create trigger guard_post_extensions before insert or update on public.posts
for each row execute function duvar_private.guard_post_extensions();
revoke all on function duvar_private.guard_post_extensions() from public,anon,authenticated;

create table public.duvar_controls (
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  target_nick text not null references public.kullanicilar(nick) on update cascade on delete cascade,
  mode text not null check (mode in ('mute','block')),
  primary key(owner_id,target_nick)
);
alter table public.duvar_controls enable row level security;
revoke all on public.duvar_controls from public,anon,authenticated;
grant select,insert,update,delete on public.duvar_controls to authenticated;
create policy own_controls on public.duvar_controls to authenticated
using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()) and target_nick<>(select public.my_nick()));

create function public.duvar_contact_allowed(p_sender text,p_recipient text)
returns boolean language sql stable security definer set search_path='' as $$
  select ((select public.my_nick()) in (p_sender,p_recipient)) and not exists (
    select 1 from public.duvar_controls c join public.kullanicilar k on k.auth_id=c.owner_id
    where c.mode='block' and ((k.nick=p_recipient and c.target_nick=p_sender)
      or (k.nick=p_sender and c.target_nick=p_recipient))
  )
$$;
revoke all on function public.duvar_contact_allowed(text,text) from public,anon;
grant execute on function public.duvar_contact_allowed(text,text) to authenticated;
create policy blocked_dm on public.mesajlar as restrictive for insert to authenticated
with check(public.duvar_contact_allowed(gonderen,alici));
create policy blocked_notification on public.notifications as restrictive for insert to authenticated
with check(public.duvar_contact_allowed(from_user,to_user));
create policy blocked_comment on public.yorumlar as restrictive for insert to authenticated
with check(exists(select 1 from public.posts p where p.id=post_id and public.duvar_contact_allowed(nick,p.author)));

create table public.duvar_collections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null check(char_length(btrim(name)) between 1 and 60),
  created_at timestamptz not null default now(),
  unique(owner_id,name), unique(id,owner_id)
);
create table public.duvar_collection_items (
  collection_id uuid not null,
  owner_id uuid not null default auth.uid(),
  post_id bigint not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(collection_id,post_id),
  foreign key(collection_id,owner_id) references public.duvar_collections(id,owner_id) on delete cascade
);
create index duvar_collection_items_post_idx on public.duvar_collection_items(post_id);
create index duvar_collection_items_owner_idx on public.duvar_collection_items(owner_id);
alter table public.duvar_collections enable row level security;
alter table public.duvar_collection_items enable row level security;
revoke all on public.duvar_collections,public.duvar_collection_items from public,anon,authenticated;
grant select,insert,update,delete on public.duvar_collections,public.duvar_collection_items to authenticated;
create policy own_collections on public.duvar_collections to authenticated
using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create policy own_collection_items on public.duvar_collection_items to authenticated
using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));

create table public.duvar_drafts (
  owner_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  body text not null default '' check(char_length(body)<=500),
  post_type text check(post_type in ('soru','dert','kaynak','proje')),
  project_details jsonb check(project_details is null or octet_length(project_details::text)<=3000),
  version bigint not null default 1,
  updated_at timestamptz not null default now()
);
alter table public.duvar_drafts enable row level security;
revoke all on public.duvar_drafts from public,anon,authenticated;
grant select,insert,update,delete on public.duvar_drafts to authenticated;
create policy own_draft on public.duvar_drafts to authenticated
using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create function public.duvar_save_draft(p_body text,p_type text,p_project jsonb,p_version bigint)
returns setof public.duvar_drafts language plpgsql security invoker set search_path='' as $$
begin
  if p_version=0 then
    return query insert into public.duvar_drafts(body,post_type,project_details)
      values(p_body,p_type,p_project) on conflict(owner_id) do nothing returning *;
  else
    return query update public.duvar_drafts set body=p_body,post_type=p_type,
      project_details=p_project,version=version+1,updated_at=now()
      where owner_id=(select auth.uid()) and version=p_version returning *;
  end if;
  if not found then raise exception 'Taslak başka bir cihazda değişti' using errcode='40001'; end if;
end $$;
revoke all on function public.duvar_save_draft(text,text,jsonb,bigint) from public,anon;
grant execute on function public.duvar_save_draft(text,text,jsonb,bigint) to authenticated;

create table public.duvar_plans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  title text not null check(char_length(btrim(title)) between 1 and 100),
  due_date date not null,
  created_at timestamptz not null default now(),
  unique(id,owner_id)
);
create index duvar_plans_owner_idx on public.duvar_plans(owner_id);
create table public.duvar_plan_tasks (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null,
  owner_id uuid not null default auth.uid(),
  label text not null check(char_length(btrim(label)) between 1 and 160),
  done boolean not null default false,
  position integer not null default 0 check(position between 0 and 10000),
  created_at timestamptz not null default now(),
  unique(plan_id,label),
  foreign key(plan_id,owner_id) references public.duvar_plans(id,owner_id) on delete cascade
);
create index duvar_plan_tasks_owner_idx on public.duvar_plan_tasks(owner_id);
create index duvar_plan_tasks_plan_idx on public.duvar_plan_tasks(plan_id);
alter table public.duvar_plans enable row level security;
alter table public.duvar_plan_tasks enable row level security;
revoke all on public.duvar_plans,public.duvar_plan_tasks from public,anon,authenticated;
grant select,insert,update,delete on public.duvar_plans,public.duvar_plan_tasks to authenticated;
create policy own_plans on public.duvar_plans to authenticated
using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create policy own_tasks on public.duvar_plan_tasks to authenticated
using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));

create function public.duvar_archive(p_query text default '',p_type text default null,
  p_after date default null,p_before date default null,p_offset integer default 0)
returns jsonb language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(to_jsonb(found) order by found.created_at desc,found.id desc),'[]'::jsonb)
  from (
    select p.*, (select coalesce(jsonb_agg(jsonb_build_object('id',y.id,'nick',y.nick,'text',y.text) order by y.created_at,y.id),'[]'::jsonb)
      from public.yorumlar y where y.post_id=p.id) as yorumlar
    from public.posts p
    where p.aktif and (p_type is null or p.type=p_type)
      and (p_after is null or p.created_at>=p_after::timestamptz)
      and (p_before is null or p.created_at<(p_before+1)::timestamptz)
      and (btrim(p_query)='' or p.text ilike '%'||replace(replace(replace(left(p_query,120),'!','!!'),'%','!%'),'_','!_')||'%' escape '!'
        or exists(select 1 from public.kullanicilar k where k.nick=p.author and coalesce(k.display_name,k.nick) ilike '%'||replace(replace(replace(left(p_query,120),'!','!!'),'%','!%'),'_','!_')||'%' escape '!'))
      and not exists(select 1 from public.duvar_controls c where c.owner_id=(select auth.uid()) and c.target_nick=p.author)
    order by p.created_at desc,p.id desc limit 40 offset greatest(0,least(coalesce(p_offset,0),100000))
  ) found
$$;
revoke all on function public.duvar_archive(text,text,date,date,integer) from public;
grant execute on function public.duvar_archive(text,text,date,date,integer) to anon,authenticated;
-- The anonymous archive must be able to evaluate an empty, RLS-protected control list.
grant select on public.duvar_controls to anon;
