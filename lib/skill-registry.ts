export type SkillHit = {
  name: string;
  repo: string;
  url: string;
  description: string;
};

type GitHubItem = {
  name: string;
  path: string;
  html_url: string;
  repository: {
    full_name: string;
    description: string | null;
    html_url: string;
  };
};

// 5-minute in-memory cache to soften GitHub's rate limit (10/min unauthed,
// 30/min with a token). Keyed by the exact query+limit tuple. The serverless
// function instance pools across invocations within a warm window.
const cache = new Map<string, { hits: SkillHit[]; expires: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function searchSkills(query: string, limit: number): Promise<SkillHit[]> {
  const cacheKey = `${query}::${limit}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.hits;

  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "skillsmith-mcp",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;

  // Search the entire public corpus for SKILL.md files matching the query.
  // Over-fetch (limit * 3) so we can dedupe by repo and still return `limit`.
  const q = encodeURIComponent(`filename:SKILL.md ${query}`);
  const perPage = Math.min(limit * 3, 30);
  const url = `https://api.github.com/search/code?q=${q}&per_page=${perPage}`;

  let res: Response;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  } catch (e: any) {
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      throw new Error("github search timed out after 8s");
    }
    throw new Error(`github search fetch failed: ${e?.message || e}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`github search ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as { items?: GitHubItem[] };

  // Dedupe by repo — a single repo can contain multiple SKILL.md files
  // (e.g. anthropics/skills) but for find-or-build we want one row per project.
  const seen = new Set<string>();
  const hits: SkillHit[] = [];
  for (const item of data.items ?? []) {
    if (seen.has(item.repository.full_name)) continue;
    seen.add(item.repository.full_name);
    const skillName =
      item.path.replace(/\/SKILL\.md$/, "").split("/").pop() ||
      item.repository.full_name.split("/").pop() ||
      item.repository.full_name;
    hits.push({
      name: skillName,
      repo: item.repository.full_name,
      url: item.html_url,
      description: item.repository.description ?? "",
    });
    if (hits.length >= limit) break;
  }

  cache.set(cacheKey, { hits, expires: Date.now() + CACHE_TTL_MS });
  return hits;
}
