import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { app } from "./app.ts";
import { authHeaders, setupAuthedDb } from "./test-auth.ts";

describe("GET/PUT /api/settings", () => {
  let db: ReturnType<typeof setupAuthedDb>["db"];
  let auth: ReturnType<typeof setupAuthedDb>["auth"];

  afterEach(() => {
    db?.close();
  });

  it("читает настройки из базы и сохраняет правку", async () => {
    ({ db, auth } = setupAuthedDb());
    const initial = await app.request("/api/settings", {
      headers: authHeaders(auth),
    });
    expect(initial.status).toBe(200);
    expect(await initial.json()).toMatchObject({
      recordingModeDefault: "text",
      asanaAutoSend: false,
      trackerType: "clickup",
    });

    const updated = await app.request("/api/settings", {
      method: "PUT",
      headers: authHeaders(auth, { "content-type": "application/json" }),
      body: JSON.stringify({ recordingModeDefault: "full" }),
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      recordingModeDefault: "full",
    });
    expect(db.getSettings().recordingModeDefault).toBe("full");
  });

  it("принимает обратно свой же ответ GET (круговой запрос)", async () => {
    ({ db, auth } = setupAuthedDb());
    const before = await app.request("/api/settings", {
      headers: authHeaders(auth),
    });
    const body = (await before.json()) as Record<string, unknown>;
    expect(body.googleClientId).toBe("");

    const back = await app.request("/api/settings", {
      method: "PUT",
      headers: authHeaders(auth, { "content-type": "application/json" }),
      body: JSON.stringify(body),
    });
    expect(back.status).toBe(200);
    expect(await back.json()).toMatchObject({
      recordingModeDefault: body.recordingModeDefault,
      trackerType: body.trackerType,
      llmProvider: body.llmProvider,
    });
  });

  it("пустой Google Client ID при пустом текущем не считается ошибкой", async () => {
    ({ db, auth } = setupAuthedDb());
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: authHeaders(auth, { "content-type": "application/json" }),
      body: JSON.stringify({ googleClientId: "", googleClientSecret: "" }),
    });
    expect(res.status).toBe(200);
  });

  it("сохраняет Google Client ID/Secret в .env и возвращает статус", async () => {
    ({ db, auth } = setupAuthedDb());
    const dir = mkdtempSync(join(tmpdir(), "pm-assistant-env-"));
    const envPath = join(dir, ".env");
    const prev = process.env.PM_ASSISTANT_ENV_FILE;
    process.env.PM_ASSISTANT_ENV_FILE = envPath;
    try {
      const before = await app.request("/api/settings", {
        headers: authHeaders(auth),
      });
      expect(await before.json()).toMatchObject({
        googleClientId: "",
        googleClientSecretSet: false,
      });

      const updated = await app.request("/api/settings", {
        method: "PUT",
        headers: authHeaders(auth, { "content-type": "application/json" }),
        body: JSON.stringify({
          googleClientId: "client-123.apps.googleusercontent.com",
          googleClientSecret: "shh-secret",
        }),
      });
      expect(updated.status).toBe(200);
      expect(await updated.json()).toMatchObject({
        googleClientId: "client-123.apps.googleusercontent.com",
        googleClientSecretSet: true,
      });
      expect(readFileSync(envPath, "utf8")).toContain(
        "GOOGLE_CLIENT_ID=client-123.apps.googleusercontent.com",
      );
      expect(readFileSync(envPath, "utf8")).toContain(
        "GOOGLE_CLIENT_SECRET=shh-secret",
      );
      expect(process.env.GOOGLE_CLIENT_ID).toBe(
        "client-123.apps.googleusercontent.com",
      );

      const emptySecret = await app.request("/api/settings", {
        method: "PUT",
        headers: authHeaders(auth, { "content-type": "application/json" }),
        body: JSON.stringify({ googleClientSecret: "" }),
      });
      expect(emptySecret.status).toBe(400);
    } finally {
      if (prev === undefined) {
        delete process.env.PM_ASSISTANT_ENV_FILE;
      } else {
        process.env.PM_ASSISTANT_ENV_FILE = prev;
      }
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });
});
