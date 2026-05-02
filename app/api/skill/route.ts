import { loadSkill } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id || !/^[a-z0-9]{6,16}$/.test(id)) {
    return new Response("invalid id", { status: 400 });
  }

  try {
    const content = await loadSkill(id);
    if (content == null) {
      return new Response("not found", { status: 404 });
    }
    return new Response(content, {
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (e) {
    console.error("[skill] loadSkill failed:", e);
    return new Response(
      JSON.stringify({ error: (e as Error)?.message || "load failed" }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
}
