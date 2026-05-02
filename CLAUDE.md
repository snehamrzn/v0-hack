# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this app is

Skillsmith — a Next.js 14 (App Router) web interview that produces a `SKILL.md` for an AI agent (Claude, Cursor, or generic). Six interview questions → optional find-or-build against the GitHub registry → four-stage Claude pipeline (research → synthesize → optimize description → trigger self-test) → save to disk via the File System Access API or a zip fallback. The same pipeline is also exposed as an MCP server and a sharable npx installer.

The codebase was migrated from Vite + `@vercel/node` serverless functions to Next.js + `@vercel/next` route handlers (May 2026) because the original setup was hitting platform-level lambda hangs that no application-side fix could clear. Same hosting, same env-var contract, same public surfaces.

## Commands

```bash
npm install
cp .env.example .env.local   # then fill in ANTHROPIC_API_KEY
npm run dev                   # Next.js dev server on :3000, /api/* routes mount automatically
npm run build                 # next build → .next/
npm run start                 # serves the built bundle (full /api/* working)
npm run lint                  # next lint
```

There is no test runner and no typecheck script. `tsconfig.json` has `noEmit: true` and is loose (`strict: false`); types are checked only opportunistically by the editor and during `next build`. The build is the only correctness gate — there is no CI lint/typecheck step beyond it.

The repo uses **npm**. If `pnpm-lock.yaml` appears, do NOT commit it — Vercel auto-detects the package manager from lockfile presence and having both confuses it.

## Environment variables

All read **server-side only** (in `app/api/*` route handlers, never on the client):

- `ANTHROPIC_API_KEY` — required for any LLM stage; without it `/api/chat` returns 500 and the UI falls back to a template-only synthesis path.
- `GITHUB_TOKEN` — optional. A token with **no scopes** is fine; only used to lift GitHub code-search rate limits in `lib/skill-registry.ts` (10/min unauthed → 30/min).
- `KV_REST_API_URL` + `KV_REST_API_TOKEN` **or** `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` — share storage (`lib/storage.ts`). Without either pair, share state lives in an in-memory `Map` that dies on cold start.
- `MCP_URL` — optional override for the MCP server URL; defaults to same-origin.

Next.js automatically loads `.env.local` (and `.env`) into `process.env` at dev startup; production reads `process.env` directly from Vercel.

## Architecture

```
app/
  layout.tsx              html/body shell, Google Fonts preconnect, globals.css import
  page.tsx                'use client' — renders <App /> and (dev only) <Agentation />
  globals.css
  api/
    chat/route.ts         /api/chat       — interview pipeline dispatch (LLM, streaming)
    share/route.ts        /api/share      — POST a SKILL record, get a short id
    skill/route.ts        /api/skill?id=  — load a shared SKILL record (CLI consumes)
    mcp/[transport]/route.ts  /api/mcp/{mcp,sse} — MCP server (createMcpHandler)
components/               React UI (was src/)
  App.tsx
  TweaksPanel.tsx
  save-handlers.ts
  skill-formats.ts
lib/                      Server-only shared modules (was api/, minus the route files)
  skill-pipeline.ts       Non-streaming helpers powering the MCP tools
  skill-prompts.ts        SYSTEM_PROMPT, TEST_TRIGGER_SYSTEM, extractBlockField
  skill-creator-prompt.ts ~34KB string export — the upstream skill-creator framing
  skill-creator-system.md Reference doc, not imported at runtime
  skill-registry.ts       GitHub code-search wrapper with 5-minute in-memory cache
  storage.ts              Upstash Redis (with mem-Map fallback)
cli/                      Independent npm package — see "CLI surface" below
public/                   Static assets (currently empty)
next.config.mjs
package.json
tsconfig.json
```

### Two surfaces, one pipeline

The skill pipeline has two consumers — the webpage and the MCP server — and they share code differently:

- **Webpage** (`components/App.tsx`) calls `/api/chat` with **mode markers** in the user message body (`POLISH_FIELD`, `SYNTHESIZE_SKILL_MD`, `RESEARCH_TOPIC`, `OPTIMIZE_DESCRIPTION`, `TEST_TRIGGER`, `SEARCH_REGISTRY`). The handler dispatches by mode, streaming responses back through the Vercel AI SDK.
- **MCP server** (`app/api/mcp/[transport]/route.ts`) registers one tool per pipeline stage (plus `run_skill_pipeline` for the full chain) and calls **non-streaming helpers** in `lib/skill-pipeline.ts`.

