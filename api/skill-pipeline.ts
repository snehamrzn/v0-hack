import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { searchSkills, type SkillHit } from "./skill-registry";
import {
  SYSTEM_PROMPT,
  TEST_TRIGGER_SYSTEM,
} from "./skill-prompts";

export type ResearchSource = { n: number; url: string; title: string };
export type OptimizedDesc = { original: string; improved: string; changes: string };
export type TriggerTest = {
  request: string;
  should_fire: boolean;
  would_fire: boolean;
  reason: string;
};

export type SkillAnswers = {
  name?: string;
  purpose?: string;
  trigger?: string;
  steps?: string;
  gotchas?: string;
  example?: string;
};

const ANSWER_KEYS: Array<keyof SkillAnswers> = [
  "name",
  "purpose",
  "trigger",
  "steps",
  "gotchas",
  "example",
];

export function replaceDescriptionInSkill(skillMd: string, newDescription: string): string {
  if (!/^---\n[\s\S]*?\n---/.test(skillMd)) return skillMd;
  return skillMd.replace(/^(description:\s*).*$/m, (_m, prefix) => `${prefix}${newDescription}`);
}

export function parseResearchSources(researchNotes: string): ResearchSource[] {
  const sources: ResearchSource[] = [];
  const sourcesBlock = researchNotes.split(/^##\s+Sources\s*$/m)[1] || "";
  const re = /^\[(\d+)\]\s+(\S+)\s+—\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(sourcesBlock)) !== null) {
    sources.push({ n: Number(match[1]), url: match[2], title: match[3].trim() });
  }
  return sources;
}

function requireApiKey(): string {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set on the server");
  return apiKey;
}

function createModel() {
  const anthropic = createAnthropic({ apiKey: requireApiKey() });
  return {
    anthropic,
    model: anthropic("claude-sonnet-4-5"),
  };
}

function parseJsonObject<T>(text: string): T {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("no JSON in response");
  return JSON.parse(jsonMatch[0]) as T;
}

function registryHitsBlock(registryHits: SkillHit[]): string {
  if (registryHits.length === 0) return "";
  return registryHits
    .map((hit, index) =>
      `[${index + 1}] ${hit.url} — ${hit.name}${hit.description ? ` (${hit.description})` : ""}`
    )
    .join("\n");
}

function buildResearchMessage(
  params: Pick<SkillAnswers, "name" | "purpose" | "trigger">,
  registryHits: SkillHit[]
): string {
  const base = `Mode: RESEARCH_TOPIC

Research the user's skill domain on the web. Use the web_search tool 2–4 times with varied queries. Return the structured Findings / Pitfalls / Sources block — do NOT write the SKILL.md.

name: ${params.name || "(unnamed)"}
purpose: ${params.purpose || "(none)"}
trigger: ${params.trigger || "(none)"}`;

  const block = registryHitsBlock(registryHits);
  return block ? `${base}\n\nregistry_hits:\n${block}` : base;
}

function buildAnswersBlock(answers: SkillAnswers): string {
  return ANSWER_KEYS.map((key) => `${key}: ${answers[key] || "(skipped)"}`).join("\n");
}

function getDescriptionFromSkillMd(skillMd: string): string {
  return skillMd.match(/^description:\s*(.*)$/m)?.[1]?.trim() || "";
}

function getNameFromSkillMd(skillMd: string): string {
  return skillMd.match(/^name:\s*(.*)$/m)?.[1]?.trim() || "";
}

export async function polishSkillField(params: {
  field: "name" | "purpose" | "trigger" | "steps" | "gotchas" | "example";
  draft: string;
  priorAnswers?: Partial<SkillAnswers>;
}): Promise<string> {
  const { model } = createModel();
  const priorContext = ANSWER_KEYS.map((key) => `${key}: ${params.priorAnswers?.[key] || "(skipped)"}`).join("\n");
  const userMessage = `Mode: POLISH_FIELD

Field being polished: **${params.field}**

Prior answers from this interview:
${priorContext || "(none yet — this is the first field)"}

Their current draft for "${params.field}":
${params.draft}`;

  const { text } = await generateText({
    model,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
    maxOutputTokens: 1024,
  });
  return text.trim();
}

export async function researchSkill(
  params: Pick<SkillAnswers, "name" | "purpose" | "trigger">
): Promise<{ researchNotes: string; sources: ResearchSource[]; registryHits: SkillHit[] }> {
  const { anthropic, model } = createModel();
  const registryQuery = params.purpose || params.name || params.trigger || "";
  const registryHits = registryQuery ? await searchSkills(registryQuery, 5).catch(() => []) : [];
  const userMessage = buildResearchMessage(params, registryHits);
  const { text } = await generateText({
    model,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
    tools: {
      web_search: anthropic.tools.webSearch_20250305({ maxUses: 3 }),
    },
    maxOutputTokens: 2048,
    abortSignal: AbortSignal.timeout(45_000),
  });
  const researchNotes = text.trim();
  return {
    researchNotes,
    sources: parseResearchSources(researchNotes),
    registryHits,
  };
}

