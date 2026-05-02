# Skillsmith

Skillsmith interviews you gives you back a finished `SKILL.md` for your AI agent. Built for the Vercel hackathon, Track 2 (v0 + MCPs). The same pipeline ships two ways: as a Next.js webpage you click through, and as an MCP server other agents can call.

Live: https://v0-hack-phi-orcin.vercel.app

## What's a skill?

If you use Claude, Cursor, or another AI agent, you've probably wanted to teach it a specific habit. "When I paste meeting notes, write the standup post in our team's voice." "When I say 'rescue this recipe,' swap in the ingredients I actually have."

Agents already support this. The format is a `SKILL.md` file with a few sections: a name, a description telling the agent when to fire, the steps to follow, the stuff to avoid. Drop the file in the right folder and the agent picks it up automatically.

Writing a good one is the part nobody enjoys. The description has to be specific enough that the agent triggers on the right requests, but not so broad that it fires on everything. The steps need to be concrete. The "gotchas" section is where most of the real value lives, and it's the section people skip first.

Skillsmith is the six-question conversation that gets you to a finished file. Polish each answer if you want, then Claude does the heavy lifting.

## Try it

What happens when you click start:

1. Walk through six questions: name, purpose, trigger, steps, gotchas, example.
2. Skillsmith searches GitHub for a public `SKILL.md` that already covers your topic. If one fits, install it in one click and skip everything else.
3. If you're writing fresh, the four-stage pipeline runs in the right panel: research, synthesize, sharpen the description, stress-test the trigger.
4. When the preview looks right, save to disk, grab a zip, or copy a one-line `npx` command you can send to someone else.

No account. No login. No quotas you can hit.

## MCP server

Skillsmith ships its own MCP server next to the webpage, so the exact same pipeline is reachable two ways:

1. Through the website, by a person clicking through the interview.
2. Through MCP, by an AI agent calling `https://v0-hack-phi-orcin.vercel.app/api/mcp/mcp` directly.

Seven tools are exposed:

- `search_skills` — find existing public `SKILL.md` files on GitHub.
- `polish_skill_field` — rewrite a single interview answer in Skillsmith's voice.
- `research_skill` — run the research stage and return findings, pitfalls, and sources.
- `synthesize_skill` — turn interview answers into a complete `SKILL.md`.
- `optimize_skill_description` — sharpen the description so the agent fires on the right asks.
- `test_skill_trigger` — generate fake user requests and check whether the description would catch them.
- `run_skill_pipeline` — run research, synthesize, optimize, and test in one shot.

So a Claude agent can ask Skillsmith to author a skill for itself, no person involved. The webpage and the MCP server share the same prompt files (`lib/skill-prompts.ts`, `lib/skill-creator-prompt.ts`), the same model (`claude-sonnet-4-5`), and the same registry — webpage and agent get byte-identical output.

## Connect Skillsmith to your agent

