set local lock_timeout='3s';
create function duvar_private.enqueue_push()
returns trigger
language plpgsql security definer set search_path=''
as $$
declare
  v_epoch bigint := floor(extract(epoch from clock_timestamp()));
begin
  perform net.http_post(
    url := 'https://tnxflwddhucvlejmoihj.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRueGZsd2RkaHVjdmxlam1vaWhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0NjU5OTcsImV4cCI6MjA5MDA0MTk5N30.XFwCgn8lseNGsYDzigmHKDIBBRqByJ9gOpaPRmkT4Vs'),
    body := jsonb_build_object(
      'table',tg_table_name,
      'record',jsonb_build_object('id',new.id),
      'epoch',v_epoch,
      'signature',duvar_private.push_signature(tg_table_name,new.id,v_epoch)
    ),
    timeout_milliseconds := 5000
  );
  return new;
end $$;
revoke all on function duvar_private.enqueue_push() from public, anon, authenticated;

create or replace trigger push_mesajlar after insert on public.mesajlar
  for each row execute function duvar_private.enqueue_push();
create or replace trigger push_yorumlar after insert on public.yorumlar
  for each row execute function duvar_private.enqueue_push();
