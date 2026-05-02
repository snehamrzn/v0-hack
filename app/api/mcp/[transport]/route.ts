import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { searchSkills } from "@/lib/skill-registry";

export const runtime = "nodejs";
export const maxDuration = 60;

function textResult(payload: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
    ...(isError ? { isError: true } : {}),
  };
}

const DEMO_DISABLED_MSG =
  "MCP LLM tools are disabled on this public demo because the server has no Anthropic API key (it's a web demo). To use Skillsmith over MCP, self-host the project.";

function demoDisabled() {
  return textResult({ error: DEMO_DISABLED_MSG }, true);
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
      async () => demoDisabled()
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
      async () => demoDisabled()
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
      async () => demoDisabled()
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
      async () => demoDisabled()
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
      async () => demoDisabled()
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
      async () => demoDisabled()
    );
  },
  {},
  {
    basePath: "/api/mcp",
    maxDuration: 60,
  }
);

export { handler as GET, handler as POST };
