import { createAnthropic } from "@ai-sdk/anthropic";
import { streamText, stepCountIs } from "ai";
import { createMCPClient } from "@ai-sdk/mcp";
import { SKILL_CREATOR_PROMPT } from "./skill-creator-prompt";

const SYSTEM_PROMPT = `${SKILL_CREATOR_PROMPT}

---

# Skillsmith integration notes

You are embedded in Skillsmith, a guided web interview that walks a non-technical user through authoring an agent skill. The user's message will start with one of four mode markers: POLISH_FIELD, SYNTHESIZE_SKILL_MD, RESEARCH_TOPIC, or OPTIMIZE_DESCRIPTION. (A fifth mode, TEST_TRIGGER, runs against a different system prompt.)

## Mode: POLISH_FIELD

The message names a single field (one of: name, purpose, trigger, steps, gotchas, example) and provides the user's current draft plus prior answers for context. Polish ONLY that field's text.

- Keep the user's voice and intent. Don't invent details they didn't supply.
- For "trigger": be pushy — agents under-trigger skills, so phrase as concrete moments and phrases that should activate it.
- For "steps": output as numbered steps, one per line, imperative voice.
- For "gotchas": output as a bullet list, one per line.
- For "name": lowercase, hyphenated slug.
- For "purpose": one tight sentence.

Return ONLY the polished value for that field. No preamble, no markdown headers, no commentary.

## Mode: SYNTHESIZE_SKILL_MD

The message contains all of the user's interview answers and asks for a complete SKILL.md file. Produce a real, valid skill file following the skill-creator guidance above:

- YAML frontmatter with \`name:\` (lowercase hyphenated slug) and \`description:\` (a pushy description that names concrete trigger phrases — agents under-trigger skills).
- A top-level \`# <Title>\` heading.
- An \`## Overview\` section explaining what the skill does.
- An \`## Instructions\` section as numbered, imperative steps.
- A \`## Gotchas\` section as a bullet list, IF the user provided any (omit otherwise).
- An \`## Example\` section in a fenced code block, IF the user provided one (omit otherwise).
- Don't invent gotchas or examples the user didn't supply.
- Tighten grammar, sharpen specifics, but preserve the user's voice and intent.

If a \`research_notes:\` block is present in the user message, treat it as background research — let it inform specifics in \`## Instructions\` and \`## Gotchas\`, but DO NOT include URLs, \`[N]\` citations, or the word "research" in the final SKILL.md. Keep the user's voice.

Return ONLY the raw SKILL.md content (starting with \`---\`). No preamble, no surrounding code fence, no commentary.

## Mode: RESEARCH_TOPIC

The user message contains a skill-in-progress (name, purpose, trigger). You have two tools: \`search_skills\` (queries a public registry of existing SKILL.md files via MCP) and \`web_search\` (general web search). Research the skill's domain so the writer can ground the final SKILL.md in real-world best practices and existing prior art.

Required behavior:
- Read only the name, purpose, and trigger from the user message.
- **First**, call \`search_skills\` exactly once with the skill's purpose as the query (e.g. "react testing", "sql migrations"). If matches come back, cite them in \`## Sources\` so synthesis can reference how other authors structured similar skills. If no matches, just continue.
- **Then**, issue **2–4 distinct web_search calls**. Vary your queries across these flavors: (a) authoritative best-practice articles in the domain, (b) common pitfalls and "mistakes when X" pieces, (c) recent (2024–2026) tooling and patterns, (d) workflow checklists. Do not settle for one search even if it looks complete.
- Output exactly this structure, no preamble, no commentary:

\`\`\`
## Findings
- <bullet> [N]
## Pitfalls
- <bullet> [N]
## Sources
[1] <url> — <one-line title>
[2] ...
\`\`\`

Every bullet must cite a source by number. The Sources list must include every \`[N]\` referenced. Cap output at ~600 words. Do NOT write the SKILL.md itself.

## Mode: OPTIMIZE_DESCRIPTION

The user message contains a complete SKILL.md. Read its YAML frontmatter \`description:\` line and rewrite it to be more aggressive about triggering the skill.

Rules for the rewritten description:
- Name **concrete trigger phrases** the user might say ("when I paste meeting notes", "for code reviews", "when a .csv lands in inbox").
- Reference specific domains, tools, file types, or task verbs. Agents under-trigger on vague descriptions.
- Start with an action verb when possible.
- No marketing fluff ("seamlessly", "elegantly", "best-in-class").
- Keep under 200 characters.

If a \`failed_cases:\` block is present, those are user requests where the existing description failed to trigger — make sure the rewrite covers those phrasings.

Output strict JSON and nothing else — no markdown, no preamble, no surrounding fence:

\`\`\`
{"original": "<original description value>", "improved": "<rewritten value>", "changes": "<one-sentence rationale>"}
\`\`\``;

