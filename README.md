# Skillsmith

A web interview that writes a `SKILL.md` for your AI agent so you don't have to stare at a blank file.

## What this is

Agents work better when you hand them a short instruction card that tells them what the task is, when to reach for it, and what to avoid. That card is a skill. Anthropic's format wants a `SKILL.md` with YAML frontmatter and a couple of sections; Cursor wants the same shape under a different extension.

Skillsmith asks you six questions, runs your answers through Claude, and hands you back the finished file. You can save it directly into `~/.claude/skills/`, drop it into a project, or download a zip.

## The interview

Six prompts, in order:

1. `name` — short, memorable, hyphenated
2. `purpose` — one sentence on what the skill does
3. `trigger` — when the agent should reach for it (specific phrases help)
4. `steps` — what the agent should actually do
5. `gotchas` — what it tends to get wrong (optional, but usually the most useful field)
6. `example` — input then output, if you have one (optional)

Each field has a "polish with skillsmith" button that rewrites your draft in the right voice for that field. The polish stays on-topic — it won't invent details you didn't supply.

## What happens after the last question

First, a find-or-build check. Skillsmith searches public `SKILL.md` files on GitHub for prior art. If a public skill already covers your topic, you can install it in one click instead of authoring a new one — the file is fetched from GitHub raw and dropped into the standard save flow. If nothing matches (or you click "write fresh"), the four-stage pipeline kicks in:

1. Research. Skillsmith pulls related prior-art skills, then Claude runs 2 to 4 web searches on the skill's domain so the synthesis can ground itself in real practice instead of guessing. Sources show up in the right-hand panel.
2. Synthesize. Your answers plus the research notes go in, a complete `SKILL.md` comes out and streams into the preview.
3. Sharpen the description. The frontmatter `description:` line gets rewritten to be more aggressive about triggering. Agents under-trigger on vague descriptions, so this stage names concrete phrases the user might say.
4. Stress-test the trigger. Claude generates fake user requests and checks whether the description would fire on the right ones and stay quiet on the rest. If something fails, you can rerun stage 3 with the failures fed back in.

If `ANTHROPIC_API_KEY` isn't set, you still get a template-built `SKILL.md` from your raw answers. The model stages just skip.

## Saving

Three targets:

- claude: `~/.claude/skills/<name>/SKILL.md` for global, or `<project>/.claude/skills/<name>/SKILL.md` for project scope
- cursor: `.cursor/rules/<name>.mdc` with the cursor frontmatter shape
- generic: a plain `SKILL.md` in a folder of your choice

If your browser supports the File System Access API (Chrome, Edge, the Chromium ones), the file writes straight to disk after you pick a folder. Safari and Firefox fall back to a zip download.

## Setup

```bash
npm install
cp .env.example .env.local
# put your ANTHROPIC_API_KEY in .env.local
# (optional) GITHUB_TOKEN for higher rate limits on the registry MCP
npm run dev
```

Both keys are read server-side. They never reach the browser.

## Stack

- React 18 and Vite
- Vercel AI SDK with the Anthropic provider
- `mcp-handler` + `zod` for the in-repo Skillsmith MCP server
- JSZip for the fallback download

## Layout

```
api/chat.ts                   serverless endpoint, wires the system prompt to streamText
api/skill-creator-prompt.ts   the prompt itself, with mode markers
api/mcp/[transport].ts        Skillsmith MCP server — exposes search plus the full skill pipeline
api/skill-pipeline.ts         shared prompts + non-UI pipeline helpers for chat and MCP
src/App.tsx                   UI + find-or-build + the four-stage pipeline
src/skill-formats.ts          turns one SKILL.md into per-target files
src/save-handlers.ts          File System Access API and the zip fallback
src/skill-creator-system.md   reference copy of the prompt
```

The pipeline lives in `App.tsx` as five `useEffect` blocks chained on state nullability. Stage 0 (registry search) gates everything below it on `userChoice`; the install path skips stages 1–4 entirely. Each one has a ref guard so React strict-mode double-invokes can't double-fire.

## The MCP server

`api/mcp/[transport].ts` is a standalone MCP server other agents can install. Connect any MCP-capable client to `https://<your-deployment>/api/mcp/mcp` (HTTP transport) and you'll get the same major stages the webpage uses:

- `search_skills` — find existing public `SKILL.md` files on GitHub
- `polish_skill_field` — rewrite one interview field in Skillsmith's house style
- `research_skill` — run the research stage and return findings/pitfalls/sources
- `synthesize_skill` — turn interview answers into a complete `SKILL.md`
- `optimize_skill_description` — sharpen the frontmatter `description:` line
- `test_skill_trigger` — generate positive/negative trigger tests
- `run_skill_pipeline` — run research → synthesize → optimize → test end to end

The webpage still uses `src/App.tsx` + `/api/chat` for its own streaming UX, but the MCP surface now mirrors that pipeline for external clients.
