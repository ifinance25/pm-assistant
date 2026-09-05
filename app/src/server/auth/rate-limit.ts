type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_MAX_ATTEMPTS = 10;

export function loginAttemptKey(email: string, ip: string): string {
  return `${email.trim().toLowerCase()}|${ip || "local"}`;
}

export function consumeLoginAttempt(
  key: string,
  now = Date.now(),
): { ok: true } | { ok: false; retryAfterSec: number } {
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return { ok: true };
  }
  if (current.count >= LOGIN_MAX_ATTEMPTS) {
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }
  current.count += 1;
  return { ok: true };
}

export function resetLoginAttempts(key: string): void {
  buckets.delete(key);
}

export function clearLoginRateLimit(): void {
  buckets.clear();
}
