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
});
