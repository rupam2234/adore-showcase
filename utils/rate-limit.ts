/**
 * Tiny in-memory rate limiter.
 *
 * Used by the returns endpoints. Limits per SESSION (customerId) rather than
 * IP, because these routes are authenticated: the thing we want to bound is one
 * customer spamming requests, and an IP limit would punish a whole household or
 * office behind one NAT.
 *
 * Known limitation, stated rather than hidden: the map is per server instance
 * and resets on redeploy, so on serverless it bounds a burst but is not a hard
 * global cap. That is the right trade at this scale — it costs nothing and needs
 * no new infrastructure. If it ever needs to be exact, swap `hits` for Redis or
 * Upstash; the call sites would not change.
 */

const hits = new Map<string, number[]>();

/** Bound the map so a burst of distinct keys cannot grow it without limit. */
const MAX_KEYS = 10_000;

export type RateLimitResult = {
  allowed: boolean;
  /** Requests left in the current window. */
  remaining: number;
  /** Seconds until the window frees up. */
  retryAfterSeconds: number;
};

export function rateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number }
): RateLimitResult {
  const now = Date.now();
  const windowStart = now - windowMs;
  const recent = (hits.get(key) ?? []).filter(t => t > windowStart);

  if (recent.length >= limit) {
    const retryAfterMs = recent[0]! + windowMs - now;
    hits.set(key, recent);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }

  recent.push(now);
  hits.set(key, recent);

  // Cheap eviction: drop the whole map once it is clearly oversized. Crude but
  // bounded, and far better than an unbounded Map in a long-lived process.
  if (hits.size > MAX_KEYS) hits.clear();

  return {
    allowed: true,
    remaining: limit - recent.length,
    retryAfterSeconds: 0,
  };
}
