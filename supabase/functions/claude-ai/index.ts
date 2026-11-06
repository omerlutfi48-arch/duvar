import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── Kötüye kullanım sınırları ──
const MAX_MESSAGES = 20          // istemci son 20 mesajı gönderir
const MAX_CHARS_PER_MESSAGE = 2000
const MAX_TOTAL_CHARS = 12000
type Msg = { role: 'user' | 'assistant'; content: string }
function sanitizeMessages(raw: unknown): Msg[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_MESSAGES) return null
  let total = 0
  const out: Msg[] = []
  for (const m of raw) {
    if (!m || typeof m !== 'object') return null
    const role = (m as Record<string, unknown>).role
    const content = (m as Record<string, unknown>).content
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') return null
    const c = content.trim()
    if (!c || c.length > MAX_CHARS_PER_MESSAGE) return null
    total += c.length
    out.push({ role, content: c }) // sadece role + content geçer, başka alan geçmez
  }
  if (total > MAX_TOTAL_CHARS) return null
  if (out[0].role !== 'user' || out[out.length - 1].role !== 'user') return null
  return out
}

function errResp(msg: string, status: number) {
  return new Response(JSON.stringify({ error: msg }), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
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

  const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
  if (!ANTHROPIC_API_KEY) return errResp('AI yapılandırılmamış', 500)

  // Banlı kullanıcı AI kullanamasın
  const { data: kul } = await userClient.rpc('duvar_my_profile').maybeSingle()
  // Profil satırı olmayan (sadece auth kaydı açılmış) hesaplar ve banlılar kullanamaz
  if (!kul || kul.banli) return errResp('Bu hesap AI kullanamaz', 403)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return errResp('Geçersiz istek', 400) }
  const mode = body.mode === 'content' ? 'content' : 'chat'
  const messages = sanitizeMessages(body.messages)
  if (!messages) return errResp('Geçersiz veya çok uzun mesaj', 400)

  const serverClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: allowed, error: quotaError } = await serverClient.rpc('duvar_take_ai_quota', { p_user_id: user.id })
  if (quotaError) {
    console.error('AI quota check failed', quotaError.code)
    return errResp('AI şu anda kullanılamıyor. Tekrar dene.', 503)
  }
  if (!allowed) return errResp('Kullanım sınırına ulaştın. Biraz sonra tekrar dene.', 429)

  const systemPrompts: Record<string, string> = {
    content: `Sen DUVAR platformu için içerik üretme asistanısın. DUVAR, mimarlık öğrencileri için anonim bir yardımlaşma platformudur.
Görevin: Kullanıcının verdiği anahtar kelimeler veya taslak metin alıp platforma uygun, samimi, kısa bir gönderi metni oluşturmak.
Kurallar:
- Maksimum 400 karakter
- Samimi ve doğal bir dil kullan, sıradan öğrenci sesi
- Türkçe yaz
- Sadece gönderi metnini döndür, başında/sonunda açıklama ekleme`,

    chat: `Sen DUVAR platformunda mimarlık öğrencilerine yardımcı olan bir asistansın.
DUVAR, Türkiye'deki mimarlık öğrencileri için anonim bir yardımlaşma platformudur.
Yardımcı olduğun konular: stüdyo projeleri, jüri hazırlığı, konsept geliştirme, referans bulma, okul stresi, kariyer soruları, mimarlık tarihi ve teorisi.
Kurallar:
- Her zaman Türkçe yaz
- Kısa ve pratik cevaplar ver (genellikle 2-4 cümle yeterli, uzun açıklama gereken konularda biraz daha uzayabilir)
- Destekleyici ve anlayışlı ol
- Mimarlık bilgini kullan ama öğrenci diline uygun, jargon'suz anlat`,
  }

  const system = systemPrompts[mode]
  const maxTokens = mode === 'content' ? 300 : 600

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: maxTokens,
      system,
      messages,
    }),
  })

  if (!resp.ok) {
    const err = await resp.text()
    console.error('Anthropic error:', resp.status, err)
    return errResp('AI servisi hata verdi', 500)
  }

  const data = await resp.json()
  const text = data.content?.[0]?.text || ''

  return new Response(JSON.stringify({ text }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
