import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Admin e-postası koda açık metin yazılmaz: ADMIN_EMAIL secret'ı varsa o, yoksa SHA-256 özeti
// (istemcideki utils.js ile aynı) karşılaştırılır.
const ADMIN_EMAIL = (Deno.env.get('ADMIN_EMAIL') || '').trim().toLowerCase()
const ADMIN_EMAIL_SHA256 = '72cb38c5f992a10da19d9de490b9ccf9d5171a9d28afc0ff2c3ece34e79e0697'
async function isAdminEmail(email: string | undefined): Promise<boolean> {
  const e = (email || '').trim().toLowerCase()
  if (!e) return false
  if (ADMIN_EMAIL) return e === ADMIN_EMAIL
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(e))
  const hex = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
  return hex === ADMIN_EMAIL_SHA256
}

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

  const isAdmin = await isAdminEmail(user.email)

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  let targetAuthId: string | undefined
  let targetNick: string | null = null

  if (!isAdmin) {
    // Normal kullanıcı: istek gövdesi tamamen yok sayılır, sadece kendi hesabı silinir.
    targetAuthId = user.id
    const { data: ownRow } = await adminClient.from('kullanicilar').select('nick').eq('auth_id', user.id).maybeSingle()
    targetNick = ownRow?.nick ?? null
  } else {
    let body: Record<string, unknown> = {}
    try { body = await req.json() } catch { /* boş gövde */ }
    const rawAuthId = typeof body.auth_id === 'string' ? body.auth_id : undefined
    const nick = typeof body.nick === 'string' ? body.nick : undefined
    targetAuthId = rawAuthId
    targetNick = nick ?? null

    // auth_id yoksa nick'ten email türet ve kullanıcıyı bul (sadece admin)
    if (!targetAuthId && nick) {
      const email = nickToEmail(nick)
      for (let page = 1; page <= 20 && !targetAuthId; page++) {
        const { data: usersPage } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 })
        const users = usersPage?.users || []
        targetAuthId = users.find((u: { email: string; id: string }) => u.email === email)?.id
        if (users.length < 1000) break
      }
    }
    // nick yoksa auth_id ile kullanicilar'dan bul
    if (!targetNick && targetAuthId) {
      const { data: kulRow } = await adminClient.from('kullanicilar').select('nick').eq('auth_id', targetAuthId).maybeSingle()
      targetNick = kulRow?.nick ?? null
    }
    if (!targetAuthId) return errResp('Kullanıcı bulunamadı', 400)

    // kullanicilar.auth_id istemciden yazılabildiği için ona körü körüne güvenme: silinecek auth
    // hesabı gerçekten bu nick'e mi ait? (Aksi halde biri kendi satırına başkasının auth_id'sini
    // yazıp, admin onu silerken kurbanın hesabını sildirebilirdi.)
    if (targetNick) {
      const { data: au } = await adminClient.auth.admin.getUserById(targetAuthId)
      const authUser = au?.user
      const owns = !!authUser && (authUser.user_metadata?.nick === targetNick || authUser.email === nickToEmail(targetNick))
      if (!owns) return errResp('auth_id ile nick eşleşmiyor — silme durduruldu', 409)
    }
  }

  console.log('Siliniyor:', targetAuthId, 'nick:', targetNick, '| isAdmin:', isAdmin)

  // 1. kullanicilar satırını service role ile sil (RLS'i bypass eder)
  if (targetNick) {
    let del = adminClient.from('kullanicilar').delete().eq('nick', targetNick)
    if (!isAdmin) del = del.eq('auth_id', targetAuthId)
    const { error: kulErr } = await del
    if (kulErr) console.error('kullanicilar silinemedi:', kulErr.message)
    else console.log('kullanicilar silindi:', targetNick)
  }

  // 2. Auth kaydını sil
  const { error: deleteErr } = await adminClient.auth.admin.deleteUser(targetAuthId)
  if (deleteErr) {
    console.error('Auth silme hatası:', deleteErr.message)
    return errResp('Hesap silinemedi', 500)
  }

  console.log('Başarıyla silindi:', targetAuthId)
  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