The whole point of shipping the pipeline as an MCP server is that your agent can author skills *for itself*, with no clicking through the webpage. The live site has a guided picker at [the connect section](https://v0-hack-phi-orcin.vercel.app/#connect) that copies the right snippet for whichever tool you use. The same instructions, in case you'd rather paste from here:

The endpoint is the same for everyone:

```
https://v0-hack-phi-orcin.vercel.app/api/mcp/mcp
```

### Claude Desktop

Open Settings → Developer → Edit Config and paste this inside the file:

```json
{
  "mcpServers": {
    "skillsmith": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://v0-hack-phi-orcin.vercel.app/api/mcp/mcp"]
    }
  }
}
```

Save, fully quit Claude Desktop (not just close the window), then reopen it. Ask Claude to "make a SKILL.md for X" and it'll reach for Skillsmith on its own.

### Claude Code

One command in any shell:

```bash
claude mcp add --transport http skillsmith https://v0-hack-phi-orcin.vercel.app/api/mcp/mcp
```

Start a session, type `/mcp` to confirm Skillsmith is listed, then ask it to author a skill for you.

### Cursor

Save this as `~/.cursor/mcp.json` for global use, or `<project>/.cursor/mcp.json` for one repo only:

```json
{
  "mcpServers": {
    "skillsmith": {
      "url": "https://v0-hack-phi-orcin.vercel.app/api/mcp/mcp"
    }
  }
}
```

Reload the Cursor window (Cmd/Ctrl+Shift+P → Reload Window) and Skillsmith's tools become callable from chat.

### VS Code (with Copilot Chat)

Save as `.vscode/mcp.json` in your workspace, or in your user-level `mcp.json`:

```json
{
  "servers": {
    "skillsmith": {
      "type": "http",
      "url": "https://v0-hack-phi-orcin.vercel.app/api/mcp/mcp"
    }
  }
}
```

Open the Copilot Chat panel, switch to Agent mode, and Skillsmith shows up in the tool picker.

### ChatGPT

Plus, Team, and Enterprise plans only. In Settings → Connectors, add a custom connector, choose MCP, and paste the URL into the server-URL field. Save, then enable it inside any chat from the tools menu.

### Other clients

Skillsmith speaks streamable HTTP MCP, so any compatible client works. If yours is stdio-only, wrap the URL with `mcp-remote`:

```bash
npx -y mcp-remote https://v0-hack-phi-orcin.vercel.app/api/mcp/mcp
```

## Sharing the result

When your skill looks right, you can copy a one-line install command:

```
npx -y @snehamrzzn/skillsmith-install@latest <id>
```

The `<id>` is a short code Skillsmith gives you. Send it to a friend. They paste, the file lands in the right spot on their machine, they're done. The id is good for 90 days.

## Where the file goes

Four target shapes, picked from a dropdown before you save:

- Claude global → `~/.claude/skills/<name>/SKILL.md` (loaded for every Claude chat).
- Claude project → `<project-root>/.claude/skills/<name>/SKILL.md` (only loaded in that project).
- Cursor → `.cursor/rules/<name>.mdc` (with the cursor frontmatter shape).
- Generic → a plain `.md` file you can put wherever.

Chrome and Edge can write the file straight to a folder you pick. Safari and Firefox don't support that browser API yet, so they fall back to a zip download.

## Running it locally

```bash
npm install
cp .env.example .env.local
# add ANTHROPIC_API_KEY (required for the LLM stages)
# optional: GITHUB_TOKEN for higher rate limits on the registry search
npm run dev
```

Then open http://localhost:3000.

If `ANTHROPIC_API_KEY` isn't set, the interview still works. You just get a mechanically-built `SKILL.md` from your raw answers; the model stages skip themselves.

## Stack

- Next.js 14 (App Router). Migrated from Vite mid-hackathon when serverless cold-start hangs were burning the chat route.
- Vercel AI SDK with the Anthropic provider, for streaming Claude responses.
- `mcp-handler` and `zod` for the MCP server.
- Upstash Redis for the 90-day share-link storage (in-memory fallback in dev).
- JSZip for the Safari/Firefox download fallback.

```
app/
  page.tsx                      interview UI shell
  api/
    chat/route.ts               LLM dispatch; pipeline stages stream from here
    share/route.ts              POST a skill, get a short id back
    skill/route.ts              GET a shared skill by id (the npx CLI calls this)
    mcp/[transport]/route.ts    the MCP server
components/
  App.tsx                       interview UI, preview, save flow
  skill-formats.ts              one SKILL.md → per-target files
  save-handlers.ts              File System Access API and the zip fallback
lib/
  skill-pipeline.ts             non-streaming versions of each stage (used by the MCP)
  skill-prompts.ts              system prompts shared by chat and MCP
  skill-registry.ts             GitHub search wrapper, 5-min cache
  storage.ts                    Redis-backed share store, in-memory fallback
cli/
  bin/skillsmith.mjs            the published npx installer
```

The pipeline lives in `App.tsx` as five chained `useEffect` blocks, each gated on the previous stage's output. The MCP path skips the React state machine entirely and calls `lib/skill-pipeline.ts` directly, so external agents get the same behavior without paying for the streaming UX.

## Credits

Built for the Vercel Agents hackathon. The four-stage pipeline pattern is borrowed from Anthropic's own skill-creator framework. The `cli/` package was the very last piece to ship; it sat as committed-but-unpublished source for two days before going live as `@snehamrzzn/skillsmith-install`.