export async function synthesizeSkill(params: {
  answers: SkillAnswers;
  researchNotes?: string;
}): Promise<string> {
  const { model } = createModel();
  const userMessage = `Mode: SYNTHESIZE_SKILL_MD

Here are the user's interview answers. Produce the complete SKILL.md.

${buildAnswersBlock(params.answers)}

research_notes:
${params.researchNotes || "(unavailable)"}`;

  const { text } = await generateText({
    model,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
    maxOutputTokens: 2048,
  });
  return text.trim();
}

export async function optimizeSkillDescription(params: {
  skillMd: string;
  failedCases?: string[];
}): Promise<OptimizedDesc> {
  const { model } = createModel();
  const failures =
    params.failedCases && params.failedCases.length > 0
      ? `failed_cases:
${params.failedCases.map((failure) => `- "${failure}"`).join("\n")}

`
      : "";
  const userMessage = `Mode: OPTIMIZE_DESCRIPTION

${failures}Here is the freshly-synthesized SKILL.md. Rewrite its description: line per the rules and return JSON only.

${params.skillMd}`;
  const { text } = await generateText({
    model,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
    maxOutputTokens: 512,
  });
  return parseJsonObject<OptimizedDesc>(text.trim());
}

export async function testSkillTrigger(params: {
  skillMd?: string;
  name?: string;
  description?: string;
}): Promise<{ tests: TriggerTest[] }> {
  const { model } = createModel();
  const description =
    params.description ||
    (params.skillMd ? getDescriptionFromSkillMd(params.skillMd) : "") ||
    "(missing description)";
  const name =
    params.name ||
    (params.skillMd ? getNameFromSkillMd(params.skillMd) : "") ||
    "(unnamed)";
  const userMessage = `Mode: TEST_TRIGGER

Test this skill's trigger.

name: ${name}
description: ${description}

Generate 3 plausible user requests where this skill should fire and 1 adjacent request where it should not. For each, judge whether the description as written would lead you to pick this skill. Return JSON only.`;

  const { text } = await generateText({
    model,
    system: TEST_TRIGGER_SYSTEM,
    messages: [{ role: "user", content: userMessage }],
    maxOutputTokens: 1024,
  });
  return parseJsonObject<{ tests: TriggerTest[] }>(text.trim());
}

export async function runSkillPipeline(params: {
  answers: SkillAnswers;
}): Promise<{
  registryHits: SkillHit[];
  researchNotes: string;
  researchSources: ResearchSource[];
  researchError: string | null;
  skillMd: string;
  optimizedDescription: OptimizedDesc | null;
  optimizeError: string | null;
  triggerTests: TriggerTest[] | null;
  triggerTestError: string | null;
  finalSkillMd: string;
}> {
  let registryHits: SkillHit[] = [];
  let researchNotes = "";
  let researchSources: ResearchSource[] = [];
  let researchError: string | null = null;

  try {
    const research = await researchSkill(params.answers);
    registryHits = research.registryHits;
    researchNotes = research.researchNotes;
    researchSources = research.sources;
  } catch {
    researchError = "research skipped — synthesizing without it";
  }

  const skillMd = await synthesizeSkill({
    answers: params.answers,
    researchNotes,
  });

  let finalSkillMd = skillMd;
  let optimizedDescription: OptimizedDesc | null = null;
  let optimizeError: string | null = null;

  try {
    optimizedDescription = await optimizeSkillDescription({ skillMd });
    if (
      optimizedDescription.improved &&
      optimizedDescription.improved !== optimizedDescription.original
    ) {
      finalSkillMd = replaceDescriptionInSkill(skillMd, optimizedDescription.improved);
    }
  } catch {
    optimizeError = "couldn't sharpen trigger — keeping original";
  }

  let triggerTests: TriggerTest[] | null = null;
  let triggerTestError: string | null = null;
  try {
    const parsed = await testSkillTrigger({ skillMd: finalSkillMd });
    triggerTests = parsed.tests;
  } catch {
    triggerTestError = "trigger self-test unavailable";
  }

  return {
    registryHits,
    researchNotes,
    researchSources,
    researchError,
    skillMd,
    optimizedDescription,
    optimizeError,
    triggerTests,
    triggerTestError,
    finalSkillMd,
  };
}
