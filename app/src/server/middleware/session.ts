import type { Context, Next } from "hono";
import { readSessionRole, readSessionUserId } from "../routes/auth.ts";
import type { AppEnv } from "../app-env.ts";

const PUBLIC_API_PREFIXES = [
  "/api/health",
  "/api/auth/login",
  "/api/auth/google/start",
  "/api/auth/google/callback",
];

function isPublicApi(path: string): boolean {
  if (path.startsWith("/api/public")) {
    return true;
  }
  if (path.startsWith("/api/audio-share/")) {
    return true;
  }
  if (/^\/api\/integrations\/tracker\/[^/]+\/callback$/.test(path)) {
    return true;
  }
  return PUBLIC_API_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

export async function sessionMiddleware(
  c: Context<AppEnv>,
  next: Next,
): Promise<Response | void> {
  const path = c.req.path;
  if (!path.startsWith("/api/") || isPublicApi(path)) {
    await next();
    return;
  }

  const userId = readSessionUserId(c);
  if (!userId) {
    return c.json({ error: "нужна сессия" }, 401);
  }

  c.set("userId", userId);
  c.set("userRole", readSessionRole(c) ?? "user");
  await next();
}
