// Supabase Edge Function: estimate a meal's calories from a photo.
// Deno runtime. No secrets in the client — ANTHROPIC_API_KEY is a function secret.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { mealPrompt, itemPrompt, systemPrompt, textPrompt } from "./prompt.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
          reasoning: { type: "string" },
        },
        required: ["name", "estimated_calories", "reasoning"],
        additionalProperties: false,
      },
    },
    total_calories: { type: "integer" },
  },
  required: ["items", "total_calories"],
  additionalProperties: false,
};

type EstimateArgs = {
  image?: unknown;
  name?: unknown;
  items?: unknown;
  itemIndex?: unknown;
  text?: unknown;
};

// Exactly one prompt is chosen here. With a photo: `items` + `itemIndex`
// re-price one item on the plate, `name` corrects the whole meal, neither is a
// first estimate. Without a photo it is a written description instead, and the
// system prompt drops the plate scale reference that would make no sense.
async function estimate({ image, name, items, itemIndex, text }: EstimateArgs) {
  const photo = typeof image === "string" && image !== "";
  const userText = photo
    ? (Array.isArray(items) ? itemPrompt(items, itemIndex) : mealPrompt(name))
    : textPrompt(text);
  const content: unknown[] = [];
  if (photo) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: image },
    });
  }
  content.push({ type: "text", text: userText });

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
      system: systemPrompt({ photo }),
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content }],
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
    const { image, name, items, itemIndex, text } = await req.json();

    // Auth is checked explicitly rather than relying on underCap's incidental
    // 429: the text path skips the cap, and an unauthenticated request must
    // never reach a paid API call.
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "unauthorized" }, 401);

    const hasImage = typeof image === "string" && image !== "";
    const hasText = typeof text === "string" && text.trim() !== "";
    if (!hasImage && !hasText) {
      return json({ error: "missing image or text" }, 400);
    }
    if (text !== undefined && text !== null && typeof text !== "string") {
      return json({ error: "invalid text" }, 400);
    }
    // Absent is fine (first estimate). Present-but-not-a-string is a client
    // bug worth surfacing; over-length is truncated in normalizeName, since
    // the realistic cause is a rambling description, not an attack.
    if (name !== undefined && name !== null && typeof name !== "string") {
      return json({ error: "invalid name" }, 400);
    }
    if (items !== undefined && !Array.isArray(items)) {
      return json({ error: "invalid items" }, 400);
    }
    // The cap counts saved photo meals and exists to bound image spend. Text
    // estimates cost no image tokens and are deliberately uncapped.
    if (hasImage && !(await underCap(auth))) {
      return json({ error: "daily photo limit reached" }, 429);
    }
    return await estimate({ image, name, items, itemIndex, text });
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
