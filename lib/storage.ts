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
const REDIS_OP_TIMEOUT_MS = 5000;

function getRedisClient(): Redis | null {
  const url =
    process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  try {
    // automaticDeserialization defaults to true, which JSON-parses any value
    // that looks like JSON on read. Our values ARE JSON strings (skill records),
    // so auto-parsing means /api/skill ends up serializing an object back into
    // "[object Object]". Disabling keeps values as raw strings.
    // retry=0 prevents the client from retrying for ~30s on a bad endpoint —
    // we'd rather fail fast and let the caller fall back to memCache.
    return new Redis({
      url,
      token,
      automaticDeserialization: false,
      retry: false,
    });
  } catch (e) {
    console.warn("[storage] Redis client construction failed:", e);
    return null;
  }
}

let cachedClient: Redis | null | undefined;
function redis(): Redis | null {
  if (cachedClient === undefined) cachedClient = getRedisClient();
  return cachedClient;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
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
    try {
      await withTimeout(
        client.set(id, content, { ex: TTL_SECONDS }),
        REDIS_OP_TIMEOUT_MS,
        "redis SET"
      );
      return id;
    } catch (e) {
      console.warn("[storage] redis SET failed, falling back to memCache:", e);
    }
  }
  memCache.set(id, content);
  return id;
}

export async function loadSkill(id: string): Promise<string | null> {
  const client = redis();
  if (client) {
    try {
      const value = await withTimeout(
        client.get<string>(id),
        REDIS_OP_TIMEOUT_MS,
        "redis GET"
      );
      return value ?? null;
    } catch (e) {
      console.warn("[storage] redis GET failed, falling back to memCache:", e);
    }
  }
  return memCache.get(id) ?? null;
}
