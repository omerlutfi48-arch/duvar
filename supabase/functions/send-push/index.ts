import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const VAPID_PUBLIC  = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
const SB_URL        = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Kimlik doğrulama: veritabanı tetikleyicisi (push_yorumlar / push_mesajlar) isteği service_role
// JWT'si ile gönderiyor. verify_jwt açık olduğu için imzayı Supabase zaten doğruluyor; burada
// rolün service_role olduğunu kontrol ediyoruz → herkesin bildiği anon anahtarla çağrılamaz.
// İsteğe bağlı ek: WEBHOOK_SECRET ayarlanırsa x-webhook-secret başlığı da kabul edilir.
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET") || "";
function jwtRole(req: Request): string {
  const tok = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const part = tok.split(".")[1];
  if (!part) return "";
  try {
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "="));
    return JSON.parse(json).role || "";
  } catch { return ""; }
}
// Webhook'tan gelen kayıt bu süreden eskiyse bildirim gönderilmez (eski kayıtlarla tekrar tetikleme / spam).
const MAX_AGE_MS = 5 * 60 * 1000;

webpush.setVapidDetails("mailto:admin@duvar.site", VAPID_PUBLIC, VAPID_PRIVATE);

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const secretOk = !!WEBHOOK_SECRET && req.headers.get("x-webhook-secret") === WEBHOOK_SECRET;
    if (!secretOk && jwtRole(req) !== "service_role") {
      return new Response("forbidden", { status: 403 });
    }
    const body = await req.json();
    const table  = body?.table;
    const recId  = body?.record?.id;
    if ((table !== "mesajlar" && table !== "yorumlar") || recId == null) return new Response("ok");

    const sb = createClient(SB_URL, SB_SERVICE);

    // Gövdedeki kayda güvenme: bu fonksiyon herkesin bildiği anon anahtarla da çağrılabiliyor.
    // Kaydı id ile veritabanından yeniden oku; nick'ler ve post_id sadece oradan gelsin.
    const { data: record } = await sb.from(table).select("*").eq("id", recId).maybeSingle();
    if (!record) return new Response("ok");
    // created_at kolonu yoksa yaş kontrolü atlanır (bildirimler bozulmasın)
    const createdAt = record.created_at ? new Date(record.created_at).getTime() : 0;
    if (createdAt && Date.now() - createdAt > MAX_AGE_MS) return new Response("ok");

    let recipientNick: string;
    let title: string;
    let message: string;
    let url: string;

    if (table === "mesajlar") {
      // Yeni DM → alıcıya bildir
      recipientNick = record.alici;
      title   = "💬 Yeni mesaj";
      message = `@${record.gonderen} sana mesaj gönderdi`;
      url     = "/#mesajlar";
    } else if (table === "yorumlar") {
      // Yeni yorum → gönderi sahibine bildir
      const { data: post } = await sb
        .from("posts").select("author").eq("id", record.post_id).maybeSingle();
      if (!post) return new Response("ok");
      recipientNick = post.author;
      title   = "💬 Yeni yorum";
      message = `@${record.nick} gönderine yorum yaptı`;
      url     = `/?post=${Number(record.post_id)}`;
    } else {
      return new Response("ok");
    }

    // Kendi kendine bildirim gitmesin
    const sender = record.gonderen || record.nick;
    if (sender === recipientNick) return new Response("ok");

    // Alıcının push aboneliklerini getir
    const { data: subs } = await sb
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .eq("nick", recipientNick);

    if (!subs?.length) return new Response("ok");

    const payload = JSON.stringify({ title, body: message, url, tag: table });

    await Promise.allSettled(
      subs.map(sub =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        ).catch(async (err: { statusCode?: number }) => {
          // Geçersiz aboneliği temizle
          if (err.statusCode === 410 || err.statusCode === 404) {
            await sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
          }
        })
      )
    );

    return new Response("ok");
  } catch (err) {
    console.error(err);
    return new Response("error", { status: 500 });
  }
});
