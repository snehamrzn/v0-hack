import React, { useState, useEffect, useRef, useMemo } from "react";
import { useTweaks } from "./TweaksPanel";

declare global {
  interface Window {
    claude?: { complete: (args: any) => Promise<string> };
  }
}

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
    prompt: "First — what should we call this skill? A short, memorable name works best.",
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
    prompt: "When should Claude reach for this skill? Give a couple of example moments.",
    placeholder: "e.g. when I paste meeting notes, when I say 'write the standup'…",
    hint: "Specific phrases and contexts help Claude know when to use it.",
  },
  {
    key: "steps",
    prompt: "Walk me through what Claude should actually do, step by step.",
    placeholder: "1. Read the notes\n2. Group by project\n3. Draft 3–5 bullets in our team voice…",
    hint: "Imperative voice. One step per line.",
    multiline: true,
  },
  {
    key: "gotchas",
    prompt: "Anything Claude tends to get wrong here? Quirks, gotchas, things to avoid?",
    placeholder: "e.g. don't invent attendees, never use the word 'synergy'…",
    hint: "This is the most valuable section. Be specific.",
    multiline: true,
    optional: true,
  },
  {
    key: "example",
    prompt: "Lastly — an example of input → output, if you have one. (Optional.)",
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

  const skillMd = useMemo(() => buildSkillMd(answers), [answers]);

  useEffect(() => {
    if (started && inputRef.current) {
      inputRef.current.focus();
    }
  }, [step, started]);

  useEffect(() => {
    if (previewRef.current) previewRef.current.scrollTop = 0;
  }, [step]);

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
      const ctx = INTERVIEW.slice(0, step).map(q => `${q.key}: ${answers[q.key] || ""}`).join("\n");
      const sys = `You are helping someone author a Claude skill (an instruction file Claude loads to do specialized tasks).
The user is at the "${current.key}" step. Their answer so far is below.
Polish it: keep their voice, fix grammar, sharpen specifics, use imperative tense for steps.
${current.key === "trigger" ? "Make it 'pushy' — Claude tends to under-use skills. Phrase as concrete moments/phrases." : ""}
${current.key === "steps" ? "Output as numbered steps, one per line, imperative." : ""}
${current.key === "gotchas" ? "Output as bullet list, one per line." : ""}
Return ONLY the polished text. No preamble, no markdown headers.`;
      if (!window.claude?.complete) throw new Error("claude.complete unavailable");
      const text = await window.claude.complete({
        messages: [
          { role: "user", content: `Previous context:\n${ctx}\n\nCurrent step (${current.key}):\n${draft}\n\n${sys}` }
        ]
      });
      if (text && text.trim()) {
        setDraft(text.trim());
        setEnhanceMsg("polished ✶");
        setTimeout(() => setEnhanceMsg(""), 2000);
      }
    } catch (e) {
      setEnhanceMsg("couldn't reach the muse");
      setTimeout(() => setEnhanceMsg(""), 2500);
    } finally {
      setEnhancing(false);
    }
  }

  function handleDownload() {
    const slug = (answers.name || "my-skill").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "my-skill";
    const blob = new Blob([skillMd], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug}.SKILL.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

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

            {isDone && (
              <DoneCard
                onDownload={handleDownload}
                onCopy={handleCopy}
                onReset={handleReset}
                msg={enhanceMsg}
                name={answers.name}
              />
            )}
          </section>

          <section className="right">
            <PreviewPane ref={previewRef} md={skillMd} answers={answers} />
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
          Teach Claude
          <br />
          a new <em>trick</em>
          <Underline className="title-underline" />
          <span className="hero-flourish">
            <Star size={36} />
          </span>
        </h1>
        <p className="lede">
          A skill is a little instruction card you hand to Claude — so it knows
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

        <div className="hero-ticker">
          <div className="ticker-track">
            {["• guided interview", "• polished by Claude", "• markdown out", "• drop into Claude.ai or Code", "• guided interview", "• polished by Claude", "• markdown out", "• drop into Claude.ai or Code"].map((t, i) => (
              <span key={i}>{t}</span>
            ))}
          </div>
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
            title="Polish with Claude"
          >
            <span className="enhance-glyph">✶</span>
            {enhancing ? "polishing…" : "polish with claude"}
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

// ----- Done card -----
function DoneCard({ onDownload, onCopy, onReset, msg, name }) {
  return (
    <div className="qcard done-card">
      <div className="done-stamp">
        <Star size={42} />
      </div>
      <h2 className="question">
        Your skill is forged.
      </h2>
      <p className="qhint" style={{ marginBottom: 24 }}>
        Take <em>{name || "your skill"}</em> home as a Markdown file. Drop it
        into <code>~/.claude/skills/</code> or upload to Claude.ai.
      </p>

      <div className="done-actions">
        <button className="primary-btn big" onClick={onDownload}>
          ↓ download SKILL.md
        </button>
        <button className="ghost-btn" onClick={onCopy}>copy text</button>
        <button className="link-btn" onClick={onReset}>forge another</button>
      </div>

      {msg && <div className="enhance-msg" style={{ marginTop: 14 }}>{msg}</div>}

      <div className="next-steps">
        <h4>what to do next</h4>
        <ol>
          <li>Save the file as <code>SKILL.md</code> in a folder named after your skill.</li>
          <li>Move that folder into <code>~/.claude/skills/</code> (Claude Code) or upload to claude.ai.</li>
          <li>Start a new chat and watch Claude pick it up automatically.</li>
        </ol>
      </div>
    </div>
  );
}

// ----- Preview pane -----
const PreviewPane = React.forwardRef<any, any>(({ md, answers }, ref) => {
  return (
    <div className="preview" ref={ref}>
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
        <span>live preview</span>
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
          <h3>Claude polishes your words.</h3>
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
        <span>made for non-coders who want claude to do things their way</span>
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
