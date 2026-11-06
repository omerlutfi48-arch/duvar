set local lock_timeout='3s';
select vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'duvar_push_signing_key')
where not exists (select 1 from vault.secrets where name='duvar_push_signing_key');

create function duvar_private.push_signature(p_table text,p_id bigint,p_epoch bigint)
returns text
language sql stable security definer set search_path=''
as $$
  select encode(extensions.hmac(p_table||':'||p_id||':'||p_epoch,decrypted_secret,'sha256'),'hex')
  from vault.decrypted_secrets where name='duvar_push_signing_key'
$$;
revoke all on function duvar_private.push_signature(text,bigint,bigint) from public, anon, authenticated;

create function public.duvar_verify_push_signature(p_table text,p_id bigint,p_epoch bigint,p_signature text)
returns boolean
language sql stable security definer set search_path=''
as $$
  select coalesce(
    p_table in ('mesajlar','yorumlar')
    and abs(extract(epoch from now())-p_epoch)<300
    and p_signature=duvar_private.push_signature(p_table,p_id,p_epoch),
    false
  )
$$;
revoke all on function public.duvar_verify_push_signature(text,bigint,bigint,text) from public, anon, authenticated;
grant execute on function public.duvar_verify_push_signature(text,bigint,bigint,text) to service_role;
