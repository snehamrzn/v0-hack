import { saveSkill } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_CONTENT_BYTES = 100_000;

function jsonError(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function POST(req: Request): Promise<Response> {
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
