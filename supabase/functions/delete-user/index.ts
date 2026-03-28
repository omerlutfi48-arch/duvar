import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ADMIN_EMAIL = 'omerlutfi48@gmail.com'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function errResp(msg: string, status: number) {
  return new Response(JSON.stringify({ error: msg }), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

function nickToEmail(nick: string): string {
  const s = nick.toLowerCase()
    .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i')
    .replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u');
  return s + '.u@duvar.app';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return errResp('Unauthorized', 401)

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )
  const { data: { user }, error: authErr } = await userClient.auth.getUser()
  if (authErr || !user) return errResp('Unauthorized', 401)

  const { auth_id: rawAuthId, nick } = await req.json()

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  let targetAuthId = rawAuthId
  let targetNick = nick

  // auth_id yoksa nick'ten email türet ve kullanıcıyı listeden bul
  if (!targetAuthId && nick) {
    const email = nickToEmail(nick)
    console.log('auth_id yok, email ile aranıyor:', email)
    const { data: usersPage } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 })
    const found = usersPage?.users?.find((u: { email: string; id: string }) => u.email === email)
    targetAuthId = found?.id
    console.log('Bulunan auth_id:', targetAuthId)
  }

  // nick yoksa auth_id ile kullanicilar'dan bul
  if (!targetNick && targetAuthId) {
    const { data: kulRow } = await adminClient.from('kullanicilar').select('nick').eq('auth_id', targetAuthId).maybeSingle()
    targetNick = kulRow?.nick
    console.log('auth_id ile bulunan nick:', targetNick)
  }

  if (!targetAuthId) {
    console.error('auth_id bulunamadı, nick:', nick)
    return errResp('auth_id veya geçerli nick gerekli', 400)
  }

  const isAdmin = user.email === ADMIN_EMAIL
  const isSelf = user.id === targetAuthId
  if (!isAdmin && !isSelf) return errResp('Forbidden', 403)

  console.log('Siliniyor:', targetAuthId, 'nick:', targetNick, '| isAdmin:', isAdmin, '| isSelf:', isSelf)

  // 1. kullanicilar satırını service role ile sil (RLS'i bypass eder)
  if (targetNick) {
    const { error: kulErr } = await adminClient.from('kullanicilar').delete().eq('nick', targetNick)
    if (kulErr) console.error('kullanicilar silinemedi:', kulErr.message)
    else console.log('kullanicilar silindi:', targetNick)
  }

  // 2. Auth kaydını sil
  const { error: deleteErr } = await adminClient.auth.admin.deleteUser(targetAuthId)
  if (deleteErr) {
    console.error('Auth silme hatası:', deleteErr.message)
    return errResp(deleteErr.message, 500)
  }

  console.log('Başarıyla silindi:', targetAuthId)
  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
