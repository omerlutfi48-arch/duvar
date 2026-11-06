set local lock_timeout='3s';
revoke update on public.mesajlar, public.notifications from public, anon, authenticated;
grant update (okundu) on public.mesajlar to authenticated;
grant update (read) on public.notifications to authenticated;
do $$
begin
  if has_column_privilege('authenticated','public.mesajlar','metin','UPDATE')
     or has_column_privilege('authenticated','public.notifications','action','UPDATE')
     or has_column_privilege('anon','public.mesajlar','okundu','UPDATE')
     or has_column_privilege('anon','public.notifications','read','UPDATE')
     or not has_column_privilege('authenticated','public.mesajlar','okundu','UPDATE')
     or not has_column_privilege('authenticated','public.notifications','read','UPDATE') then
    raise exception 'Unexpected message or notification update privileges';
  end if;
end $$;
