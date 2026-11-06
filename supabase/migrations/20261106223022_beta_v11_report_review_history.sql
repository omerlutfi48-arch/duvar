set local lock_timeout='3s';
alter table public.raporlar
  add column reviewed_at timestamptz,
  add column review_note text check (review_note is null or char_length(review_note) between 5 and 240),
  add column reviewed_by uuid references auth.users(id) on delete set null;

revoke insert on public.raporlar from public, anon, authenticated;
grant insert (post_id, sebep, bildiren) on public.raporlar to authenticated;

create function public.duvar_resolve_report(p_id bigint,p_reason text)
returns boolean
language plpgsql security definer set search_path=''
as $$
begin
  if (select auth.uid()) is null or not (select public.is_admin()) then
    raise exception 'Unauthorized' using errcode='42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 5 and 240 then
    raise exception 'Review reason must have 5–240 characters' using errcode='22023';
  end if;
  update public.raporlar
  set reviewed_at=pg_catalog.now(),review_note=btrim(p_reason),reviewed_by=(select auth.uid())
  where id=p_id and reviewed_at is null;
  return found;
end $$;
revoke all on function public.duvar_resolve_report(bigint,text) from public, anon;
grant execute on function public.duvar_resolve_report(bigint,text) to authenticated;
