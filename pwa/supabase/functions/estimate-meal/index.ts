// Supabase Edge Function: estimate a meal's calories from a photo.
// Deno runtime. No secrets in the client — ANTHROPIC_API_KEY is a function secret.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: CORS });
  }
  try {
    const { image } = await req.json();
    if (!image || typeof image !== "string") {
      return json({ error: "missing image" }, 400);
    }
    return json({ ok: true });
  } catch {
    return json({ error: "bad request" }, 400);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}
