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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return errResp('Yöntem desteklenmiyor.', 405)

  const authorization = req.headers.get('Authorization')
  if (!authorization) return errResp('Oturum gerekli.', 401)
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
  })
  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) return errResp('Oturum doğrulanamadı.', 401)

  let body: { scope?: string; nick?: string }
  try {
    body = await req.json()
  } catch {
    return errResp('Geçersiz istek.', 400)
  }
  if (!body || !['self', 'admin'].includes(body.scope ?? '')) {
    return errResp('Silme türü belirtilmedi.', 400)
  }

  const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  let targetId = user.id
  if (body.scope === 'admin') {
    if (!user.email_confirmed_at || !(await isAdminEmail(user.email))) {
      return errResp('Yönetici yetkisi gerekli.', 403)
    }
    if (typeof body.nick !== 'string' || !body.nick.trim()) {
      return errResp('Profil adı gerekli.', 400)
    }
    const { data: profile, error } = await admin.from('kullanicilar')
      .select('auth_id').eq('nick', body.nick).maybeSingle()
    if (error) return errResp('Profil okunamadı.', 503)
    if (!profile?.auth_id) return errResp('Giriş hesabına bağlı profil bulunamadı.', 404)
    targetId = profile.auth_id
  }

  // Auth silme tetikleyicisi profil ve bağlı verileri aynı işlemde temizler.
  const { error } = await admin.auth.admin.deleteUser(targetId)
  if (error) {
    console.error('Account deletion failed', error.code, error.status)
    return errResp('Hesap silinemedi. Tekrar deneyebilirsin.', 503)
  }
  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
