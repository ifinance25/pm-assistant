import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";
import { getDb } from "../../db/index.ts";
import { fetchWithTimeout } from "../../shared/http-timeout.ts";
import type { SessionInfo, TrackerType, UserRole } from "../../shared/types.ts";
import { hashPassword, verifyPassword } from "../auth/crypto.ts";
import { isEmailAllowed, normalizeEmail } from "../auth/allowlist.ts";
import {
  consumeLoginAttempt,
  loginAttemptKey,
  resetLoginAttempts,
} from "../auth/rate-limit.ts";
import {
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  isSecureRequest,
  userInitials,
} from "../auth/session.ts";
import type { AppEnv } from "../app-env.ts";

const GOOGLE_AUTH_SCOPES = ["openid", "email", "profile"].join(" ");
const TIMING_DUMMY_HASH = hashPassword("pm-assistant-timing-dummy");

function readGoogleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() ?? "";
  const redirectUri =
    process.env.PM_ASSISTANT_GOOGLE_REDIRECT_URI?.trim() ||
    "http://127.0.0.1:8787/api/auth/google/callback";
  return { clientId, clientSecret, redirectUri };
}

function trackerConnected(type: TrackerType): boolean {
  return getDb().isIntegrationConnected(`tracker:${type}`);
}

function buildSessionInfo(userId: string): SessionInfo | null {
  const db = getDb();
  const user = db.getUserById(userId);
  if (!user) {
    return null;
  }
  const settings = db.getSettings();
  return {
    user,
    integrations: {
      tracker: settings.trackerType,
      trackerConnected: trackerConnected(settings.trackerType),
      googleCalendar: db.isIntegrationConnected("google_calendar"),
    },
  };
}

function cookieSecure(c: Context): boolean {
  return isSecureRequest({
    get: (name) => c.req.header(name),
  });
}

function setSessionCookie(c: Context, sessionId: string, expiresAt: string): void {
  setCookie(c, SESSION_COOKIE, sessionId, {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: cookieSecure(c),
    expires: new Date(expiresAt),
  });
}

function clientIp(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "local";
  }
  return "local";
}

export const authRouter = new Hono<AppEnv>();

authRouter.post("/login", async (c) => {
  const ip = clientIp(c);
  let email = "";
  let password = "";
  try {
    const body = await c.req.json<{ email?: string; password?: string }>();
    email = body.email?.trim() ?? "";
    password = body.password ?? "";
  } catch {
    return c.json({ error: "нужен JSON" }, 400);
  }
  if (!email || !password) {
    return c.json({ error: "нужны email и пароль" }, 400);
  }

  const limitKey = loginAttemptKey(email, ip);
  const limited = consumeLoginAttempt(limitKey);
  if (!limited.ok) {
    c.header("Retry-After", String(limited.retryAfterSec));
    return c.json({ error: "слишком много попыток входа" }, 429);
  }

  const account = getDb().getUserByEmail(email);
  const passwordOk = verifyPassword(
    password,
    account?.passwordHash ?? TIMING_DUMMY_HASH,
  );
  if (!account || !passwordOk || !isEmailAllowed(account.email)) {
    return c.json({ error: "неверный email или пароль" }, 401);
  }

  resetLoginAttempts(limitKey);
  const session = getDb().createSession(account.id, SESSION_TTL_MS);
  setSessionCookie(c, session.id, session.expiresAt);
  const info = buildSessionInfo(account.id);
  if (!info) {
    return c.json({ error: "сессия не создана" }, 500);
  }
  return c.json(info);
});

authRouter.post("/logout", (c) => {
  const sessionId = getCookie(c, SESSION_COOKIE);
  if (sessionId) {
    getDb().destroySession(sessionId);
  }
  setCookie(c, SESSION_COOKIE, "", {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: cookieSecure(c),
    maxAge: 0,
  });
  return c.json({ ok: true });
});

authRouter.post("/password", async (c) => {
  const userId = c.get("userId");
  if (!userId) {
    return c.json({ error: "нужна сессия" }, 401);
  }
  let currentPassword = "";
  let newPassword = "";
  try {
    const body = await c.req.json<{
      currentPassword?: string;
      newPassword?: string;
    }>();
    currentPassword = body.currentPassword ?? "";
    newPassword = body.newPassword ?? "";
  } catch {
    return c.json({ error: "нужен JSON" }, 400);
  }
  if (!currentPassword || newPassword.length < 8) {
    return c.json({ error: "нужен текущий пароль и новый не короче 8 символов" }, 400);
  }
  const account = getDb().getUserById(userId);
  const stored = getDb().getUserByEmail(account?.email ?? "");
  if (!stored || !verifyPassword(currentPassword, stored.passwordHash)) {
    return c.json({ error: "неверный текущий пароль" }, 401);
  }
  getDb().updateUserPassword(userId, hashPassword(newPassword));
  return c.json({ ok: true });
});

