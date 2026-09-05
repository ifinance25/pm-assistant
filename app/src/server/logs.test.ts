import { afterEach, describe, expect, it } from "vitest";
import { app } from "./app.ts";
import { resetLogsDeps, setLogsDeps } from "./routes/logs.ts";
import { authHeaders, seedTestAuth, setupAuthedDb } from "./test-auth.ts";

describe("GET /api/logs", () => {
  let db: ReturnType<typeof setupAuthedDb>["db"];
  let auth: ReturnType<typeof setupAuthedDb>["auth"];

  afterEach(() => {
    resetLogsDeps();
    db?.close();
  });

  it("отказывает без прав администратора", async () => {
    ({ db } = setupAuthedDb());
    const user = seedTestAuth(db, { email: "user@example.com", role: "user" });

    const res = await app.request("/api/logs", {
      headers: authHeaders(user),
    });
    expect(res.status).toBe(403);
  });

  it("сообщает no-systemd в локальной разработке", async () => {
    ({ db, auth } = setupAuthedDb());
    setLogsDeps({ existsSync: () => false });

    const res = await app.request("/api/logs", {
      headers: authHeaders(auth),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, reason: "no-systemd" });
  });

  it("возвращает вывод journalctl на сервере", async () => {
    ({ db, auth } = setupAuthedDb());
    setLogsDeps({
      existsSync: () => true,
      runCommand: async (command, args) => {
        expect(command).toBe("journalctl");
        expect(args).toContain("pm-assistant-worker");
        return { ok: true, stdout: "ZOOM_BOT_SDK_FAILED:таймаут ожидания входа", stderr: "" };
      },
    });

    const res = await app.request("/api/logs", {
      headers: authHeaders(auth),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      text: "ZOOM_BOT_SDK_FAILED:таймаут ожидания входа",
    });
  });

  it("сообщает об ошибке команды", async () => {
    ({ db, auth } = setupAuthedDb());
    setLogsDeps({
      existsSync: () => true,
      runCommand: async () => ({ ok: false, stdout: "", stderr: "boom" }),
    });

    const res = await app.request("/api/logs", {
      headers: authHeaders(auth),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: false,
      reason: "command-failed",
      detail: "boom",
    });
  });
});
