import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";
import { getDb } from "../../db/index.ts";
import { fetchWithTimeout } from "../../shared/http-timeout.ts";
import { isLlmProvider, isTrackerType } from "../../shared/types.ts";
import type { AppEnv } from "../app-env.ts";
import { removeEnvVariable } from "../env-file.ts";
import { isSecureRequest } from "../auth/session.ts";
import {
  buildClaudeAuthorizeUrl,
  cursorAuthorizeUrl,
  exchangeClaudeCode,
  generatePkce,
  kimiAuthorizeUrl,
  llmEnvKey,
  llmIntegrationProvider,
  openAiAuthorizeUrl,
  saveLlmToken,
} from "../llm-oauth.ts";

export const integrationsRouter = new Hono<AppEnv>();

const LLM_OAUTH_COOKIE = "pm_assistant_llm_oauth";
const STUB_NOTICE = "заглушка: OAuth не настроен";
export const CALENDAR_OAUTH_STATE_COOKIE = "pm_assistant_calendar_oauth_state";
const CALENDAR_SCOPE =
  "openid email https://www.googleapis.com/auth/calendar.events.readonly";
const CALENDAR_TOKEN_TTL_DEFAULT_SEC = 3600;

function cookieSecure(c: Context): boolean {
  return isSecureRequest({ get: (name) => c.req.header(name) });
}

function readGoogleCalendarConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() ?? "";
  const redirectUri =
    process.env.PM_ASSISTANT_GOOGLE_CALENDAR_REDIRECT_URI?.trim() ||
    "http://127.0.0.1:8787/api/integrations/google-calendar/callback";
  return { clientId, clientSecret, redirectUri };
}

function trackerProvider(type: string): string {
  return `tracker:${type}`;
}

integrationsRouter.get("/tracker/:type/start", (c) => {
  const type = c.req.param("type");
  if (!isTrackerType(type)) {
    return c.json({ error: "неизвестный трекер" }, 400);
  }
  return c.json({
    ok: true,
    provider: trackerProvider(type),
    connected: false,
    stub: true,
    notice: STUB_NOTICE,
  });
});

integrationsRouter.get("/tracker/:type/callback", (c) => {
  const type = c.req.param("type");
  if (!isTrackerType(type)) {
    return c.json({ error: "неизвестный трекер" }, 400);
  }
  return c.redirect("/settings#integrations");
});

integrationsRouter.delete("/tracker/:type", (c) => {
  const type = c.req.param("type");
  if (!isTrackerType(type)) {
    return c.json({ error: "неизвестный трекер" }, 400);
  }
  getDb().deleteIntegrationToken(trackerProvider(type));
  return c.json({ ok: true, connected: false });
});

