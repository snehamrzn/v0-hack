export const runtime = "nodejs";

export default async function handler(_req: Request): Promise<Response> {
  return new Response(
    JSON.stringify({ marker: "skillsmith-diag-v1", deployedAt: new Date().toISOString() }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}
