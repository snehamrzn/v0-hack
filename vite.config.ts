import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { IncomingMessage, ServerResponse } from "node:http";

// Dev-only middleware that mounts api/chat.ts at /api/chat,
// matching the Vercel serverless function shape so the same file works in prod.
function apiDevMiddleware(): Plugin {
  return {
    name: "api-dev-middleware",
    configureServer(server) {
      server.middlewares.use(
        "/api/chat",
        async (req: IncomingMessage, res: ServerResponse) => {
          try {
            const mod = await server.ssrLoadModule("/api/chat.ts");
            const handler = mod.default as (req: Request) => Promise<Response>;

            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(chunk as Buffer);
            const body = Buffer.concat(chunks);

            const url = `http://localhost${req.url ?? "/api/chat"}`;
            const headers = new Headers();
            for (const [k, v] of Object.entries(req.headers)) {
              if (typeof v === "string") headers.set(k, v);
              else if (Array.isArray(v)) headers.set(k, v.join(", "));
            }

            const request = new Request(url, {
              method: req.method,
              headers,
              body:
                req.method === "GET" || req.method === "HEAD"
                  ? undefined
                  : body,
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
          } catch (err: any) {
            console.error("[/api/chat] error:", err);
            if (!res.headersSent) {
              res.statusCode = 500;
              res.setHeader("content-type", "application/json");
            }
            res.end(JSON.stringify({ error: err?.message ?? "Server error" }));
          }
        }
      );
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
