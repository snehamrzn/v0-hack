import React, { useState, useEffect, useRef, useMemo } from "react";
import { useTweaks } from "./TweaksPanel";
import {
  buildArtifacts,
  buildNpxCommand,
  describeTarget,
  reloadHint,
  replaceDescription,
  shareSkill,
  terminalHint,
  type Target,
  type Scope,
} from "./skill-formats";
import {
  canSaveToFolder,
  saveAsZip,
  saveToDirectory,
  type SaveResult,
} from "./save-handlers";

// ----- Tweakable defaults -----
const TWEAKS = /*EDITMODE-BEGIN*/{
  "accent": "#8B85E0",
  "paper": "#F4EFE6",
  "ink": "#1B1A17",
  "showSketch": true
}/*EDITMODE-END*/;

// ----- Initial conversation script (the "interview") -----
const INTERVIEW = [
  {
    key: "name",
    prompt: "First - what should we call this skill? A short, memorable name works best.",
    placeholder: "e.g. Recipe Rescuer, Standup Notes, Brand Voice…",
    hint: "Lowercase, hyphens are fine. Think of it like a slash-command.",
  },
  {
    key: "purpose",
    prompt: "In one sentence, what does this skill do?",
    placeholder: "e.g. Turns rough meeting notes into a clean weekly standup post.",
    hint: "Plain language. We'll polish it together.",
  },
  {
    key: "trigger",
    prompt: "When should the agent reach for this skill? Give a couple of example moments.",
    placeholder: "e.g. when I paste meeting notes, when I say 'write the standup'…",
    hint: "Specific phrases and contexts help the agent know when to use it.",
  },
  {
    key: "steps",
    prompt: "Walk me through what the agent should actually do, step by step.",
    placeholder: "1. Read the notes\n2. Group by project\n3. Draft 3–5 bullets in our team voice…",
    hint: "Imperative voice. One step per line.",
    multiline: true,
  },
  {
    key: "gotchas",
    prompt: "Anything the agent tends to get wrong here? Quirks, gotchas, things to avoid?",
    placeholder: "e.g. don't invent attendees, never use the word 'synergy'…",
    hint: "This is the most valuable section. Be specific.",
    multiline: true,
    optional: true,
  },
  {
    key: "example",
    prompt: "Lastly - an example of input → output, if you have one. (Optional.)",
    placeholder: "Input: 'eng sync, sam shipped login, rae blocked on api'…\nOutput: 'This week the team…'",
    hint: "Even one rough example dramatically improves the skill.",
    multiline: true,
    optional: true,
  },
];

// ----- Hand-drawn SVG decorations -----
const Squiggle = ({ className, color }: any) => (
  <svg className={className} viewBox="0 0 200 24" fill="none" preserveAspectRatio="none">
    <path d="M2 14 C 20 4, 40 22, 60 12 S 100 4, 120 14 S 160 22, 180 10 L 198 12"
      stroke={color || "currentColor"} strokeWidth="2.2" strokeLinecap="round" fill="none"/>
  </svg>
);

const Star = ({ size = 28, color, className }: any) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none" className={className}>
    <path d="M20 3 L20 37 M3 20 L37 20 M8 8 L32 32 M32 8 L8 32"
      stroke={color || "currentColor"} strokeWidth="2.5" strokeLinecap="round"/>
  </svg>
);

const Arrow = ({ className, color }: any) => (
  <svg className={className} viewBox="0 0 80 60" fill="none">
    <path d="M5 30 C 25 10, 50 50, 72 25" stroke={color || "currentColor"} strokeWidth="2.2" strokeLinecap="round" fill="none"/>
    <path d="M65 18 L 73 25 L 64 32" stroke={color || "currentColor"} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
  </svg>
);

const Underline = ({ className, color }: any) => (
  <svg className={className} viewBox="0 0 200 12" fill="none" preserveAspectRatio="none">
    <path d="M3 8 C 50 2, 100 11, 197 5" stroke={color || "currentColor"} strokeWidth="3" strokeLinecap="round" fill="none"/>
  </svg>
);

const Circle = ({ size = 80, color }: any) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none">
    <path d="M50 8 C 75 8, 92 28, 92 52 C 92 78, 70 92, 48 92 C 22 92, 8 70, 10 48 C 12 22, 28 8, 50 8 Z"
      stroke={color || "currentColor"} strokeWidth="2.2" fill="none"/>
  </svg>
);

// ----- Format SKILL.md from gathered answers -----
function buildSkillMd(answers) {
  const slug = (answers.name || "my-skill").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "my-skill";
  const purpose = (answers.purpose || "").trim();
  const trigger = (answers.trigger || "").trim();
  const steps = (answers.steps || "").trim();
  const gotchas = (answers.gotchas || "").trim();
  const example = (answers.example || "").trim();

  const description = purpose
    ? `${purpose}${trigger ? ` Use this skill when ${trigger.replace(/\.$/, "")}.` : ""} Always use this skill for related tasks.`
    : "What this skill does and when to use it.";

  let body = `# ${answers.name || "My Skill"}\n\n## Overview\n${purpose || "_Describe what this skill does._"}\n`;

  if (steps) {
    body += `\n## Instructions\nWhen this skill is active, follow these steps:\n\n${
      steps.split(/\n+/).map((l, i) => {
        const cleaned = l.replace(/^\s*[-*\d.]+\s*/, "").trim();
        return cleaned ? `${i + 1}. ${cleaned}` : "";
      }).filter(Boolean).join("\n")
    }\n`;
  }

  if (gotchas) {
    body += `\n## Gotchas\n${
      gotchas.split(/\n+/).map(l => {
        const cleaned = l.replace(/^\s*[-*]+\s*/, "").trim();
        return cleaned ? `- ${cleaned}` : "";
      }).filter(Boolean).join("\n")
    }\n`;
  }

  if (example) {
    body += `\n## Example\n\`\`\`\n${example}\n\`\`\`\n`;
  }

  return `---\nname: ${slug}\ndescription: ${description}\n---\n\n${body}`;
}

