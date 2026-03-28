import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
  if (!ANTHROPIC_API_KEY) return errResp('AI yapılandırılmamış — ANTHROPIC_API_KEY eksik', 500)

  const { mode, messages } = await req.json()
  if (!messages?.length) return errResp('messages gerekli', 400)

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

  const system = systemPrompts[mode] || systemPrompts.chat
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
