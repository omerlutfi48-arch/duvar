import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ADMIN_EMAIL = 'omerlutfi48@gmail.com'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function err(msg: string, status: number) {
  return new Response(JSON.stringify({ error: msg }), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return err('Unauthorized', 401)

  // Çağıranın kim olduğunu doğrula
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )
  const { data: { user }, error: authErr } = await userClient.auth.getUser()
  if (authErr || !user) return err('Unauthorized', 401)

  const { auth_id } = await req.json()
  if (!auth_id) return err('auth_id gerekli', 400)

  // Sadece admin başkasını silebilir, kullanıcı kendini silebilir
  const isAdmin = user.email === ADMIN_EMAIL
  const isSelf = user.id === auth_id
  if (!isAdmin && !isSelf) return err('Forbidden', 403)

  // Service role ile auth kullanıcısını sil
  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  const { error: deleteErr } = await adminClient.auth.admin.deleteUser(auth_id)
  if (deleteErr) return err(deleteErr.message, 500)

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