// ----- The app -----
export default function App() {
  const [tweaks, setTweak] = useTweaks(TWEAKS);
  const [step, setStep] = useState(0);
  const [started, setStarted] = useState(false);
  const [answers, setAnswers] = useState<any>({});
  const [draft, setDraft] = useState("");
  const [enhancing, setEnhancing] = useState(false);
  const [enhanceMsg, setEnhanceMsg] = useState("");
  const inputRef = useRef<any>(null);
  const previewRef = useRef<any>(null);

  const current = INTERVIEW[step];
  const isDone = started && step >= INTERVIEW.length;

  // Live preview during the interview = mechanical template.
  // Once the interview ends, we replace it with a model-synthesized SKILL.md.
  const templateMd = useMemo(() => buildSkillMd(answers), [answers]);
  const [synthesizedMd, setSynthesizedMd] = useState<string | null>(null);
  const [synthesizing, setSynthesizing] = useState(false);
  const [synthError, setSynthError] = useState<string | null>(null);
  const synthFiredRef = useRef(false);
  const skillMd = synthesizedMd ?? templateMd;

  // Stage 1 — web research before synthesis.
  type ResearchSource = { n: number; url: string; title: string };
  const [researchNotes, setResearchNotes] = useState<string | null>(null);
  const [researching, setResearching] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [researchSources, setResearchSources] = useState<ResearchSource[]>([]);
  const researchFiredRef = useRef(false);

  // Stage 3 — sharpen the description after synthesis.
  type OptimizedDesc = { original: string; improved: string; changes: string };
  const [optimizedDescription, setOptimizedDescription] = useState<OptimizedDesc | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeError, setOptimizeError] = useState<string | null>(null);
  const optimizeFiredRef = useRef(false);

  // Stage 4 — self-test the trigger.
  type TriggerTest = { request: string; should_fire: boolean; would_fire: boolean; reason: string };
  const [triggerTests, setTriggerTests] = useState<TriggerTest[] | null>(null);
  const [testingTrigger, setTestingTrigger] = useState(false);
  const [triggerTestError, setTriggerTestError] = useState<string | null>(null);
  const triggerFiredRef = useRef(false);

  // Stage 0 — find-or-build. Before research fires, query the Skill Registry MCP
  // for prior-art SKILL.md files. If hits, user picks one to install OR opts to
  // write fresh; if no hits, we auto-advance to the existing pipeline.
  type SkillHit = { name: string; repo: string; url: string; description: string };
  const [registryHits, setRegistryHits] = useState<SkillHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [userChoice, setUserChoice] = useState<"install" | "write-fresh" | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const searchFiredRef = useRef(false);

  const pipelineActive = searching || installing || researching || synthesizing || optimizing || testingTrigger;

  useEffect(() => {
    if (started && inputRef.current) {
      inputRef.current.focus();
    }
  }, [step, started]);

  useEffect(() => {
    if (previewRef.current) previewRef.current.scrollTop = 0;
  }, [step]);

  // ---------------- Pipeline: research → synthesize → sharpen → stress-test
  //
  // Each stage is an independent useEffect with a ref-guard so React 18
  // strict-mode double-invoke can't double-fire mid-stream. Stages chain via
  // state nullability — e.g. synthesis only fires once `researchNotes` is set
  // (success OR graceful skip). On `!isDone` we reset every stage's state so
  // a fresh interview starts clean.

  // Reset all stages when the interview rewinds.
  useEffect(() => {
    if (isDone) return;
    searchFiredRef.current = false;
    researchFiredRef.current = false;
    synthFiredRef.current = false;
    optimizeFiredRef.current = false;
    triggerFiredRef.current = false;
    setRegistryHits(null);
    setSearchError(null);
    setUserChoice(null);
    setInstallError(null);
    setResearchNotes(null);
    setResearchSources([]);
    setResearchError(null);
    setSynthesizedMd(null);
    setSynthError(null);
    setOptimizedDescription(null);
    setOptimizeError(null);
    setTriggerTests(null);
    setTriggerTestError(null);
  }, [isDone]);

  // Stage 0 — query the Skill Registry MCP for existing prior-art skills.
  // Fires immediately when the interview ends. If no hits, auto-advances to
  // write-fresh so the existing pipeline kicks in without a UI interruption.
  useEffect(() => {
    if (!isDone || searchFiredRef.current) return;
    searchFiredRef.current = true;

    (async () => {
      setSearching(true);
      setSearchError(null);
      try {
        const query = `${answers.purpose || ""} ${answers.name || ""}`.trim() || answers.name || "";
        if (!query) {
          setRegistryHits([]);
          setUserChoice("write-fresh");
          return;
        }

        const userMessage = `Mode: SEARCH_REGISTRY\n\nquery: ${query}`;
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: userMessage }],
          }),
        });

        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
        }
        acc += decoder.decode();

        // Pull the JSON object out — the model may include surrounding text
        // depending on how strictly it follows the system prompt.
        const jsonMatch = acc.match(/\{[\s\S]*\}/);
        const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { hits: [] };
        const hits: SkillHit[] = Array.isArray(parsed.hits) ? parsed.hits : [];

        setRegistryHits(hits);
        if (hits.length === 0) {
          // No prior art — flow straight to the write-fresh pipeline.
          setUserChoice("write-fresh");
        }
      } catch (e: any) {
        console.error("[search-registry]", e);
        setSearchError("registry unavailable — writing fresh");
        setRegistryHits([]);
        setUserChoice("write-fresh");
      } finally {
        setSearching(false);
      }
    })();
  }, [isDone]);

  // Convert a github.com SKILL.md URL into its raw.githubusercontent.com
  // counterpart so we can fetch the file content directly.
  function toRawUrl(githubUrl: string): string {
    return githubUrl
      .replace("https://github.com/", "https://raw.githubusercontent.com/")
      .replace("/blob/", "/");
  }

  // Install path — fetch the chosen skill's SKILL.md from GitHub and use it
  // verbatim, skipping the synth/sharpen/test pipeline entirely.
  async function handleInstall(hit: SkillHit) {
    if (installing) return;
    setInstalling(true);
    setInstallError(null);
    try {
      const raw = await fetch(toRawUrl(hit.url));
      if (!raw.ok) throw new Error(`couldn't fetch SKILL.md (${raw.status})`);
      const md = await raw.text();
      if (!md.trim()) throw new Error("SKILL.md was empty");

      // Override the user's typed name with the installed skill's actual name
      // so the slug + DoneCard hints reflect what they're installing.
      const nameMatch = md.match(/^name:\s*(.*)$/m);
      if (nameMatch?.[1]) {
        setAnswers((a: any) => ({ ...a, name: nameMatch[1].trim() }));
      }

      setSynthesizedMd(md.trim());
      setUserChoice("install");
    } catch (e: any) {
      console.error("[install]", e);
      setInstallError(e?.message ?? "install failed");
    } finally {
      setInstalling(false);
    }
  }

  function handleWriteFresh() {
    setUserChoice("write-fresh");
  }

  // Stage 1 — research the skill's domain via the model's web_search tool.
  // Gated on `userChoice === 'write-fresh'` so the install path skips it.
  useEffect(() => {
    if (!isDone || userChoice !== "write-fresh" || researchFiredRef.current) return;
    researchFiredRef.current = true;

    (async () => {
      setResearching(true);
      setResearchError(null);
      try {
        const userMessage = `Mode: RESEARCH_TOPIC

Research the user's skill domain on the web. Use the web_search tool 2–4 times with varied queries. Return the structured Findings / Pitfalls / Sources block — do NOT write the SKILL.md.

name: ${answers.name || "(unnamed)"}
purpose: ${answers.purpose || "(none)"}
trigger: ${answers.trigger || "(none)"}`;

        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: userMessage }],
          }),
        });

        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
        }
        acc += decoder.decode();
        const finalText = acc.trim();

        if (finalText === "RESEARCH_UNAVAILABLE" || !finalText) {
          setResearchError("research skipped — synthesizing without it");
          setResearchNotes("");
          return;
        }

        // Parse the `## Sources` block: lines like `[1] https://… — title`.
        const sources: ResearchSource[] = [];
        const sourcesBlock = finalText.split(/^##\s+Sources\s*$/m)[1] || "";
        const re = /^\[(\d+)\]\s+(\S+)\s+—\s+(.+)$/gm;
        let m: RegExpExecArray | null;
        while ((m = re.exec(sourcesBlock)) !== null) {
          sources.push({ n: Number(m[1]), url: m[2], title: m[3].trim() });
        }
        setResearchSources(sources);
        setResearchNotes(finalText);
      } catch (e: any) {
        console.error("[research]", e);
        setResearchError("research skipped — synthesizing without it");
        // Unblock the chain even on failure.
        setResearchNotes("");
      } finally {
        setResearching(false);
      }
    })();
  }, [isDone, userChoice]);

  // Stage 2 — synthesize the SKILL.md, grounded in research notes if any.
  // Skip entirely on the install path — the SKILL.md was fetched verbatim.
  useEffect(() => {
    if (!isDone || userChoice !== "write-fresh" || researchNotes === null || synthFiredRef.current) return;
    synthFiredRef.current = true;

    (async () => {
      setSynthesizing(true);
      setSynthError(null);
      try {
        const answersBlock = INTERVIEW
          .map(q => `${q.key}: ${answers[q.key] || "(skipped)"}`)
          .join("\n");

        const userMessage = `Mode: SYNTHESIZE_SKILL_MD

Here are the user's interview answers. Produce the complete SKILL.md.

${answersBlock}

research_notes:
${researchNotes || "(unavailable)"}`;

        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: userMessage }],
          }),
        });

        if (!res.ok || !res.body) {
          const errText = await res.text().catch(() => "");
          throw new Error(errText || `HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          setSynthesizedMd(acc);
        }
        acc += decoder.decode();
        setSynthesizedMd(acc.trim());
      } catch (e: any) {
        console.error("[synthesize]", e);
        setSynthError(
          e?.message?.includes("ANTHROPIC_API_KEY")
            ? "set ANTHROPIC_API_KEY in .env.local — using template fallback"
            : "synthesis failed — using template fallback"
        );
      } finally {
        setSynthesizing(false);
      }
    })();
  }, [isDone, userChoice, researchNotes]);

  // Stage 3 — sharpen the `description:` line via OPTIMIZE_DESCRIPTION.
  // Skip on the install path — installed skills keep their authors' descriptions.
  useEffect(() => {
    if (
      !isDone ||
      userChoice !== "write-fresh" ||
      synthesizedMd == null ||
      synthesizing ||
      optimizeFiredRef.current
    )
      return;
    optimizeFiredRef.current = true;

    (async () => {
      setOptimizing(true);
      setOptimizeError(null);
      try {
        const userMessage = `Mode: OPTIMIZE_DESCRIPTION

Here is the freshly-synthesized SKILL.md. Rewrite its description: line per the rules and return JSON only.

${synthesizedMd}`;

        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: userMessage }],
          }),
        });

        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
        }
        acc += decoder.decode();
        const finalText = acc.trim();

        if (finalText === "OPTIMIZE_UNAVAILABLE" || !finalText) {
          throw new Error("optimize skipped");
        }

        const jsonMatch = finalText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("no JSON in response");
        const parsed = JSON.parse(jsonMatch[0]) as OptimizedDesc;
        if (typeof parsed.improved !== "string" || typeof parsed.original !== "string") {
          throw new Error("malformed JSON");
        }

        setOptimizedDescription(parsed);
        if (parsed.improved && parsed.improved !== parsed.original) {
          setSynthesizedMd(prev => (prev ? replaceDescription(prev, parsed.improved) : prev));
        }
      } catch (e: any) {
        console.error("[optimize]", e);
        setOptimizeError("couldn't sharpen trigger — keeping original");
        // Set passthrough so the chain advances to trigger-test.
        setOptimizedDescription({ original: "", improved: "", changes: "" });
      } finally {
        setOptimizing(false);
      }
    })();
  }, [isDone, userChoice, synthesizedMd, synthesizing]);

  // Stage 4 — generate test cases and ask Claude (with a stripped-down system
  // prompt) whether the description as written would actually fire the skill.
  // Skip on the install path.
  useEffect(() => {
    if (
      !isDone ||
      userChoice !== "write-fresh" ||
      optimizedDescription === null ||
      synthesizedMd == null ||
      triggerFiredRef.current
    )
      return;
    triggerFiredRef.current = true;

    (async () => {
      setTestingTrigger(true);
      setTriggerTestError(null);
      try {
        // Pull the current description (post-sharpen if applicable).
        const descMatch = synthesizedMd.match(/^description:\s*(.*)$/m);
        const description = descMatch?.[1]?.trim() || optimizedDescription.improved || optimizedDescription.original;
        const nameMatch = synthesizedMd.match(/^name:\s*(.*)$/m);
        const skillName = nameMatch?.[1]?.trim() || answers.name || "(unnamed)";

        const userMessage = `Test this skill's trigger.

name: ${skillName}
description: ${description}

Generate 3 plausible user requests where this skill should fire and 1 adjacent request where it should not. For each, judge whether the description as written would lead you to pick this skill. Return JSON only.`;

        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: `Mode: TEST_TRIGGER\n\n${userMessage}` }],
          }),
        });

        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
        }
        acc += decoder.decode();
        const finalText = acc.trim();

        if (finalText === "TRIGGER_TEST_UNAVAILABLE" || !finalText) {
          throw new Error("trigger test skipped");
        }

        const jsonMatch = finalText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("no JSON in response");
        const parsed = JSON.parse(jsonMatch[0]) as { tests: TriggerTest[] };
        if (!Array.isArray(parsed.tests)) throw new Error("malformed tests array");
        setTriggerTests(parsed.tests);
      } catch (e: any) {
        console.error("[trigger-test]", e);
        setTriggerTestError("trigger self-test unavailable");
      } finally {
        setTestingTrigger(false);
      }
    })();
  }, [isDone, userChoice, optimizedDescription, synthesizedMd]);

  // Re-sharpen the description with the failing test cases as extra context.
  // Doesn't auto-rerun the trigger test — the user clicks "stress-test again"
  // (or just re-saves with the new description).
  async function handleResharpen() {
    if (!synthesizedMd || optimizing) return;
    const failures = (triggerTests || [])
      .filter(t => t.should_fire && !t.would_fire)
      .map(t => `- "${t.request}" — ${t.reason}`)
      .join("\n");
    if (!failures) return;

    setOptimizing(true);
    setOptimizeError(null);
    try {
      const userMessage = `Mode: OPTIMIZE_DESCRIPTION

The current description failed to trigger on these user requests. Rewrite the description: line so it would fire on these phrasings.

failed_cases:
${failures}

Current SKILL.md:
${synthesizedMd}`;

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: userMessage }],
        }),
      });

      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
      }
      acc += decoder.decode();
      const finalText = acc.trim();

      if (finalText === "OPTIMIZE_UNAVAILABLE" || !finalText) {
        throw new Error("re-sharpen skipped");
      }
      const jsonMatch = finalText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("no JSON in response");
      const parsed = JSON.parse(jsonMatch[0]) as OptimizedDesc;
      setOptimizedDescription(parsed);
      if (parsed.improved && parsed.improved !== parsed.original) {
        setSynthesizedMd(prev => (prev ? replaceDescription(prev, parsed.improved) : prev));
      }
    } catch (e: any) {
      console.error("[re-sharpen]", e);
      setOptimizeError("re-sharpen failed");
    } finally {
      setOptimizing(false);
    }
  }

  function handleNext() {
    if (!current) return;
    const value = draft.trim();
    if (!value && !current.optional) return;
    setAnswers(a => ({ ...a, [current.key]: value }));
    setDraft("");
    setStep(s => s + 1);
  }

  function handleSkip() {
    if (!current?.optional) return;
    setStep(s => s + 1);
  }

  function handleBack() {
    if (step === 0) return;
    const prev = INTERVIEW[step - 1];
    setDraft(answers[prev.key] || "");
    setStep(s => s - 1);
  }

  function handleStart() {
    setStarted(true);
    setStep(0);
  }

  function handleReset() {
    setAnswers({});
    setDraft("");
    setStep(0);
    setStarted(false);
  }

  async function handleEnhance() {
    if (!current || !draft.trim()) return;
    setEnhancing(true);
    setEnhanceMsg("");
    try {
      const priorContext = INTERVIEW.slice(0, step)
        .map(q => `${q.key}: ${answers[q.key] || "(skipped)"}`)
        .join("\n");

      const userMessage = `Mode: POLISH_FIELD

Field being polished: **${current.key}**

Prior answers from this interview:
${priorContext || "(none yet — this is the first field)"}

Their current draft for "${current.key}":
${draft}`;

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: userMessage }],
        }),
      });

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "");
        throw new Error(errText || `HTTP ${res.status}`);
      }

      // Stream the polished text back into the textarea as it arrives.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      setDraft("");
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setDraft(acc);
      }
      acc += decoder.decode();
      const finalText = acc.trim();
      if (finalText) {
        setDraft(finalText);
        setEnhanceMsg("polished ✶");
        setTimeout(() => setEnhanceMsg(""), 2000);
      }
    } catch (e: any) {
      console.error(e);
      setEnhanceMsg(
        e?.message?.includes("ANTHROPIC_API_KEY")
          ? "set ANTHROPIC_API_KEY in .env.local"
          : "couldn't reach the muse"
      );
      setTimeout(() => setEnhanceMsg(""), 3000);
    } finally {
      setEnhancing(false);
    }
  }

  const slug = useMemo(
    () =>
      (answers.name || "my-skill")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "my-skill",
    [answers.name],
  );

  function handleCopy() {
    navigator.clipboard.writeText(skillMd);
    setEnhanceMsg("copied to clipboard");
    setTimeout(() => setEnhanceMsg(""), 1800);
  }

  const cssVars: any = {
    "--accent": tweaks.accent,
    "--paper": tweaks.paper,
    "--ink": tweaks.ink,
  };

  return (
    <div className="page" style={cssVars}>
      {tweaks.showSketch && <BackgroundDecor />}

      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">✶</span>
          <span className="brand-name">skillsmith</span>
        </div>
        <nav className="topnav">
          <a href="#how">how it works</a>
          <a href="#about">about skills</a>
          <button className="ghost-btn" onClick={handleReset}>start over</button>
        </nav>
      </header>

      {!started && <Hero onStart={handleStart} />}

      {started && (
        <main className="workshop">
          <section className="left">
            <Stepper step={step} total={INTERVIEW.length} />

            {!isDone && current && (
              <QuestionCard
                question={current}
                draft={draft}
                setDraft={setDraft}
                onNext={handleNext}
                onSkip={handleSkip}
                onBack={handleBack}
                onEnhance={handleEnhance}
                enhancing={enhancing}
                enhanceMsg={enhanceMsg}
                step={step}
                canBack={step > 0}
              />
            )}

            {isDone && userChoice === null && (
              <FindOrBuildCard
                searching={searching}
                searchError={searchError}
                hits={registryHits}
                onInstall={handleInstall}
                onWriteFresh={handleWriteFresh}
                installing={installing}
                installError={installError}
              />
            )}

            {isDone && userChoice !== null && (
              <DoneCard
                skillMd={skillMd}
                slug={slug}
                onCopy={handleCopy}
                onReset={handleReset}
                msg={enhanceMsg}
                name={answers.name}
                synthesizing={synthesizing}
                synthError={synthError}
                researching={researching}
                researchSources={researchSources}
                researchError={researchError}
                optimizing={optimizing}
                optimizedDescription={optimizedDescription}
                optimizeError={optimizeError}
                testingTrigger={testingTrigger}
                triggerTests={triggerTests}
                triggerTestError={triggerTestError}
                onResharpen={handleResharpen}
                pipelineActive={pipelineActive}
                installedFromRegistry={userChoice === "install"}
              />
            )}
          </section>

          <section className="right">
            <PreviewPane
              ref={previewRef}
              md={skillMd}
              answers={answers}
              pipelineActive={pipelineActive}
              researching={researching}
              synthesizing={synthesizing}
              optimizing={optimizing}
              testingTrigger={testingTrigger}
              synthError={synthError}
              isSynthesized={synthesizedMd !== null}
            />
          </section>
        </main>
      )}

      {!started && <HowItWorks />}
      {!started && <Footer />}
    </div>
  );
}

// ----- Hero -----
function Hero({ onStart }) {
  return (
    <section className="hero">
      <div className="hero-inner">
        <div className="eyebrow">
          <span className="dot" /> a tiny workshop for non-coders
        </div>
        <h1 className="display">
          Teach your agent a new <em>trick</em>
          <Underline className="title-underline" />
          <span className="hero-flourish">
            <Star size={36} />
          </span>
        </h1>
        <p className="lede">
          A skill is a little instruction card you hand to your agent — so it knows
          how <em>you</em> like things done. We'll interview you, polish your
          words, and hand you back a tidy <code>SKILL.md</code> file.
        </p>
        <div className="hero-cta">
          <button className="primary-btn" onClick={onStart}>
            Begin the interview
            <span className="arrow-inline">→</span>
          </button>
          <span className="cta-aside">~3 minutes · no signup</span>
        </div>
      </div>

      <SkillCardSample />
    </section>
  );
}

function SkillCardSample() {
  return (
    <div className="sample-stack">
      <div className="sample sample-back">
        <div className="sample-tag">SKILL.md</div>
        <div className="sample-title">brand-voice</div>
        <div className="sample-line w-80" />
        <div className="sample-line w-60" />
        <div className="sample-line w-70" />
      </div>
      <div className="sample sample-mid">
        <div className="sample-tag">SKILL.md</div>
        <div className="sample-title">standup-notes</div>
        <div className="sample-line w-85" />
        <div className="sample-line w-55" />
        <div className="sample-line w-75" />
        <div className="sample-line w-40" />
      </div>
      <div className="sample sample-front">
        <div className="sample-tag">SKILL.md</div>
        <div className="sample-title">recipe-rescuer</div>
        <div className="sample-frontmatter">
          <span>name: recipe-rescuer</span>
          <span>description: Salvage half-remembered…</span>
        </div>
        <div className="sample-h">## Instructions</div>
        <div className="sample-line w-90" />
        <div className="sample-line w-70" />
        <div className="sample-line w-80" />
        <div className="sample-stamp">
          <Star size={22} />
          <span>ready</span>
        </div>
      </div>
    </div>
  );
}

// ----- Stepper -----
function Stepper({ step, total }) {
  return (
    <div className="stepper">
      <div className="stepper-label">
        <span className="num">{Math.min(step + 1, total).toString().padStart(2, "0")}</span>
        <span className="of">of {total.toString().padStart(2, "0")}</span>
      </div>
      <div className="stepper-bar">
        {Array.from({ length: total }).map((_, i) => (
          <div key={i} className={`stepper-tick ${i < step ? "done" : i === step ? "active" : ""}`} />
        ))}
      </div>
      <div className="stepper-meta">
        {step >= total ? "all set" : INTERVIEW[step].key}
      </div>
    </div>
  );
}

// ----- Question card -----
function QuestionCard({ question, draft, setDraft, onNext, onSkip, onBack, onEnhance, enhancing, enhanceMsg, step, canBack }) {
  const Field: any = question.multiline ? "textarea" : "input";
  return (
    <div className="qcard">
      <div className="qhead">
        <span className="qkey">{question.key}</span>
        {question.optional && <span className="qopt">optional</span>}
      </div>
      <h2 className="question">
        {question.prompt}
      </h2>
      <p className="qhint">{question.hint}</p>

      <Field
        className={`qfield ${question.multiline ? "qfield-multi" : ""}`}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        placeholder={question.placeholder}
        rows={question.multiline ? 7 : undefined}
        onKeyDown={e => {
          if (!question.multiline && e.key === "Enter") { e.preventDefault(); onNext(); }
          if (question.multiline && e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onNext(); }
        }}
      />

      <div className="qactions">
        <div className="qactions-left">
          {canBack && (
            <button className="link-btn" onClick={onBack}>← back</button>
          )}
          <button
            className="enhance-btn"
            onClick={onEnhance}
            disabled={enhancing || !draft.trim()}
            title="Polish with SkillSmith"
          >
            <span className="enhance-glyph">✶</span>
            {enhancing ? "polishing…" : "polish with skillsmith"}
          </button>
          {enhanceMsg && <span className="enhance-msg">{enhanceMsg}</span>}
        </div>
        <div className="qactions-right">
          {question.optional && (
            <button className="link-btn" onClick={onSkip}>skip</button>
          )}
          <button
            className="primary-btn"
            onClick={onNext}
            disabled={!question.optional && !draft.trim()}
          >
            {step === INTERVIEW.length - 1 ? "finish" : "next"}
            <span className="arrow-inline">→</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ----- Find-or-build card -----
//
// Renders between the interview and the DoneCard when the Skill Registry MCP
// returns prior-art hits. The user can install one (skipping the synth
// pipeline entirely) or write fresh (existing pipeline kicks in).
function FindOrBuildCard({
  searching,
  searchError,
  hits,
  onInstall,
  onWriteFresh,
  installing,
  installError,
}: {
  searching: boolean;
  searchError: string | null;
  hits: { name: string; repo: string; url: string; description: string }[] | null;
  onInstall: (hit: { name: string; repo: string; url: string; description: string }) => void;
  onWriteFresh: () => void;
  installing: boolean;
  installError: string | null;
}) {
  if (searching || hits === null) {
    return (
      <div className="qcard">
        <div className="qhead">
          <span className="qkey">checking the registry</span>
        </div>
        <h2 className="question">
          Looking for skills that already do this…
        </h2>
        <p className="qhint">
          Searching public agent skills via the Skill Registry MCP server. If
          someone's already shipped this, we'll show it — no point in writing it twice.
        </p>
      </div>
    );
  }

  return (
    <div className="qcard">
      <div className="qhead">
        <span className="qkey">we found {hits.length} existing skill{hits.length === 1 ? "" : "s"}</span>
      </div>
      <h2 className="question">
        Install one — or write fresh.
      </h2>
      <p className="qhint">
        These already exist in the public agent-skills ecosystem. Installing
        copies the file directly. Writing fresh runs the full research +
        synthesis pipeline.
      </p>

      <div className="hit-list">
        {hits.map((hit) => (
          <div key={hit.url} className="hit-card">
            <div className="hit-head">
              <span className="hit-name">{hit.name}</span>
              <a className="hit-repo" href={hit.url} target="_blank" rel="noreferrer">
                {hit.repo} ↗
              </a>
            </div>
            {hit.description && (
              <p className="hit-desc">{hit.description}</p>
            )}
            <div className="hit-actions">
              <button
                className="primary-btn"
                onClick={() => onInstall(hit)}
                disabled={installing}
              >
                {installing ? "installing…" : "install this"}
                <span className="arrow-inline">→</span>
              </button>
            </div>
          </div>
        ))}
      </div>

      {installError && (
        <p className="enhance-msg" style={{ color: "#b00", marginTop: 12 }}>
          {installError}
        </p>
      )}
      {searchError && (
        <p className="qhint" style={{ marginTop: 12, opacity: 0.7 }}>
          {searchError}
        </p>
      )}

      <div className="qactions" style={{ marginTop: 20 }}>
        <div className="qactions-left">
          <span className="qhint" style={{ margin: 0 }}>None of these match?</span>
        </div>
        <div className="qactions-right">
          <button
            className="link-btn"
            onClick={onWriteFresh}
            disabled={installing}
          >
            write fresh →
          </button>
        </div>
      </div>
    </div>
  );
}

// ----- Done card -----
const TARGET_LABELS: Record<Target, string> = {
  claude: "Claude Code",
  cursor: "Cursor",
  generic: "Generic .md",
};

function DoneCard({
  skillMd,
  slug,
  onCopy,
  onReset,
  msg,
  name,
  synthesizing,
  synthError,
  researching,
  researchSources,
  researchError,
  optimizing,
  optimizedDescription,
  optimizeError,
  testingTrigger,
  triggerTests,
  triggerTestError,
  onResharpen,
  pipelineActive,
}: any) {
  const [target, setTarget] = useState<Target>("claude");
  const [scope, setScope] = useState<Scope>("global");
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<Extract<SaveResult, { kind: "saved" }> | null>(null);
  const [saveError, setSaveError] = useState("");

  const supportsScope = target === "claude";
  const effectiveScope: Scope = supportsScope ? scope : "project";
  const fsaSupported = canSaveToFolder();
  // Global Claude installs go to ~/.claude/skills/<name>/. The browser's folder
  // picker forces the user to navigate to ~ (which is hidden by default in
  // macOS Finder) and pick the right place — easy to get wrong. For that one
  // case we hide the picker and lead the user to the .zip flow instead. Every
  // other target/scope combo lands in a project root, where picking the open
  // folder is intuitive.
  const pickerAllowed = fsaSupported && !(target === "claude" && effectiveScope === "global");

  const artifacts = useMemo(
    () => buildArtifacts(skillMd, slug, target, effectiveScope),
    [skillMd, slug, target, effectiveScope],
  );

  // Sharing is lazy: we POST to /api/share when the user clicks copy, not on
  // every skillMd change. The pipeline mutates skillMd several times
  // (synthesis streams, optimizer splices new description), so eager sharing
  // would burn through KV writes for transient states. We invalidate the
  // cached ID whenever the inputs change so the next click re-shares.
  const [installCommand, setInstallCommand] = useState("");
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState("");

  useEffect(() => {
    setInstallCommand("");
    setShareError("");
  }, [skillMd, slug, target, effectiveScope]);

  async function handleCopyCommand() {
    setShareError("");
    let cmd = installCommand;
    if (!cmd) {
      setSharing(true);
      try {
        const id = await shareSkill(skillMd, slug, target, effectiveScope);
        cmd = buildNpxCommand(id, window.location.origin);
        setInstallCommand(cmd);
      } catch (e: any) {
        setShareError(e?.message?.slice(0, 80) || "couldn't share");
        setSharing(false);
        return;
      }
      setSharing(false);
    }
    try {
      await navigator.clipboard.writeText(cmd);
      setCopiedCmd(true);
      setTimeout(() => setCopiedCmd(false), 1800);
    } catch {
      // Clipboard unavailable (insecure context, ancient browser) — the
      // command stays visible for manual selection. Don't trip an error UI.
    }
  }

  // Reset confirmation when the user changes target/scope after a save.
  useEffect(() => {
    setSaveResult(null);
    setSaveError("");
  }, [target, scope]);

  async function handleSave() {
    setSaving(true);
    setSaveError("");
    const result = await saveToDirectory(artifacts.entries);
    setSaving(false);
    if (result.kind === "saved") {
      setSaveResult(result);
    } else if (result.kind === "error") {
      setSaveError(`couldn't write — ${result.message}. try Download .zip`);
    }
  }

  async function handleZip() {
    setSaveError("");
    try {
      await saveAsZip(artifacts.entries, artifacts.zipName);
    } catch (e: any) {
      setSaveError(e?.message || "couldn't build zip");
    }
  }

  return (
    <div className="qcard done-card">
      <div className="done-stamp">
        <Star size={42} />
      </div>
      <h2 className="question">
        {researching
          ? "Studying the craft…"
          : synthesizing
          ? "Forging your skill…"
          : optimizing
          ? "Sharpening the trigger…"
          : testingTrigger
          ? "Stress-testing…"
          : "Your skill is forged."}
      </h2>
      <p className="qhint" style={{ marginBottom: 20 }}>
        {researching ? (
          <>The skill-creator is browsing the web for best practices in your domain.</>
        ) : synthesizing ? (
          <>
            The skill-creator is rewriting your answers into a polished{" "}
            <code>SKILL.md</code> — watch it stream into the preview.
          </>
        ) : optimizing ? (
          <>Tightening the description so your agent will actually fire this skill.</>
        ) : testingTrigger ? (
          <>Asking the model whether it would invoke this skill in plausible scenarios.</>
        ) : (
          <>
            Take <em>{name || "your skill"}</em> home — pick where it should
            land and we'll create the right folder structure for you.
          </>
        )}
      </p>

      {researching && (
        <div className="synth-loader research-loader" aria-live="polite">
          <span className="synth-dot" />
          <span className="synth-dot" />
          <span className="synth-dot" />
          <span className="synth-label">researching best practices</span>
        </div>
      )}
      {synthesizing && (
        <div className="synth-loader" aria-live="polite">
          <span className="synth-dot" />
          <span className="synth-dot" />
          <span className="synth-dot" />
          <span className="synth-label">synthesizing with skill-creator</span>
        </div>
      )}
      {optimizing && (
        <div className="synth-loader optimize-loader" aria-live="polite">
          <span className="synth-dot" />
          <span className="synth-dot" />
          <span className="synth-dot" />
          <span className="synth-label">sharpening the trigger</span>
        </div>
      )}
      {testingTrigger && (
        <div className="synth-loader test-loader" aria-live="polite">
          <span className="synth-dot" />
          <span className="synth-dot" />
          <span className="synth-dot" />
          <span className="synth-label">stress-testing the trigger</span>
        </div>
      )}

      {!pipelineActive && (
        <SkillQualityRow
          researchSources={researchSources}
          researchError={researchError}
          optimizedDescription={optimizedDescription}
          optimizeError={optimizeError}
          triggerTests={triggerTests}
          triggerTestError={triggerTestError}
          onResharpen={onResharpen}
        />
      )}

      {!pipelineActive && (
        <div className="install-picker" aria-label="install target">
          <div className="picker-row">
            <span className="picker-label">for</span>
            <div className="seg" role="tablist">
              {(Object.keys(TARGET_LABELS) as Target[]).map(t => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={target === t}
                  className={`seg-btn ${target === t ? "is-active" : ""}`}
                  onClick={() => setTarget(t)}
                  type="button"
                >
                  {TARGET_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          {supportsScope && (
            <div className="picker-row">
              <span className="picker-label">scope</span>
              <div className="seg seg-sm" role="tablist">
                <button
                  role="tab"
                  aria-selected={scope === "global"}
                  className={`seg-btn ${scope === "global" ? "is-active" : ""}`}
                  onClick={() => setScope("global")}
                  type="button"
                  title="installs into ~/.claude/skills/ — available everywhere"
                >
                  global
                </button>
                <button
                  role="tab"
                  aria-selected={scope === "project"}
                  className={`seg-btn ${scope === "project" ? "is-active" : ""}`}
                  onClick={() => setScope("project")}
                  type="button"
                  title="installs into .claude/skills/ in this repo only"
                >
                  project
                </button>
              </div>
            </div>
          )}

          <div className="path-preview">
            <span className="path-hint">{describeTarget(target, effectiveScope)}</span>
            <code className="path-line">{artifacts.pathHint}</code>
          </div>
        </div>
      )}

      <div className="done-actions" style={{ opacity: pipelineActive ? 0.5 : 1 }}>
        {pickerAllowed && (
          <button
            className="primary-btn big"
            onClick={handleSave}
            disabled={pipelineActive || saving}
            title={pipelineActive ? "wait for the pipeline to finish" : "pick a folder; we write the structure"}
          >
            {saving ? "saving…" : "↓ save to folder…"}
          </button>
        )}
        <button
          className={pickerAllowed ? "ghost-btn" : "primary-btn big"}
          onClick={handleZip}
          disabled={pipelineActive}
          title="download a zip with the right folder layout"
        >
          {pickerAllowed ? "download .zip" : "↓ download .zip"}
        </button>
        <button
          className="ghost-btn"
          onClick={onCopy}
          disabled={pipelineActive}
        >
          copy text
        </button>
        <button className="link-btn" onClick={onReset}>forge another</button>
      </div>

      {!pipelineActive && (
        <div className="install-cli" aria-label="install via terminal">
          <p className="cli-hint">{terminalHint(target, effectiveScope)}</p>
          <pre className="cli-block">
            {installCommand || `npx -y @snehamrzn/skillsmith-install@latest <click copy to generate>`}
          </pre>
          <button
            type="button"
            className="primary-btn cli-copy"
            onClick={handleCopyCommand}
            disabled={sharing}
          >
            {sharing ? "sharing…" : copiedCmd ? "copied ✓" : "↗ copy npx command"}
          </button>
          {shareError && (
            <p className="cli-hint" style={{ color: "#b96a1c" }}>{shareError}</p>
          )}
        </div>
      )}

      {synthError && (
        <div className="enhance-msg" style={{ marginTop: 14 }}>{synthError}</div>
      )}
      {saveError && (
        <div className="enhance-msg" style={{ marginTop: 14 }}>{saveError}</div>
      )}
      {msg && !synthError && !saveError && (
        <div className="enhance-msg" style={{ marginTop: 14 }}>{msg}</div>
      )}

      {saveResult ? (
        <div className="next-steps next-steps-saved">
          <h4>saved ✶</h4>
          <p style={{ margin: "0 0 6px" }}>
            Wrote into <code>{saveResult.rootName}</code>:
          </p>
          <ul style={{ margin: "0 0 10px", paddingLeft: 22 }}>
            {saveResult.paths.map(p => (
              <li key={p}><code>{p}</code></li>
            ))}
          </ul>
          <p style={{ margin: 0 }}>{reloadHint(target)}</p>
        </div>
      ) : (
        <div className="next-steps">
          <h4>what to do next</h4>
          <NextStepsList target={target} scope={effectiveScope} pickerAllowed={pickerAllowed} />
        </div>
      )}
    </div>
  );
}

function NextStepsList({ target, scope, pickerAllowed }: { target: Target; scope: Scope; pickerAllowed: boolean }) {
  if (target === "claude") {
    if (pickerAllowed) {
      // Project scope only — global hides the picker.
      return (
        <ol>
          <li>Click <strong>save to folder…</strong> and pick your project root.</li>
          <li>
            We'll create <code>.claude/skills/&lt;name&gt;/SKILL.md</code> for you.
          </li>
          <li>{reloadHint("claude")}</li>
        </ol>
      );
    }
    return (
      <ol>
        <li>Click <strong>download .zip</strong>.</li>
        <li>
          Unzip into{" "}
          {scope === "global" ? (
            <>your home folder — files land at <code>~/.claude/skills/&lt;name&gt;/</code></>
          ) : (
            <>your project root — files land at <code>.claude/skills/&lt;name&gt;/</code></>
          )}.
        </li>
        <li>{reloadHint("claude")}</li>
      </ol>
    );
  }
  if (target === "cursor") {
    if (pickerAllowed) {
      return (
        <ol>
          <li>Click <strong>save to folder…</strong> and pick your project root.</li>
          <li>We'll create <code>.cursor/rules/&lt;name&gt;.mdc</code> with the right frontmatter.</li>
          <li>{reloadHint("cursor")}</li>
        </ol>
      );
    }
    return (
      <ol>
        <li>Click <strong>download .zip</strong>.</li>
        <li>Unzip into your project root — the file lands at <code>.cursor/rules/&lt;name&gt;.mdc</code>.</li>
        <li>{reloadHint("cursor")}</li>
      </ol>
    );
  }
  return (
    <ol>
      <li>{pickerAllowed ? "Save or download the .md file." : "Download the .md file."}</li>
      <li>Drop it wherever your agent reads instructions from.</li>
    </ol>
  );
}

// ----- Skill quality row (sources + sharpened pill + trigger test) -----
function SkillQualityRow({
  researchSources,
  researchError,
  optimizedDescription,
  optimizeError,
  triggerTests,
  triggerTestError,
  onResharpen,
}: any) {
  const hasSources = Array.isArray(researchSources) && researchSources.length > 0;
  const sharpened =
    optimizedDescription &&
    optimizedDescription.improved &&
    optimizedDescription.original &&
    optimizedDescription.improved !== optimizedDescription.original;
  const hasTests = Array.isArray(triggerTests) && triggerTests.length > 0;

  if (!hasSources && !sharpened && !hasTests && !researchError && !optimizeError && !triggerTestError) {
    return null;
  }

  const passed = hasTests
    ? triggerTests!.filter((t: any) => t.should_fire === t.would_fire).length
    : 0;
  const total = hasTests ? triggerTests!.length : 0;
  const failingShouldFire = hasTests
    ? triggerTests!.filter((t: any) => t.should_fire && !t.would_fire)
    : [];

  function hostnameFor(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  }

  return (
    <div className="skill-quality">
      {hasSources && (
        <div className="skill-sources">
          <details>
            <summary>
              <span className="quality-pill">✶ grounded in {researchSources.length} source{researchSources.length === 1 ? "" : "s"}</span>
            </summary>
            <ul>
              {researchSources.map((s: any) => (
                <li key={s.n}>
                  <span className="src-num">[{s.n}]</span>
                  <a href={s.url} target="_blank" rel="noreferrer">{hostnameFor(s.url)}</a>
                  <span className="src-title"> — {s.title}</span>
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}

      {researchError && !hasSources && (
        <div className="quality-note">{researchError}</div>
      )}

      {sharpened && (
        <div className="trigger-sharpened">
          <details>
            <summary>
              <span className="quality-pill quality-pill-accent">✶ trigger sharpened</span>
            </summary>
            <div className="sharpen-diff">
              <div className="sharpen-row">
                <span className="sharpen-label">before</span>
                <code>{optimizedDescription.original}</code>
              </div>
              <div className="sharpen-row">
                <span className="sharpen-label">after</span>
                <code>{optimizedDescription.improved}</code>
              </div>
              {optimizedDescription.changes && (
                <p className="sharpen-rationale">{optimizedDescription.changes}</p>
              )}
            </div>
          </details>
        </div>
      )}

      {optimizeError && (
        <div className="quality-note">{optimizeError}</div>
      )}

      {hasTests && (
        <div className="trigger-test">
          <div className="trigger-test-head">
            <span className={`quality-pill ${passed === total ? "quality-pill-good" : "quality-pill-warn"}`}>
              Trigger test: {passed}/{total} passed
            </span>
            {failingShouldFire.length > 0 && (
              <button
                type="button"
                className="link-btn re-sharpen-btn"
                onClick={onResharpen}
              >
                re-sharpen trigger →
              </button>
            )}
          </div>
          <ul className="trigger-test-list">
            {triggerTests!.map((t: any, i: number) => {
              const ok = t.should_fire === t.would_fire;
              return (
                <li key={i} className={`trigger-row ${ok ? "ok" : "fail"}`}>
                  <span className="trigger-mark">{ok ? "✓" : "✗"}</span>
                  <details>
                    <summary>
                      <span className="trigger-request">{t.request}</span>
                      <span className="trigger-expected">
                        {t.should_fire ? "should fire" : "should not fire"}
                      </span>
                    </summary>
                    <p className="trigger-reason">{t.reason}</p>
                  </details>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {triggerTestError && !hasTests && (
        <div className="quality-note">{triggerTestError}</div>
      )}
    </div>
  );
}

// ----- Preview pane -----
const PreviewPane = React.forwardRef<any, any>(({ md, answers, pipelineActive, researching, synthesizing, optimizing, testingTrigger, synthError, isSynthesized }, ref) => {
  const status = researching
    ? "researching best practices…"
    : synthesizing
    ? "synthesizing with skill-creator…"
    : optimizing
    ? "sharpening the trigger…"
    : testingTrigger
    ? "stress-testing the trigger…"
    : synthError
    ? synthError
    : isSynthesized
    ? "synthesized ✶"
    : "live preview";
  return (
    <div className={`preview ${pipelineActive ? "is-synthesizing" : ""}`} ref={ref}>
      <div className="preview-chrome">
        <span className="dot d1" />
        <span className="dot d2" />
        <span className="dot d3" />
        <span className="preview-name">
          {(answers.name || "untitled").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "untitled"}.SKILL.md
        </span>
      </div>
      <pre className="preview-body">
        <RenderedMd md={md} />
      </pre>
      <div className="preview-foot">
        <span>{status}</span>
        <span className="char-count">{md.length} chars</span>
      </div>
    </div>
  );
});

function RenderedMd({ md }) {
  const lines = md.split("\n");
  let inFrontmatter = false;
  let inCode = false;
  return (
    <>
      {lines.map((line, i) => {
        if (line === "---") {
          inFrontmatter = !inFrontmatter;
          return <span key={i} className="md-fence">{line}{"\n"}</span>;
        }
        if (line.startsWith("```")) {
          inCode = !inCode;
          return <span key={i} className="md-code-fence">{line}{"\n"}</span>;
        }
        if (inCode) {
          return <span key={i} className="md-code">{line}{"\n"}</span>;
        }
        if (inFrontmatter) {
          const m = line.match(/^([a-z-]+):\s*(.*)$/);
          if (m) {
            return (
              <span key={i}>
                <span className="md-key">{m[1]}</span>
                <span className="md-colon">: </span>
                <span className="md-val">{m[2]}</span>
                {"\n"}
              </span>
            );
          }
        }
        if (line.startsWith("# ")) return <span key={i} className="md-h1">{line}{"\n"}</span>;
        if (line.startsWith("## ")) return <span key={i} className="md-h2">{line}{"\n"}</span>;
        if (line.startsWith("- ") || /^\d+\.\s/.test(line)) return <span key={i} className="md-li">{line}{"\n"}</span>;
        if (line.startsWith("_") && line.endsWith("_")) return <span key={i} className="md-em">{line}{"\n"}</span>;
        return <span key={i}>{line}{"\n"}</span>;
      })}
    </>
  );
}

// ----- How it works strip -----
function HowItWorks() {
  return (
    <section id="how" className="how">
      <div className="how-head">
        <span className="eyebrow"><span className="dot" /> the workshop, in three movements</span>
        <h2 className="section-h">
          Talk it out. <em>Polish</em> it. Take it home.
        </h2>
      </div>
      <div className="how-grid">
        <div className="how-card">
          <div className="how-num">01</div>
          <h3>You answer six small questions.</h3>
          <p>Name. Purpose. When to use it. Steps. Gotchas. An example. Plain English, no jargon.</p>
        </div>
        <div className="how-card">
          <div className="how-num">02</div>
          <h3>Agent polishes your words.</h3>
          <p>One click and the muse tightens grammar, sharpens specifics, and shapes your steps into proper imperative voice.</p>
        </div>
        <div className="how-card">
          <div className="how-num">03</div>
          <h3>Out pops a SKILL.md.</h3>
          <p>A real, valid skill file with YAML frontmatter and the right structure. Drop it in <code>~/.claude/skills/</code> and you're off.</p>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="foot">
      <div className="foot-l">
        <span className="brand-mark">✶</span>
        <span>skillsmith — for the rest of us</span>
      </div>
      <div className="foot-r">
        <span>made for non-coders who want their agent to do things their way</span>
      </div>
    </footer>
  );
}

// ----- Background decor -----
function BackgroundDecor() {
  return (
    <div className="decor" aria-hidden>
      <div className="decor-grain" />
      <Star size={42} className="decor-star d-s1" color="var(--accent)" />
      <Star size={26} className="decor-star d-s2" color="var(--ink)" />
      <Star size={32} className="decor-star d-s3" color="var(--accent)" />
      <svg className="decor-arc" viewBox="0 0 400 200" fill="none">
        <path d="M10 180 C 100 20, 300 20, 390 180" stroke="var(--ink)" strokeWidth="2" strokeDasharray="6 8" fill="none"/>
      </svg>
      <div className="decor-blob d-b1" />
      <div className="decor-blob d-b2" />
    </div>
  );
}
