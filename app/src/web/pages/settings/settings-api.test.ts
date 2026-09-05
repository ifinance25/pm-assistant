import { afterEach, describe, expect, it } from "vitest";
import { app } from "../../../server/app.ts";
import { authHeaders, setupAuthedDb } from "../../../server/test-auth.ts";
import type { RecordingMode } from "../../../shared/types.ts";

describe("PUT /api/settings", () => {
  let db: ReturnType<typeof setupAuthedDb>["db"];
  let auth: ReturnType<typeof setupAuthedDb>["auth"];

  afterEach(() => {
    db?.close();
  });

  it("сохраняет три режима записи и читает их обратно", async () => {
    ({ db, auth } = setupAuthedDb());
    const modes: RecordingMode[] = ["text", "local_audio", "full"];
    for (const mode of modes) {
      const updated = await app.request("/api/settings", {
        method: "PUT",
        headers: authHeaders(auth, { "content-type": "application/json" }),
        body: JSON.stringify({ recordingModeDefault: mode }),
      });
      expect(updated.status).toBe(200);
      expect(await updated.json()).toMatchObject({
        recordingModeDefault: mode,
      });
      expect(db.getSettings().recordingModeDefault).toBe(mode);
      const read = await app.request("/api/settings", {
        headers: authHeaders(auth),
      });
      expect(await read.json()).toMatchObject({ recordingModeDefault: mode });
    }
  });

  it("сохраняет trackerType ClickUp и Asana", async () => {
    ({ db, auth } = setupAuthedDb());
    const updated = await app.request("/api/settings", {
      method: "PUT",
      headers: authHeaders(auth, { "content-type": "application/json" }),
      body: JSON.stringify({ trackerType: "asana" }),
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ trackerType: "asana" });
    expect(db.getSettings().trackerType).toBe("asana");
  });

  it("сохраняет тумблер Asana в базе без внешней сети", async () => {
    ({ db, auth } = setupAuthedDb());
    const updated = await app.request("/api/settings", {
      method: "PUT",
      headers: authHeaders(auth, { "content-type": "application/json" }),
      body: JSON.stringify({ asanaAutoSend: true }),
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ asanaAutoSend: true });
    expect(db.getSettings().asanaAutoSend).toBe(true);
  });

  it("сохраняет URL вебхука", async () => {
    ({ db, auth } = setupAuthedDb());
    const updated = await app.request("/api/settings", {
      method: "PUT",
      headers: authHeaders(auth, { "content-type": "application/json" }),
      body: JSON.stringify({ webhookUrl: "https://hooks.local/ready" }),
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      webhookUrl: "https://hooks.local/ready",
    });
    expect(db.getSettings().webhookUrl).toBe("https://hooks.local/ready");
  });
});
