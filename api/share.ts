import { saveSkill } from "./storage.js";

const MAX_CONTENT_BYTES = 100_000;

function jsonError(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const content = body?.content;
  if (typeof content !== "string" || !content.trim()) {
    return jsonError("expected { content: string }", 400);
  }
  if (content.length > MAX_CONTENT_BYTES) {
    return jsonError(`content too large (>${MAX_CONTENT_BYTES} bytes)`, 413);
  }

  try {
    const id = await saveSkill(content);
    return new Response(JSON.stringify({ id }), {
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    console.error("[share] saveSkill failed:", e);
    return jsonError((e as Error)?.message || "save failed", 500);
  }
}
