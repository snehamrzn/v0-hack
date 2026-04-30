import { createAnthropic } from "@ai-sdk/anthropic";
import { streamText } from "ai";
import { SKILL_CREATOR_PROMPT } from "./skill-creator-prompt";

const SYSTEM_PROMPT = `${SKILL_CREATOR_PROMPT}

---

# Skillsmith integration notes

You are embedded in Skillsmith, a guided web interview that walks a non-technical user through authoring an agent skill. The user's message will start with one of two mode markers:

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

Return ONLY the raw SKILL.md content (starting with \`---\`). No preamble, no surrounding code fence, no commentary.`;

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

  const result = streamText({
    model: anthropic("claude-sonnet-4-5"),
    system: SYSTEM_PROMPT,
    messages,
    maxOutputTokens: 2048,
  });

  return result.toTextStreamResponse();
}
