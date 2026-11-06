set local lock_timeout = '3s';
create index if not exists yorumlar_post_id_idx on public.yorumlar (post_id);
create index if not exists sozluk_entriler_baslik_id_idx on public.sozluk_entriler (baslik_id);