There is now **one source of truth** for `SYSTEM_PROMPT`, `TEST_TRIGGER_SYSTEM`, and `extractBlockField`: `lib/skill-prompts.ts`. Both the chat route handler and the MCP path import from there. (Pre-migration, `api/chat.ts` inlined a duplicate copy — the consolidation was part of the Next.js port.) The single source for the upstream skill-creator framing is `lib/skill-creator-prompt.ts` (a ~34KB string export — don't read it whole unless you need to).

### Stage flow in the UI

`components/App.tsx` is ~1800 lines and the pipeline lives as **five chained `useEffect` blocks**, each gated on the nullability of the previous stage's output:

1. Registry search (`SEARCH_REGISTRY` — bypasses the LLM, hits GitHub directly).
2. If the user picks a registry hit (`userChoice === "install"`), stages 3–5 are **skipped entirely** and the existing SKILL.md is fetched verbatim from `raw.githubusercontent.com`.
3. Research (`RESEARCH_TOPIC`) — gated on `userChoice === "write-fresh"`.
4. Synthesize (`SYNTHESIZE_SKILL_MD`) — gated on `researchNotes !== null` (sentinel string `RESEARCH_UNAVAILABLE` counts as "done, skip").
5. Optimize description (`OPTIMIZE_DESCRIPTION`) → trigger self-test (`TEST_TRIGGER`).

Each stage has a **ref-guard** (`researchFiredRef`, `synthFiredRef`, etc.) so React 18's strict-mode double-invoke can't double-fire the LLM. When the interview rewinds (user edits an earlier answer), a separate effect resets every stage's state and clears the refs. Failures degrade gracefully via per-mode sentinel strings (`RESEARCH_UNAVAILABLE`, `OPTIMIZE_UNAVAILABLE`, `TRIGGER_TEST_UNAVAILABLE`) rather than aborting the chain.

### Save targets and the share/install split

`components/skill-formats.ts` is the **single source of truth** for how a SKILL.md gets laid out on disk per target:

- `claude` global → `~/.claude/skills/<slug>/SKILL.md`
- `claude` project → `<root>/.claude/skills/<slug>/SKILL.md`
- `cursor` → `<root>/.cursor/rules/<slug>.mdc` (with cursor frontmatter — `globs:` empty, `alwaysApply: false`)
- `generic` → `<picked-folder>/<slug>.md`

`buildArtifacts(skillMd, slug, target, scope)` returns the `{path, content}` entries plus a friendly path hint. Two surfaces consume this:

- Browser save (`components/save-handlers.ts`): File System Access API (Chromium) or JSZip download (Safari/Firefox).
- Sharable installer: the user clicks "share", `components/skill-formats.ts#shareSkill` POSTs the **already-formatted artifact** (cursor users get `.mdc`-ified content stored, not raw SKILL.md) to `/api/share`, which writes a JSON record `{v: 1, target, scope, slug, content}` to Upstash with a 90-day TTL and returns a short id. The user copies `npx -y skillsmith-install@latest <id>` and runs it; `cli/bin/skillsmith.mjs` fetches via `/api/skill?id=…` and writes to disk.

**Path computation in `cli/bin/skillsmith.mjs` mirrors `buildArtifacts` in `components/skill-formats.ts`.** They share a record format but no code. If you change one, change the other (the CLI shipping comment calls this out explicitly).

### CLI surface — public contracts

The `cli/` directory ships an **unrelated npm package** (`skillsmith-install`) and is not built or run by `npm run dev`/`npm run build`. The CLI fetches skill records over HTTP, so the following endpoints are **public contracts** that must not change shape:

1. **`POST /api/chat`** — accepts `{messages: [{role, content}]}` with mode markers (`POLISH_FIELD`, `SYNTHESIZE_SKILL_MD`, `RESEARCH_TOPIC`, `OPTIMIZE_DESCRIPTION`, `TEST_TRIGGER`, `SEARCH_REGISTRY`). Streams responses for non-search modes; returns plain JSON (`{"hits": [...]}`) for `SEARCH_REGISTRY`.
2. **`POST /api/share`** — accepts `{content: string}` (a JSON-stringified skill record), returns `{id: string}`.
3. **`GET /api/skill?id=<id>`** — returns the raw stored content (a JSON string, no envelope). **The CLI ships independently and pinning to a stable URL/format is critical** — same path, same query param, same response body shape.
4. **`/api/mcp/mcp` and `/api/mcp/sse`** — MCP transport endpoints registered by `createMcpHandler` with `basePath: "/api/mcp"`. External MCP clients connect here. The list of registered tools and their schemas must be byte-identical (`search_skills`, `polish_skill_field`, `research_skill`, `synthesize_skill`, `optimize_skill_description`, `test_skill_trigger`, `run_skill_pipeline`).

There is also a **pre-existing CLI URL mismatch** flagged in the migration plan: `cli/bin/skillsmith.mjs#DEFAULT_SERVER` and `components/skill-formats.ts#PROD_SERVER` both point at `https://skillsmith.vercel.app`, but that alias is not currently attached to this Vercel project. The hosted webpage works fine; `npx -y skillsmith-install <id>` will fetch from the wrong server until either the alias is claimed or both constants are pointed at the live alias and `skillsmith-install` is republished. Don't fix this without the user's say-so — it's a release decision, not a code one.

### Function configuration

Per-route timeouts are set via `export const maxDuration = <seconds>` at the top of each `app/api/<route>/route.ts`. The chat and MCP handlers run up to **60s** (research stage uses 2–4 web searches and can take 30s+); `share` and `skill` are 30s. There is no `vercel.json` — Next.js feeds these values straight to Vercel's build pipeline.

Each route also exports `export const runtime = "nodejs"` (not edge — we need full Node API surface for `@upstash/redis`, `@anthropic-ai/sdk` v3, and the Anthropic web-search tool).

### Dev server

`npm run dev` starts Next.js on `http://localhost:3000`. `app/api/*` routes work locally without any extra middleware (Next does the request/response adapter natively). `npm run start` after `next build` does the same for the production bundle. `vercel dev` also works but isn't needed for local testing the way it was for the Vite dev middleware.

## Editor mode pseudo-syntax

`components/App.tsx` contains an `/*EDITMODE-BEGIN*/{...}/*EDITMODE-END*/` block (`TWEAKS`) read by the in-app `TweaksPanel`. It is real code at runtime; the comment markers exist so an external editor (the v0-hack origin tool) can patch the literal without parsing TypeScript. **Don't strip the markers when reformatting.**

## Known gotchas

- **`'use client'` boundary**: `components/App.tsx` uses `useState`, `useEffect`, `useRef`, the File System Access API, and JSZip. The boundary is set in `app/page.tsx` (the page is `'use client'`); the descendant components inherit it. Don't put `'use client'` in `app/layout.tsx` — it'd defeat Next.js server rendering for the shell.
- **Dev-only `<Agentation />` overlay**: `app/page.tsx` mounts the v0-hack origin tool's overlay only when `process.env.NODE_ENV === "development"`. Next.js statically replaces the value at build time, so the production bundle excludes it. Don't drop the guard.
- **`mcp-handler` basePath**: keep `basePath: "/api/mcp"` — the handler uses this to compute the SSE/MCP path. External clients depend on it.
- **`@upstash/redis` `retry: false`**: keep the `retry: false` option in `lib/storage.ts#getRedisClient`. Default 5-retry behavior was responsible for ~25s hangs on bad endpoints during the pre-migration era — the issue isn't Next.js-specific, just keep the option.
- **Dynamic segment as a directory**: the MCP route lives at `app/api/mcp/[transport]/route.ts` (the `[transport]` segment is a *directory* containing `route.ts`). It is NOT a file named `[transport].ts`.
- **No tests, no linter beyond `next lint`**: don't waste time setting up Jest/Vitest/ESLint configs unless asked. `next build` is the load-bearing correctness gate.

## Migration history (for context)

The previous version of this repo used Vite + per-file Vercel serverless functions in `api/*.ts`. Three patterns from that era are still worth knowing about (so you don't repeat the workarounds):

1. **Old `.js` extensions on imports** (`from "./skill-prompts.js"`): a workaround for `@vercel/node`'s ESM bundler. The Next.js build uses esbuild which rewrites extensions natively, so all intra-`lib/` relative imports now omit the `.js`. Don't add it back.
2. **Old `vite.config.ts` dev middleware**: adapted Node `IncomingMessage`/`ServerResponse` to Web `Request`/`Response` for the Vite dev server. Deleted — Next.js handles routing natively.
3. **Old `api/test.ts` diagnostic**: a 5-line handler used to prove the pre-migration runtime was hanging at lambda startup. Removed during the port; if you ever need to reproduce, write a new one in `app/api/test/route.ts`.
