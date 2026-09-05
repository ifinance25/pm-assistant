import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { app } from "./app.ts";
import { authHeaders, setupAuthedDb } from "./test-auth.ts";
import { CALENDAR_OAUTH_STATE_COOKIE } from "./routes/integrations.ts";

describe("Integrations stubs", () => {
  let db: ReturnType<typeof setupAuthedDb>["db"];
  let auth: ReturnType<typeof setupAuthedDb>["auth"];

  afterEach(() => {
    db?.close();
    vi.unstubAllGlobals();
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });

  it("подключает и отключает трекер ClickUp", async () => {
    ({ db, auth } = setupAuthedDb());
    const start = await app.request("/api/integrations/tracker/clickup/start", {
      headers: authHeaders(auth),
    });
    expect(start.status).toBe(200);
    expect(await start.json()).toMatchObject({
      ok: true,
      provider: "tracker:clickup",
      connected: false,
      stub: true,
    });
    expect(db.isIntegrationConnected("tracker:clickup")).toBe(false);

    const stop = await app.request("/api/integrations/tracker/clickup", {
      method: "DELETE",
      headers: authHeaders(auth),
    });
    expect(stop.status).toBe(200);
    expect(db.isIntegrationConnected("tracker:clickup")).toBe(false);
  });

  it("отклоняет неизвестный трекер", async () => {
    ({ db, auth } = setupAuthedDb());
    const res = await app.request("/api/integrations/tracker/jira/start", {
      headers: authHeaders(auth),
    });
    expect(res.status).toBe(400);
  });

  it("без GOOGLE_CLIENT_ID отвечает 503", async () => {
    ({ db, auth } = setupAuthedDb());
    delete process.env.GOOGLE_CLIENT_ID;
    const start = await app.request("/api/integrations/google-calendar/start", {
      headers: authHeaders(auth),
    });
    expect(start.status).toBe(503);
    expect(await start.json()).toMatchObject({ error: "Google OAuth не настроен" });
  });

  it("с GOOGLE_CLIENT_ID уводит на согласие Google и кладёт state в cookie", async () => {
    ({ db, auth } = setupAuthedDb());
    process.env.GOOGLE_CLIENT_ID = "test-client";
    const start = await app.request("/api/integrations/google-calendar/start", {
      headers: authHeaders(auth),
    });
    expect(start.status).toBe(302);
    expect(start.headers.get("location")).toContain("accounts.google.com");
    expect(start.headers.get("set-cookie") ?? "").toContain(CALENDAR_OAUTH_STATE_COOKIE);
  });

  it("callback меняет код на токены и сохраняет почту, затем отключение удаляет токен", async () => {
    ({ db, auth } = setupAuthedDb());
    process.env.GOOGLE_CLIENT_ID = "id";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/token")) {
          return new Response(
            JSON.stringify({
              access_token: "access-1",
              refresh_token: "refresh-1",
              expires_in: 3600,
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ email: "user@example.com" }), {
          status: 200,
        });
      }),
    );
    const callback = await app.request(
      "/api/integrations/google-calendar/callback?code=ok&state=st",
      { headers: authHeaders(auth, { cookie: `${auth.cookieHeader}; ${CALENDAR_OAUTH_STATE_COOKIE}=st` }) },
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("/settings#integrations");
    expect(db.isIntegrationConnected("google_calendar")).toBe(true);
    expect(db.getIntegrationToken("google_calendar")?.meta.email).toBe(
      "user@example.com",
    );

    const stop = await app.request("/api/integrations/google-calendar", {
      method: "DELETE",
      headers: authHeaders(auth),
    });
    expect(stop.status).toBe(200);
    expect(db.isIntegrationConnected("google_calendar")).toBe(false);
  });

  it("callback без валидного state редиректит на settings с ошибкой", async () => {
    ({ db, auth } = setupAuthedDb());
    const callback = await app.request(
      "/api/integrations/google-calendar/callback?code=ok&state=nope",
      { headers: authHeaders(auth) },
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("/settings?error=google-calendar");
    expect(db.isIntegrationConnected("google_calendar")).toBe(false);
  });

  it("callback трекера без сессии редиректит на настройки", async () => {
    ({ db, auth } = setupAuthedDb());
    const res = await app.request("/api/integrations/tracker/notion/callback");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/settings#integrations");
    expect(db.isIntegrationConnected("tracker:notion")).toBe(false);
  });

  it("сохраняет токен OpenAI в .env и integration_tokens", async () => {
    ({ db, auth } = setupAuthedDb());
    const dir = mkdtempSync(join(tmpdir(), "pm-assistant-env-"));
    const envPath = join(dir, ".env");
    const prev = process.env.PM_ASSISTANT_ENV_FILE;
    process.env.PM_ASSISTANT_ENV_FILE = envPath;
    try {
      const start = await app.request("/api/integrations/llm/openai/start", {
        headers: authHeaders(auth),
      });
      expect(start.status).toBe(200);
      const cookie = start.headers.get("set-cookie") ?? "";
      const oauthCookie = cookie.split(";")[0] ?? "";
      const complete = await app.request("/api/integrations/llm/openai/complete", {
        method: "POST",
        headers: {
          ...authHeaders(auth),
          "content-type": "application/json",
          cookie: `${auth.cookieHeader}; ${oauthCookie}`,
        },
        body: JSON.stringify({ token: "sk-test-token" }),
      });
      expect(complete.status).toBe(200);
      expect(db.isIntegrationConnected("llm:openai")).toBe(true);
      expect(readFileSync(envPath, "utf8")).toContain("OPENAI_API_KEY=sk-test-token");
      expect(process.env.OPENAI_API_KEY).toBe("sk-test-token");
    } finally {
      if (prev === undefined) {
        delete process.env.PM_ASSISTANT_ENV_FILE;
      } else {
        process.env.PM_ASSISTANT_ENV_FILE = prev;
      }
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });
});
