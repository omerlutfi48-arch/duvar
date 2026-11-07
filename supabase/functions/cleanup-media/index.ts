import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { cloudinaryAsset, destroySignature } from "./media.ts";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Content-Type": "application/json",
};
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return response({ error: "POST gerekli." }, 405);
  const authorization = req.headers.get("Authorization");
  if (!authorization) return response({ error: "Oturum gerekli." }, 401);
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authorization } } },
  );
  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser();
  if (authError || !user)
    return response({ error: "Oturum doğrulanamadı." }, 401);
  const { data: admin, error: adminError } = await userClient.rpc("is_admin");
  if (adminError || !admin)
    return response({ error: "Yönetici yetkisi gerekli." }, 403);
  const apiKey = Deno.env.get("CLOUDINARY_API_KEY");
  const apiSecret = Deno.env.get("CLOUDINARY_API_SECRET");
  let input: { dry_run?: boolean };
  try {
    input = await req.json();
  } catch {
    return response({ error: "Geçersiz istek." }, 400);
  }
  if (input?.dry_run === true && (!apiKey || !apiSecret))
    return response({ configured: false, verified: false });
  if (!apiKey || !apiSecret)
    return response(
      {
        error: "Cloudinary erişim bilgileri henüz tanımlanmadı.",
        configured: false,
      },
      503,
    );
  let verified = false;
  try {
    const check = await fetch("https://api.cloudinary.com/v1_1/dxsvzlv1m/ping", {
      headers: { Authorization: "Basic " + btoa(`${apiKey}:${apiSecret}`) },
      signal: AbortSignal.timeout(10000),
    });
    const status = await check.json();
    verified = check.ok && status.status === "ok";
  } catch {
    verified = false;
  }
  if (input?.dry_run === true)
    return response({ configured: true, verified });
  if (!verified)
    return response({ error: "Cloudinary erişimi doğrulanamadı. Anahtar çiftini ve yetkisini kontrol et." }, 503);
  const server = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: jobs, error: claimError } = await server.rpc(
    "duvar_claim_media_jobs",
  );
  if (claimError) return response({ error: "Kuyruk okunamadı." }, 503);
  let completed = 0;
  let retained = 0;
  for (const job of jobs || []) {
    const asset = cloudinaryAsset(job.url);
    if (!asset) {
      await server.rpc("duvar_finish_media_job", {
        p_id: job.id,
        p_state: "invalid",
        p_code: null,
      });
      continue;
    }
    const { data: used, error: referenceError } = await server.rpc(
      "duvar_media_is_used",
      { p_url: job.url },
    );
    if (referenceError) continue;
    if (used) {
      await server.rpc("duvar_finish_media_job", {
        p_id: job.id,
        p_state: "retained",
        p_code: null,
      });
      retained++;
      continue;
    }
    try {
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = await destroySignature(
        asset.publicId,
        timestamp,
        apiSecret,
      );
      const body = new URLSearchParams({
        public_id: asset.publicId,
        timestamp: String(timestamp),
        signature,
        api_key: apiKey,
        invalidate: "true",
      });
      const result = await fetch(
        `https://api.cloudinary.com/v1_1/dxsvzlv1m/${asset.type}/destroy`,
        { method: "POST", body, signal: AbortSignal.timeout(15000) },
      );
      const payload = await result.json();
      const success = result.ok && ["ok", "not found"].includes(payload.result);
      const { error } = await server.rpc("duvar_finish_media_job", {
        p_id: job.id,
        p_state: success ? "done" : "pending",
        p_code: result.status,
      });
      if (success && !error) completed++;
    } catch {
      await server.rpc("duvar_finish_media_job", {
        p_id: job.id,
        p_state: "pending",
        p_code: 0,
      });
    }
  }
  return response({ completed, retained, processed: jobs?.length || 0 });
});
