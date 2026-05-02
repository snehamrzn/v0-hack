import { createAnthropic } from "@ai-sdk/anthropic";
import { streamText, stepCountIs } from "ai";
import {
  SYSTEM_PROMPT,
  TEST_TRIGGER_SYSTEM,
  extractBlockField,
} from "@/lib/skill-prompts";
import { searchSkills } from "@/lib/skill-registry";

export const runtime = "nodejs";
export const maxDuration = 60;

type Mode =
  | "POLISH_FIELD"
  | "SYNTHESIZE_SKILL_MD"
  | "RESEARCH_TOPIC"
  | "OPTIMIZE_DESCRIPTION"
  | "TEST_TRIGGER"
  | "SEARCH_REGISTRY";

function detectMode(messages: any[]): Mode {
  const last = messages[messages.length - 1];
  const content = typeof last?.content === "string" ? last.content : "";
  const m = content.match(/Mode:\s*(\w+)/);
  const raw = m?.[1];
  if (
    raw === "POLISH_FIELD" ||
    raw === "SYNTHESIZE_SKILL_MD" ||
    raw === "RESEARCH_TOPIC" ||
    raw === "OPTIMIZE_DESCRIPTION" ||
    raw === "TEST_TRIGGER" ||
    raw === "SEARCH_REGISTRY"
  ) {
    return raw;
  }
  return "POLISH_FIELD";
}

function sentinelFor(mode: Mode): string | null {
  if (mode === "RESEARCH_TOPIC") return "RESEARCH_UNAVAILABLE";
  if (mode === "OPTIMIZE_DESCRIPTION") return "OPTIMIZE_UNAVAILABLE";
  if (mode === "TEST_TRIGGER") return "TRIGGER_TEST_UNAVAILABLE";
  if (mode === "SEARCH_REGISTRY") return '{"hits":[]}';
  return null;
}

function lastUserContent(messages: any[]): string {
  const last = messages[messages.length - 1];
  return typeof last?.content === "string" ? last.content : "";
}

export async function POST(req: Request): Promise<Response> {
  try {
    return await handleChat(req);
  } catch (e) {
    console.error("[chat] unhandled error:", e);
    return new Response(
      JSON.stringify({ error: (e as Error)?.message || String(e) }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
}

async function handleChat(req: Request): Promise<Response> {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const messages = body?.messages;
  if (!Array.isArray(messages)) {
    return new Response(
      JSON.stringify({ error: "Expected { messages: [...] }" }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  const mode = detectMode(messages);
  const content = lastUserContent(messages);

  try {
    if (mode === "SEARCH_REGISTRY") {
      // This path powers the find-or-build screen and should stay fast.
      // Skip the LLM entirely and hit the shared registry search directly.
      const query = extractBlockField(content, "query");
      if (!query) {
        return new Response('{"hits":[]}', {
          status: 200,
          headers: { "content-type": "text/plain" },
        });
      }

      const hits = await searchSkills(query, 5).catch(() => []);
      return new Response(JSON.stringify({ hits }), {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "ANTHROPIC_API_KEY not set on the server" }),
        { status: 500, headers: { "content-type": "application/json" } }
      );
    }

    const anthropic = createAnthropic({ apiKey });
    const model = anthropic("claude-sonnet-4-5");

    if (mode === "RESEARCH_TOPIC") {
      const purpose = extractBlockField(content, "purpose");
      const name = extractBlockField(content, "name");
      const registryQuery = purpose || name;
      const registryHits = registryQuery
        ? await searchSkills(registryQuery, 5).catch(() => [])
        : [];
      const researchMessage =
        registryHits.length === 0
          ? content
          : `${content}

registry_hits:
${registryHits.map((hit, index) => `[${index + 1}] ${hit.url} — ${hit.name}${hit.description ? ` (${hit.description})` : ""}`).join("\n")}`;

      const tools = {
        web_search: anthropic.tools.webSearch_20250305({ maxUses: 3 }),
      };
      const result = streamText({
        model,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: researchMessage }],
        tools,
        stopWhen: stepCountIs(6),
        maxOutputTokens: 2048,
        abortSignal: AbortSignal.timeout(45_000),
      });
      return result.toTextStreamResponse();
    }

    if (mode === "OPTIMIZE_DESCRIPTION") {
      const result = streamText({
        model,
        system: SYSTEM_PROMPT,
        messages,
        maxOutputTokens: 512,
        abortSignal: AbortSignal.timeout(30_000),
      });
      return result.toTextStreamResponse();
    }

    if (mode === "TEST_TRIGGER") {
      const result = streamText({
        model,
        system: TEST_TRIGGER_SYSTEM,
        messages,
        maxOutputTokens: 1024,
        abortSignal: AbortSignal.timeout(30_000),
      });
      return result.toTextStreamResponse();
    }

    // POLISH_FIELD / SYNTHESIZE_SKILL_MD (default branch)
    const result = streamText({
      model,
      system: SYSTEM_PROMPT,
      messages,
      maxOutputTokens: 2048,
      abortSignal: AbortSignal.timeout(50_000),
    });
    return result.toTextStreamResponse();
  } catch (e) {
    const sentinel = sentinelFor(mode);
    if (sentinel) {
      return new Response(sentinel, {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    }
    return new Response(
      JSON.stringify({ error: (e as Error)?.message || String(e) }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
}