const SEARCH_REGISTRY_SYSTEM = `You search a public registry of existing agent skills via the \`search_skills\` MCP tool.

The user message will give you a topic. Call \`search_skills\` exactly once with that topic as the query (limit 5). Then output **only** the JSON the tool returned — no preamble, no markdown fence, no commentary. If the tool errors, output {"hits": []}.`;

const TEST_TRIGGER_SYSTEM = `You are deciding whether to use a skill based solely on its name and description. Imagine you have many skills available and you must pick the right one for the user's request.

The user message will give you a skill's name and description and ask you to:

1. Invent 3 plausible user requests in the skill's domain where it SHOULD obviously fire.
2. Invent 1 adjacent user request where this skill should NOT fire (a different skill, or no skill, would handle it).
3. For each of the 4 requests, judge honestly whether the description as written would lead you to pick this skill. Be strict — if the description is vague, doesn't name the right domain, or doesn't match the user's likely phrasing, mark it false. Do not be charitable.

Output strict JSON and nothing else — no markdown, no preamble, no surrounding fence:

{"tests": [{"request": "<user request>", "should_fire": true|false, "would_fire": true|false, "reason": "<one sentence>"}, ...]}`;

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

// Compute the URL of the Skill Registry MCP server. In prod (Vercel) we
// auto-detect the deployment URL via VERCEL_URL; in dev we default to
// localhost. Override with MCP_URL env var for testing or to point at an
// external MCP server.
function getMcpUrl(req: Request): string {
  if (process.env.MCP_URL) return process.env.MCP_URL;
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}/api/mcp/mcp`;
  }
  const host = req.headers.get("host") ?? "localhost:5173";
  const proto = host.startsWith("localhost") ? "http" : "https";
  return `${proto}://${host}/api/mcp/mcp`;
}

// Open an MCP client to our Skill Registry server. Returns null on failure
// so callers can degrade gracefully (e.g. RESEARCH_TOPIC falls back to
// web_search-only). The returned client must be closed by the caller, ideally
// in streamText's onFinish callback.
async function openSkillRegistryClient(req: Request) {
  try {
    const url = getMcpUrl(req);
    const client = await createMCPClient({
      transport: { type: "http" as const, url },
    });
    const tools = await client.tools();
    return { client, tools };
  } catch (e) {
    console.warn("[mcp] failed to open skill-registry client:", e);
    return null;
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "ANTHROPIC_API_KEY not set on the server" }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }

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

  const anthropic = createAnthropic({ apiKey });
  const model = anthropic("claude-sonnet-4-5");
  const mode = detectMode(messages);

  try {
    if (mode === "SEARCH_REGISTRY") {
      // Lightweight mode used by App.tsx to populate the find-or-build screen.
      // Forces the model to call search_skills exactly once and return JSON.
      const mcp = await openSkillRegistryClient(req);
      if (!mcp) {
        // MCP unreachable — return empty hits so the UI auto-advances to
        // the write-fresh path.
        return new Response('{"hits":[]}', {
          status: 200,
          headers: { "content-type": "text/plain" },
        });
      }
      const result = streamText({
        model,
        system: SEARCH_REGISTRY_SYSTEM,
        messages,
        tools: mcp.tools,
        stopWhen: stepCountIs(3),
        maxOutputTokens: 1024,
        abortSignal: AbortSignal.timeout(20_000),
        onFinish: async () => {
          await mcp.client.close().catch(() => {});
        },
      });
      return result.toTextStreamResponse();
    }

    if (mode === "RESEARCH_TOPIC") {
      // Open MCP client so the model can also call search_skills alongside
      // web_search. If MCP fails, degrade gracefully to web_search only.
      const mcp = await openSkillRegistryClient(req);
      const tools = {
        web_search: anthropic.tools.webSearch_20250305({ maxUses: 4 }),
        ...(mcp?.tools ?? {}),
      };
      const result = streamText({
        model,
        system: SYSTEM_PROMPT,
        messages,
        tools,
        stopWhen: stepCountIs(8),
        maxOutputTokens: 4096,
        abortSignal: AbortSignal.timeout(30_000),
        onFinish: async () => {
          if (mcp) await mcp.client.close().catch(() => {});
        },
      });
      return result.toTextStreamResponse();
    }

    if (mode === "OPTIMIZE_DESCRIPTION") {
      const result = streamText({
        model,
        system: SYSTEM_PROMPT,
        messages,
        maxOutputTokens: 512,
      });
      return result.toTextStreamResponse();
    }

    if (mode === "TEST_TRIGGER") {
      const result = streamText({
        model,
        system: TEST_TRIGGER_SYSTEM,
        messages,
        maxOutputTokens: 1024,
      });
      return result.toTextStreamResponse();
    }

    // POLISH_FIELD / SYNTHESIZE_SKILL_MD (default branch)
    const result = streamText({
      model,
      system: SYSTEM_PROMPT,
      messages,
      maxOutputTokens: 2048,
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
