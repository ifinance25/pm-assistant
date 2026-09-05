import { afterEach, describe, expect, it } from "vitest";
import { app } from "./app.ts";
import { authHeaders, setupAuthedDb } from "./test-auth.ts";

describe("Integrations stubs", () => {
  let db: ReturnType<typeof setupAuthedDb>["db"];
  let auth: ReturnType<typeof setupAuthedDb>["auth"];

  afterEach(() => {
    db?.close();
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

  it("подключает и отключает Google Календарь", async () => {
    ({ db, auth } = setupAuthedDb());
    const start = await app.request("/api/integrations/google-calendar/start", {
      headers: authHeaders(auth),
    });
    expect(start.status).toBe(200);
    expect(db.isIntegrationConnected("google_calendar")).toBe(false);
    const stop = await app.request("/api/integrations/google-calendar", {
      method: "DELETE",
      headers: authHeaders(auth),
    });
    expect(stop.status).toBe(200);
    expect(db.isIntegrationConnected("google_calendar")).toBe(false);
  });

  it("callback трекера без сессии редиректит на настройки", async () => {
    ({ db, auth } = setupAuthedDb());
    const res = await app.request("/api/integrations/tracker/notion/callback");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/settings#integrations");
    expect(db.isIntegrationConnected("tracker:notion")).toBe(false);
  });
});
