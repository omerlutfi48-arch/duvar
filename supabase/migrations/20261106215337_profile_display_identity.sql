set local lock_timeout='3s';
alter table public.kullanicilar
  add column display_name text,
  add column is_anonymous boolean not null default true,
  add constraint kullanicilar_display_name_check check (
    (is_anonymous and (display_name is null or display_name ~ '^[a-z0-9_çğıöşü]{2,20}$'))
    or (not is_anonymous and display_name is not null and char_length(btrim(display_name)) between 1 and 100)
  );
create unique index kullanicilar_visible_alias_key
  on public.kullanicilar (lower(case when is_anonymous then coalesce(display_name,nick) else nick end));
