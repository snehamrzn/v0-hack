import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { IncomingMessage, ServerResponse } from "node:http";

// Adapt a Node IncomingMessage/ServerResponse pair to the Web `Request`/`Response`
// shape that our Vercel serverless handlers (api/chat.ts, api/mcp/[transport].ts)
// expose. `mountPrefix` is what's stripped off req.url by Vite's prefix routing —
// we add it back so the handler sees the full pathname it would see in prod.
async function proxyToHandler(
  req: IncomingMessage,
  res: ServerResponse,
  handler: (req: Request) => Promise<Response>,
  mountPrefix: string,
): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks);

  const url = `http://localhost${mountPrefix}${req.url ?? ""}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") headers.set(k, v);
    else if (Array.isArray(v)) headers.set(k, v.join(", "));
  }

  const request = new Request(url, {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
  });

  const response = await handler(request);
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));

  if (response.body) {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
  }
  res.end();
}

// Dev-only middleware that mounts our serverless handlers at the same paths
// they get on Vercel. Each entry maps a URL prefix to the file that exports a
// default `(req: Request) => Promise<Response>` handler. We use prefix matching
// so /api/mcp catches /api/mcp/sse and /api/mcp/mcp (the [transport] segment).
function apiDevMiddleware(): Plugin {
  const routes: Array<{ prefix: string; modulePath: string }> = [
    { prefix: "/api/chat", modulePath: "/api/chat.ts" },
    { prefix: "/api/mcp", modulePath: "/api/mcp/[transport].ts" },
    { prefix: "/api/share", modulePath: "/api/share.ts" },
    { prefix: "/api/skill", modulePath: "/api/skill.ts" },
  ];

  return {
    name: "api-dev-middleware",
    configureServer(server) {
      for (const { prefix, modulePath } of routes) {
        server.middlewares.use(
          prefix,
          async (req: IncomingMessage, res: ServerResponse) => {
            try {
              const mod = await server.ssrLoadModule(modulePath);
              const handler = mod.default as (req: Request) => Promise<Response>;
              await proxyToHandler(req, res, handler, prefix);
            } catch (err: any) {
              console.error(`[${prefix}] error:`, err);
              if (!res.headersSent) {
                res.statusCode = 500;
                res.setHeader("content-type", "application/json");
              }
              res.end(JSON.stringify({ error: err?.message ?? "Server error" }));
            }
          },
        );
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  // Vite normally loads .env files into import.meta.env (client side).
  // Our serverless handler reads process.env, so we mirror non-VITE_ keys
  // into process.env for dev. (Vercel sets process.env in prod automatically.)
  const env = loadEnv(mode, process.cwd(), "");
  for (const [k, v] of Object.entries(env)) {
    if (!k.startsWith("VITE_") && process.env[k] === undefined) {
      process.env[k] = v;
    }
  }

  return {
    plugins: [react(), apiDevMiddleware()],
  };
});
