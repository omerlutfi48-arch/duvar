import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const VAPID_PUBLIC  = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
const SB_URL        = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

webpush.setVapidDetails("mailto:admin@duvar.site", VAPID_PUBLIC, VAPID_PRIVATE);

Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const record = body.record;
    const table  = body.table;

    const sb = createClient(SB_URL, SB_SERVICE);

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
      url     = `/?p=${record.post_id}`;
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
