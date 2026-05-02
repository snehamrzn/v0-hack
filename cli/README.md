# skillsmith-install

One-line installer for skills authored in [Skillsmith](https://github.com/snehamrzn/v0-hack).

## Usage

Copy the **npx command** from the Skillsmith install panel and paste it into your terminal:

```
npx -y @snehamrzn/skillsmith-install@latest abc12def
```

That's it. The CLI fetches the skill by its short ID, computes the right install path for the chosen target, and writes the file.

### Where files land

| Target  | Scope    | Path                                                  |
|---------|----------|-------------------------------------------------------|
| Claude  | global   | `~/.claude/skills/<name>/SKILL.md`                    |
| Claude  | project  | `<cwd>/.claude/skills/<name>/SKILL.md`                |
| Cursor  | (project)| `<cwd>/.cursor/rules/<name>.mdc`                      |
| Generic | —        | `<cwd>/<name>.md`                                     |

### Flags

- `--force` — overwrite an existing file at the install path. Without it, the CLI refuses and exits non-zero.
- `--server=<url>` — fetch from a non-default Skillsmith deployment. Useful for self-hosted forks or local dev. Default: `https://v0-hack-phi-orcin.vercel.app`. Also reads `SKILLSMITH_SERVER` env var.
- `--help` — print usage.

## Why this exists

The Skillsmith web app generates a polished `SKILL.md` from a six-question interview. Browsers can't directly write to `~/.claude/skills/` — the OS picker forces users to navigate to a hidden home folder. This CLI bridges the gap with a single paste.

## How the ID works

When the user clicks "copy npx command" in the web app, the skill content is POSTed to `/api/share`, stored in Vercel KV, and a short ID is returned. The ID has a 90-day TTL — re-copy the command from Skillsmith to refresh it.

If the ID has expired or never existed, the CLI exits with `skill not found`.

## Implementation

~110 lines of Node ESM. No dependencies — just `fs`, `path`, `os`, and the global `fetch`. Source: [`bin/skillsmith.mjs`](./bin/skillsmith.mjs).

Requires Node 18+ (for `fetch`). Don't edit IDs by hand — re-author the skill in Skillsmith and copy a fresh command.

## License

MIT.
