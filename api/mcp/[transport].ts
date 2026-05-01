import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import {
  optimizeSkillDescription,
  polishSkillField,
  researchSkill,
  runSkillPipeline,
  synthesizeSkill,
  testSkillTrigger,
  type SkillAnswers,
} from "../skill-pipeline.js";
import { searchSkills } from "../skill-registry.js";

export const runtime = "nodejs";

function textResult(payload: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
    ...(isError ? { isError: true } : {}),
  };
}

const answersSchema = {
  name: z.string().optional(),
  purpose: z.string().optional(),
  trigger: z.string().optional(),
  steps: z.string().optional(),
  gotchas: z.string().optional(),
  example: z.string().optional(),
};

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "search_skills",
      {
        title: "Search agent skill registry",
        description:
          "Find existing SKILL.md files on GitHub matching a topic. Returns deduped repo hits with name, repo full-name, and URL. Use this before writing a new skill.",
        inputSchema: {
          query: z
            .string()
            .min(1)
            .describe("Search terms describing the skill purpose or domain"),
          limit: z
            .number()
            .int()
            .min(1)
            .max(10)
            .optional()
            .describe("Max results (default 5)"),
        },
      },
      async ({ query, limit }) => {
        const cap = limit ?? 5;
        try {
          const hits = await searchSkills(query, cap);
          return textResult(
            hits.length === 0
              ? { hits: [], message: "No SKILL.md files found for this query." }
              : { hits }
          );
        } catch (e: any) {
          return textResult(
            {
              hits: [],
              error: e?.message ?? String(e),
            },
            true
          );
        }
      }
    );

    server.registerTool(
      "polish_skill_field",
      {
        title: "Polish one skill field",
        description:
          "Polish a single skill interview field the same way the webpage's 'polish with skillsmith' action does.",
        inputSchema: {
          field: z
            .enum(["name", "purpose", "trigger", "steps", "gotchas", "example"])
            .describe("Which skill field to polish"),
          draft: z.string().min(1).describe("The user's current draft for that field"),
          prior_answers: z
            .object(answersSchema)
            .optional()
            .describe("Any earlier interview answers for context"),
        },
      },
      async ({ field, draft, prior_answers }) => {
        try {
          const value = await polishSkillField({
            field,
            draft,
            priorAnswers: prior_answers,
          });
          return textResult({ value });
        } catch (e: any) {
          return textResult({ error: e?.message ?? String(e) }, true);
        }
      }
    );

    server.registerTool(
      "research_skill",
      {
        title: "Research a skill domain",
        description:
          "Run the webpage's research stage: pull prior-art skill hits and do web research to produce findings, pitfalls, and sources.",
        inputSchema: {
          name: z.string().optional().describe("Skill name"),
          purpose: z.string().optional().describe("One-sentence skill purpose"),
          trigger: z.string().optional().describe("When the skill should trigger"),
        },
      },
      async ({ name, purpose, trigger }) => {
        try {
          const result = await researchSkill({ name, purpose, trigger });
          return textResult({
            registry_hits: result.registryHits,
            research_notes: result.researchNotes,
            research_sources: result.sources,
          });
        } catch (e: any) {
          return textResult({ error: e?.message ?? String(e) }, true);
        }
      }
    );

    server.registerTool(
      "synthesize_skill",
      {
        title: "Synthesize SKILL.md",
        description:
          "Run the webpage's synthesis stage to turn interview answers into a complete SKILL.md, optionally grounded in prior research notes.",
        inputSchema: {
          answers: z
            .object(answersSchema)
            .describe("Interview answers for name, purpose, trigger, steps, gotchas, and example"),
          research_notes: z
            .string()
            .optional()
            .describe("Structured research notes from the research stage"),
        },
      },
      async ({ answers, research_notes }) => {
        try {
          const skill_md = await synthesizeSkill({
            answers: answers as SkillAnswers,
            researchNotes: research_notes,
          });
          return textResult({ skill_md });
        } catch (e: any) {
          return textResult({ error: e?.message ?? String(e) }, true);
        }
      }
    );

    server.registerTool(
      "optimize_skill_description",
      {
        title: "Sharpen skill trigger description",
        description:
          "Run the webpage's description-optimization stage on a SKILL.md and optionally feed in phrasings that previously failed to trigger.",
        inputSchema: {
          skill_md: z.string().min(1).describe("The full SKILL.md content"),
          failed_cases: z
            .array(z.string().min(1))
            .optional()
            .describe("User request phrasings the current description failed to trigger on"),
        },
      },
      async ({ skill_md, failed_cases }) => {
        try {
          const optimized = await optimizeSkillDescription({
            skillMd: skill_md,
            failedCases: failed_cases,
          });
          return textResult({
            ...optimized,
          });
        } catch (e: any) {
          return textResult({ error: e?.message ?? String(e) }, true);
        }
      }
    );

    server.registerTool(
      "test_skill_trigger",
      {
        title: "Stress-test a skill trigger",
        description:
          "Run the webpage's trigger self-test stage. Generates obvious-positive and adjacent-negative user requests and judges whether the description would fire.",
        inputSchema: {
          skill_md: z
            .string()
            .optional()
            .describe("Full SKILL.md content; if provided, name and description are read from frontmatter"),
          name: z.string().optional().describe("Skill name override"),
          description: z.string().optional().describe("Description override"),
        },
      },
      async ({ skill_md, name, description }) => {
        try {
          const result = await testSkillTrigger({
            skillMd: skill_md,
            name,
            description,
          });
          return textResult(result);
        } catch (e: any) {
          return textResult({ error: e?.message ?? String(e) }, true);
        }
      }
    );

    server.registerTool(
      "run_skill_pipeline",
      {
        title: "Run the full Skillsmith pipeline",
        description:
          "Run the same staged workflow as the webpage: research, synthesize SKILL.md, optimize its description, and stress-test the trigger.",
        inputSchema: {
          answers: z
            .object(answersSchema)
            .describe("Interview answers for name, purpose, trigger, steps, gotchas, and example"),
        },
      },
      async ({ answers }) => {
        try {
          const result = await runSkillPipeline({
            answers: answers as SkillAnswers,
          });
          return textResult({
            registry_hits: result.registryHits,
            research_notes: result.researchNotes,
            research_sources: result.researchSources,
            research_error: result.researchError,
            skill_md: result.skillMd,
            optimized_description: result.optimizedDescription,
            optimize_error: result.optimizeError,
            trigger_tests: result.triggerTests,
            trigger_test_error: result.triggerTestError,
            final_skill_md: result.finalSkillMd,
          });
        } catch (e: any) {
          return textResult({ error: e?.message ?? String(e) }, true);
        }
      }
    );
  },
  {},
  {
    basePath: "/api/mcp",
    maxDuration: 60,
  }
);

export default handler;
