// Skill share storage. Production uses Upstash Redis (either via Vercel KV
// or Upstash directly); dev falls back to an in-memory Map so localhost
// "just works" without provisioning anything. Keys auto-expire after 90 days.
//
// To enable Redis in production, set EITHER:
//   - KV_REST_API_URL + KV_REST_API_TOKEN (Vercel KV defaults), OR
//   - UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (Upstash defaults)
// The two are interchangeable — Vercel KV is Upstash under the hood.

import { Redis } from "@upstash/redis";

const memCache = new Map<string, string>();
const TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days

function getRedisClient(): Redis | null {
  const url =
    process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  // automaticDeserialization defaults to true, which JSON-parses any value
  // that looks like JSON on read. Our values ARE JSON strings (skill records),
  // so auto-parsing means /api/skill ends up serializing an object back into
  // "[object Object]". Disabling keeps values as raw strings.
  return new Redis({ url, token, automaticDeserialization: false });
}

let cachedClient: Redis | null | undefined;
function redis(): Redis | null {
  if (cachedClient === undefined) cachedClient = getRedisClient();
  return cachedClient;
}

// 8-char base36 ID. ~2.8 trillion combinations — collision probability is
// negligible at our expected volume (a low-traffic side project). If we ever
// scale, bump to 12 chars.
function generateId(): string {
  const part = () => Math.random().toString(36).slice(2, 6).padStart(4, "0");
  return part() + part();
}

export async function saveSkill(content: string): Promise<string> {
  const id = generateId();
  const client = redis();
  if (client) {
    await client.set(id, content, { ex: TTL_SECONDS });
  } else {
    memCache.set(id, content);
  }
  return id;
}

export async function loadSkill(id: string): Promise<string | null> {
  const client = redis();
  if (client) {
    const value = await client.get<string>(id);
    return value ?? null;
  }
  return memCache.get(id) ?? null;
}
