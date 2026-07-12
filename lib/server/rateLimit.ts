type RateLimitRule = {
  key: string;
  limit: number;
  windowMs: number;
};

type Bucket = {
  count: number;
  resetAt: number;
};

type RateLimitResult =
  | { ok: true; remaining: number; resetAt: number }
  | { ok: false; retryAfter: number; resetAt: number };

const buckets = new Map<string, Bucket>();

function nowMs() {
  return Date.now();
}

function cleanupExpiredBuckets(now: number) {
  if (buckets.size < 5000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function clientIpFromRequest(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export function rateLimit(rule: RateLimitRule): RateLimitResult {
  const now = nowMs();
  cleanupExpiredBuckets(now);

  const bucket = buckets.get(rule.key);
  if (!bucket || bucket.resetAt <= now) {
    const resetAt = now + rule.windowMs;
    buckets.set(rule.key, { count: 1, resetAt });
    return { ok: true, remaining: Math.max(0, rule.limit - 1), resetAt };
  }

  if (bucket.count >= rule.limit) {
    return {
      ok: false,
      retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      resetAt: bucket.resetAt,
    };
  }

  bucket.count += 1;
  return { ok: true, remaining: Math.max(0, rule.limit - bucket.count), resetAt: bucket.resetAt };
}

export function rateLimitResponse(result: Extract<RateLimitResult, { ok: false }>) {
  return Response.json(
    { ok: false, reason: `Too many requests. Try again in ${result.retryAfter}s.` },
    {
      status: 429,
      headers: {
        "retry-after": String(result.retryAfter),
        "x-ratelimit-reset": new Date(result.resetAt).toISOString(),
      },
    },
  );
}
