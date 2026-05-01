import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { searchSkills } from "../skill-registry";

// Skill Registry MCP server. Exposes one tool, `search_skills`, that proxies
// GitHub Code Search to find existing SKILL.md files matching a topic.
// Other agents can install this MCP server to discover prior-art skills before
// authoring new ones; Skillsmith uses it internally during the research stage
// and to power the find-or-build screen.

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "search_skills",
      {
        title: "Search agent skill registry",
        description:
          "Find existing SKILL.md files on GitHub matching a topic. Returns deduped repo hits with name, repo full-name, and URL. Use this to check if a skill already exists before writing a new one.",
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
          const payload =
            hits.length === 0
              ? { hits: [], message: "No SKILL.md files found for this query." }
              : { hits };
          return {
            content: [{ type: "text", text: JSON.stringify(payload) }],
          };
        } catch (e: any) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  hits: [],
                  error: e?.message ?? String(e),
                }),
              },
            ],
            isError: true,
          };
        }
      }
    );
  },
  {},
  {
    basePath: "/api/mcp",
    maxDuration: 30,
  }
);

export default handler;