authRouter.get("/session", (c) => {
  const sessionId = getCookie(c, SESSION_COOKIE);
  if (!sessionId) {
    return c.json({ error: "нужна сессия" }, 401);
  }
  const session = getDb().getSession(sessionId);
  if (!session) {
    return c.json({ error: "сессия истекла" }, 401);
  }
  const info = buildSessionInfo(session.userId);
  if (!info) {
    return c.json({ error: "пользователь не найден" }, 401);
  }
  return c.json({
    ...info,
    initials: userInitials(info.user.displayName),
  });
});

authRouter.get("/google/start", (c) => {
  const { clientId, redirectUri } = readGoogleConfig();
  if (!clientId) {
    return c.json({ error: "Google OAuth не настроен" }, 503);
  }
  const state = crypto.randomUUID();
  setCookie(c, OAUTH_STATE_COOKIE, state, {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: cookieSecure(c),
    maxAge: 600,
  });
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_AUTH_SCOPES,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

authRouter.get("/google/callback", async (c) => {
  const code = c.req.query("code");
  const error = c.req.query("error");
  const state = c.req.query("state");
  const expected = getCookie(c, OAUTH_STATE_COOKIE);
  setCookie(c, OAUTH_STATE_COOKIE, "", {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: cookieSecure(c),
    maxAge: 0,
  });
  if (error || !code) {
    return c.redirect("/login?error=google");
  }
  if (!state || !expected || state !== expected) {
    return c.redirect("/login?error=state");
  }

  const { clientId, clientSecret, redirectUri } = readGoogleConfig();
  if (!clientId || !clientSecret) {
    return c.redirect("/login?error=google");
  }

  const tokenRes = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) {
    return c.redirect("/login?error=google");
  }

  const tokenBody = (await tokenRes.json()) as { access_token?: string };
  if (!tokenBody.access_token) {
    return c.redirect("/login?error=google");
  }

  const profileRes = await fetchWithTimeout(
    "https://openidconnect.googleapis.com/v1/userinfo",
    {
      headers: { authorization: `Bearer ${tokenBody.access_token}` },
    },
  );
  if (!profileRes.ok) {
    return c.redirect("/login?error=google");
  }

  const profile = (await profileRes.json()) as {
    sub?: string;
    email?: string;
    name?: string;
    email_verified?: boolean;
  };
  if (!profile.sub || !profile.email) {
    return c.redirect("/login?error=google");
  }
  if (profile.email_verified === false) {
    return c.redirect("/login?error=unverified");
  }
  const email = normalizeEmail(profile.email);
  if (!isEmailAllowed(email)) {
    return c.redirect("/login?error=forbidden");
  }

  const db = getDb();
  let user = db.getUserByGoogleSub(profile.sub);
  if (!user) {
    const byEmail = db.getUserByEmail(email);
    if (byEmail) {
      user = db.linkUserGoogle(
        byEmail.id,
        profile.sub,
        profile.name ?? byEmail.displayName,
      );
    } else {
      return c.redirect("/login?error=forbidden");
    }
  }

  const session = db.createSession(user.id, SESSION_TTL_MS);
  setSessionCookie(c, session.id, session.expiresAt);
  return c.redirect("/");
});

export function readSessionUserId(c: Context): string | null {
  const sessionId = getCookie(c, SESSION_COOKIE);
  if (!sessionId) {
    return null;
  }
  const session = getDb().getSession(sessionId);
  return session?.userId ?? null;
}

export function readSessionRole(c: Context): UserRole | null {
  const sessionId = getCookie(c, SESSION_COOKIE);
  if (!sessionId) {
    return null;
  }
  const session = getDb().getSession(sessionId);
  return session?.user.role ?? null;
}

export function requireSession(c: Context): string | null {
  const userId = readSessionUserId(c);
  if (!userId) {
    return null;
  }
  return userId;
}

export { clearSessionCookie, sessionCookieOptions } from "../auth/session.ts";
