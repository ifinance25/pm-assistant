import type { Db } from "../db/index.ts";
import { createDb, setDb } from "../db/index.ts";
import { hashPassword } from "./auth/crypto.ts";
import { SESSION_COOKIE, SESSION_TTL_MS } from "./auth/session.ts";

export type TestAuth = {
  userId: string;
  email: string;
  password: string;
  sessionId: string;
  cookieHeader: string;
};

export function seedTestAuth(
  db: Db,
  opts?: { email?: string; password?: string; role?: "admin" | "user" },
): TestAuth {
  const email = opts?.email ?? "test@example.com";
  const password = opts?.password ?? "test-password";
  const user = db.createUser({
    email,
    displayName: "Тестовый пользователь",
    passwordHash: hashPassword(password),
    role: opts?.role ?? "admin",
  });
  const session = db.createSession(user.id, SESSION_TTL_MS);
  return {
    userId: user.id,
    email,
    password,
    sessionId: session.id,
    cookieHeader: `${SESSION_COOKIE}=${session.id}`,
  };
}

export function authHeaders(
  auth: TestAuth,
  extra: Record<string, string> = {},
): Record<string, string> {
  return { cookie: auth.cookieHeader, ...extra };
}

export function setupAuthedDb(): { db: Db; auth: TestAuth } {
  const db = createDb(":memory:");
  setDb(db);
  const auth = seedTestAuth(db);
  return { db, auth };
}
