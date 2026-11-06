// Retired endpoint. The web and admin clients now use delete-account.
Deno.serve((req) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Content-Type': 'application/json',
  }
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  return new Response(JSON.stringify({ error: 'Hesap silmek için sayfayı yenile.' }), {
    status: 410, headers,
  })
})