integrationsRouter.get("/google-calendar/start", (c) => {
  const { clientId, redirectUri } = readGoogleCalendarConfig();
  if (!clientId) {
    return c.json({ error: "Google OAuth не настроен" }, 503);
  }
  const state = crypto.randomUUID();
  setCookie(c, CALENDAR_OAUTH_STATE_COOKIE, state, {
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
    scope: CALENDAR_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

integrationsRouter.get("/google-calendar/callback", async (c) => {
  const code = c.req.query("code");
  const error = c.req.query("error");
  const state = c.req.query("state");
  const expected = getCookie(c, CALENDAR_OAUTH_STATE_COOKIE);
  setCookie(c, CALENDAR_OAUTH_STATE_COOKIE, "", {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: cookieSecure(c),
    maxAge: 0,
  });
  if (error || !code || !state || !expected || state !== expected) {
    console.error("[google-calendar] callback state check failed", {
      hasError: Boolean(error),
      hasCode: Boolean(code),
      hasState: Boolean(state),
      hasExpected: Boolean(expected),
      stateMatches: state === expected,
    });
    return c.redirect("/settings?error=google-calendar&reason=state");
  }

  const { clientId, clientSecret, redirectUri } = readGoogleCalendarConfig();
  if (!clientId || !clientSecret) {
    console.error("[google-calendar] missing clientId/clientSecret config");
    return c.redirect("/settings?error=google-calendar&reason=config");
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
    const body = await tokenRes.text().catch(() => "");
    console.error("[google-calendar] token exchange failed", tokenRes.status, body);
    return c.redirect("/settings?error=google-calendar&reason=token");
  }
  const tokenBody = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!tokenBody.access_token) {
    console.error("[google-calendar] token response missing access_token");
    return c.redirect("/settings?error=google-calendar&reason=token");
  }

  const profileRes = await fetchWithTimeout(
    "https://openidconnect.googleapis.com/v1/userinfo",
    { headers: { authorization: `Bearer ${tokenBody.access_token}` } },
  );
  if (!profileRes.ok) {
    const body = await profileRes.text().catch(() => "");
    console.error("[google-calendar] profile fetch failed", profileRes.status, body);
    return c.redirect("/settings?error=google-calendar&reason=profile");
  }
  const profile = (await profileRes.json()) as { email?: string };
  if (!profile.email) {
    console.error("[google-calendar] profile response missing email");
    return c.redirect("/settings?error=google-calendar&reason=profile");
  }

  const ttlSec =
    typeof tokenBody.expires_in === "number"
      ? tokenBody.expires_in
      : CALENDAR_TOKEN_TTL_DEFAULT_SEC;
  getDb().upsertIntegrationToken("google_calendar", {
    accessToken: tokenBody.access_token,
    refreshToken: tokenBody.refresh_token ?? null,
    expiresAt: new Date(Date.now() + ttlSec * 1000).toISOString(),
    meta: { email: profile.email },
  });

  return c.redirect("/settings#integrations");
});

integrationsRouter.delete("/google-calendar", (c) => {
  getDb().deleteIntegrationToken("google_calendar");
  return c.json({ ok: true, connected: false });
});

integrationsRouter.get("/llm/:provider/start", (c) => {
  const provider = c.req.param("provider");
  if (!isLlmProvider(provider)) {
    return c.json({ error: "неизвестный провайдер LLM" }, 400);
  }
  if (provider === "claude") {
    const pkce = generatePkce();
    setCookie(c, LLM_OAUTH_COOKIE, JSON.stringify({ provider, verifier: pkce.verifier }), {
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      maxAge: 600,
    });
    return c.json({
      ok: true,
      provider,
      authUrl: buildClaudeAuthorizeUrl(pkce),
      manualCode: true,
      instructions:
        "Войдите в Claude в открывшемся окне. Скопируйте код авторизации и вставьте его в поле ниже.",
    });
  }
  const authUrl =
    provider === "openai"
      ? openAiAuthorizeUrl()
      : provider === "kimi"
        ? kimiAuthorizeUrl()
        : cursorAuthorizeUrl();
  setCookie(c, LLM_OAUTH_COOKIE, JSON.stringify({ provider, verifier: "" }), {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    maxAge: 600,
  });
  return c.json({
    ok: true,
    provider,
    authUrl,
    manualCode: true,
    instructions:
      provider === "openai"
        ? "Создайте ключ API в OpenAI и вставьте его в поле ниже. Для подписки ChatGPT используйте ключ с доступом к API."
        : provider === "kimi"
          ? "Создайте ключ API на platform.moonshot.cn и вставьте его в поле ниже."
          : "Создайте User API Key в Cursor Dashboard → API Keys и вставьте его в поле ниже.",
  });
});

integrationsRouter.post("/llm/:provider/complete", async (c) => {
  const provider = c.req.param("provider");
  if (!isLlmProvider(provider)) {
    return c.json({ error: "неизвестный провайдер LLM" }, 400);
  }
  let body: { code?: unknown; token?: unknown };
  try {
    body = (await c.req.json()) as { code?: unknown; token?: unknown };
  } catch {
    return c.json({ error: "нужен JSON" }, 400);
  }
  const rawCookie = getCookie(c, LLM_OAUTH_COOKIE);
  setCookie(c, LLM_OAUTH_COOKIE, "", { path: "/", maxAge: 0 });
  let verifier = "";
  if (rawCookie) {
    try {
      const parsed = JSON.parse(rawCookie) as { provider?: string; verifier?: string };
      if (parsed.provider === provider && parsed.verifier) {
        verifier = parsed.verifier;
      }
    } catch {
      // cookie повреждён
    }
  }
  let accessToken = "";
  if (provider === "claude") {
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!code || !verifier) {
      return c.json({ error: "нужен код авторизации Claude" }, 400);
    }
    try {
      const tokens = await exchangeClaudeCode(code, verifier);
      accessToken = tokens.access_token;
    } catch (err) {
      const message = err instanceof Error ? err.message : "обмен кода не удался";
      return c.json({ error: message }, 502);
    }
  } else {
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token) {
      return c.json({ error: "нужен токен" }, 400);
    }
    accessToken = token;
  }
  const db = getDb();
  db.upsertIntegrationToken(llmIntegrationProvider(provider), {
    accessToken,
    meta: { savedAt: new Date().toISOString() },
  });
  saveLlmToken(provider, accessToken);
  return c.json({ ok: true, connected: true, provider });
});

integrationsRouter.delete("/llm/:provider", (c) => {
  const provider = c.req.param("provider");
  if (!isLlmProvider(provider)) {
    return c.json({ error: "неизвестный провайдер LLM" }, 400);
  }
  getDb().deleteIntegrationToken(llmIntegrationProvider(provider));
  removeEnvVariable(llmEnvKey(provider));
  return c.json({ ok: true, connected: false });
});
