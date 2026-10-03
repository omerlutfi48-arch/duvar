-- DUVAR — isteğe bağlı sıkılaştırma: misafirin (anon) hiç gerekmeyen RPC'leri çağırma yetkisini kaldır.
-- Fonksiyonlar zaten çağıranın kimliğini kontrol ediyor (misafir çağırırsa 'yetkisiz' hatası alır);
-- bu dosya Supabase güvenlik uyarı listesini sadeleştirir. Supabase → SQL Editor'da çalıştırılabilir.
--
-- NOT: my_nick(), is_admin(), is_banned() BİLEREK listede yok: güvenlik kuralları misafir
-- sorgularında da bu fonksiyonları çağırıyor; yetkileri kaldırılırsa misafir sorguları hata verir.

revoke execute on function public.artir_begen(bigint, text)       from public, anon;
revoke execute on function public.geri_al_begen(bigint, text)     from public, anon;
revoke execute on function public.artir_begenmeme(bigint, text)   from public, anon;
revoke execute on function public.geri_al_begenmeme(bigint, text) from public, anon;
revoke execute on function public.nick_degistir(text)             from public, anon;
grant  execute on function public.artir_begen(bigint, text), public.geri_al_begen(bigint, text),
                           public.artir_begenmeme(bigint, text), public.geri_al_begenmeme(bigint, text),
                           public.nick_degistir(text) to authenticated;

-- Tetikleyici fonksiyonları zaten doğrudan çağrılamaz; API listesinden de çıkar.
revoke execute on function public.handle_auth_user_deleted() from public, anon, authenticated;
revoke execute on function public.kullanicilar_koru()        from public, anon, authenticated;
