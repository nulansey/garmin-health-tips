// Supabase Edge Function: estimate a meal's calories from a photo.
// Deno runtime. No secrets in the client — ANTHROPIC_API_KEY is a function secret.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { mealPrompt } from "./prompt.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PLATE_CM = 27; // owner's usual dinner plate diameter
const BOWL_CM = 15;  // owner's usual bowl diameter

const SYSTEM = `You estimate calories from a photo of a meal. The owner's usual dinner plate is ${PLATE_CM} cm across and their usual bowl is ${BOWL_CM} cm across — use them to judge portion size. Estimate generously rather than low; real portions are usually bigger than they look. Return only the structured JSON.`;

const SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          estimated_calories: { type: "integer" },
        },
        required: ["name", "estimated_calories"],
        additionalProperties: false,
      },
    },
    total_calories: { type: "integer" },
  },
  required: ["items", "total_calories"],
  additionalProperties: false,
};

async function estimate(imageB64: string, name?: unknown) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      system: SYSTEM,
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageB64 } },
            { type: "text", text: mealPrompt(name) },
          ],
        },
      ],
    }),
  });
  if (!resp.ok) {
    const detail = await resp.text();
    return json({ error: "vision call failed", detail }, 502);
  }
  const data = await resp.json();
  const textBlock = data.content.find((b: { type: string }) => b.type === "text");
  return json(JSON.parse(textBlock.text));
}

const DAILY_PHOTO_CAP = 20;

function honoluluDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Honolulu",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now); // en-CA yields YYYY-MM-DD
}

async function underCap(authHeader: string | null): Promise<boolean> {
  if (!authHeader) return false;
  const client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const start = honoluluDate() + "T00:00:00-10:00";
  const { count } = await client
    .from("meals")
    .select("id", { count: "exact", head: true })
    .eq("source", "photo")
    .gte("created_at", start);
  return (count ?? 0) < DAILY_PHOTO_CAP;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: CORS });
  }
  try {
    const { image, name } = await req.json();
    if (!image || typeof image !== "string") {
      return json({ error: "missing image" }, 400);
    }
    // Absent is fine (first estimate). Present-but-not-a-string is a client
    // bug worth surfacing; over-length is truncated in normalizeName, since
    // the realistic cause is a rambling description, not an attack.
    if (name !== undefined && name !== null && typeof name !== "string") {
      return json({ error: "invalid name" }, 400);
    }
    if (!(await underCap(req.headers.get("Authorization")))) {
      return json({ error: "daily photo limit reached" }, 429);
    }
    return await estimate(image, name);
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
