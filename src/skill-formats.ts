// Adapt a synthesized SKILL.md into the on-disk layout for a chosen target/scope.
// Pure functions — no DOM, no FS — so they're trivial to test.

export type Target = "claude" | "cursor" | "generic";
export type Scope = "global" | "project";

export type Entry = { path: string; content: string };

export type Artifacts = {
  entries: Entry[];
  // A friendly path string we can show the user before they pick a folder
  // (e.g. "<picked-folder>/recipe-rescuer/SKILL.md").
  pathHint: string;
  // ZIP filename when the user falls back to "Download .zip".
  zipName: string;
};

type Frontmatter = { description: string; rest: Record<string, string> };

function parseFrontmatter(md: string): { fm: Frontmatter | null; body: string } {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { fm: null, body: md };
  const block = m[1];
  const body = m[2];
  const rest: Record<string, string> = {};
  let description = "";
  for (const line of block.split("\n")) {
    const kv = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/);
    if (!kv) continue;
    const [, key, val] = kv;
    if (key === "description") description = val;
    else rest[key] = val;
  }
  return { fm: { description, rest }, body };
}

// Splice a new value into the YAML frontmatter `description:` line, leaving
// everything else untouched. If the file has no frontmatter (shouldn't happen
// for a synthesized SKILL.md) it returns the input unchanged.
export function replaceDescription(skillMd: string, newDescription: string): string {
  if (!/^---\n[\s\S]*?\n---/.test(skillMd)) return skillMd;
  return skillMd.replace(/^(description:\s*).*$/m, (_m, prefix) => `${prefix}${newDescription}`);
}

// Cursor .mdc frontmatter: description / globs / alwaysApply.
// We map Claude's `description` straight across; leave globs empty so the rule
// activates intelligently (description-matched), and default alwaysApply to false.
function toCursorMdc(skillMd: string, slug: string): string {
  const { fm, body } = parseFrontmatter(skillMd);
  const description = fm?.description?.trim() || `Rules for ${slug}.`;
  return `---
description: ${description}
globs:
alwaysApply: false
---
${body.startsWith("\n") ? "" : "\n"}${body}`;
}

export function buildArtifacts(
  skillMd: string,
  slug: string,
  target: Target,
  scope: Scope,
): Artifacts {
  if (target === "claude") {
    // Always nest under .claude/skills/<slug>/ so the user can pick their home
    // folder (global) or project root (project) and the layout is correct.
    const path = `.claude/skills/${slug}/SKILL.md`;
    return {
      entries: [{ path, content: skillMd }],
      pathHint: `<picked-folder>/${path}`,
      zipName: `${slug}-claude-${scope}.zip`,
    };
  }

  if (target === "cursor") {
    const mdc = toCursorMdc(skillMd, slug);
    const path = `.cursor/rules/${slug}.mdc`;
    return {
      entries: [{ path, content: mdc }],
      pathHint: `<picked-folder>/${path}`,
      zipName: `${slug}-cursor.zip`,
    };
  }

  // generic
  return {
    entries: [{ path: `${slug}.md`, content: skillMd }],
    pathHint: `<picked-folder>/${slug}.md`,
    zipName: `${slug}.zip`,
  };
}

// Hint shown above the action row before the user clicks save.
export function describeTarget(target: Target, scope: Scope): string {
  if (target === "claude" && scope === "global")
    return "Pick your home folder (~) — we'll create .claude/skills/<name>/.";
  if (target === "claude" && scope === "project")
    return "Pick your project root — we'll create .claude/skills/<name>/.";
  if (target === "cursor")
    return "Pick your project root — we'll create .cursor/rules/<name>.mdc.";
  return "Pick any folder — we'll drop a single .md file there.";
}

// Agent-specific reload step shown after a successful save.
export function reloadHint(target: Target): string {
  if (target === "claude")
    return "Start a new chat — Claude picks up new skills automatically.";
  if (target === "cursor")
    return "Reload the Cursor window (Cmd+Shift+P → Reload Window) so the new rule registers.";
  return "You're set — drop this wherever your agent expects it.";
}
