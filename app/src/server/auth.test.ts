import { afterEach, describe, expect, it } from "vitest";
import { createDb, setDb } from "../db/index.ts";
import { app } from "./app.ts";
import { authHeaders, seedTestAuth } from "./test-auth.ts";

describe("auth API", () => {
  let db: ReturnType<typeof createDb>;

  afterEach(() => {
    db?.close();
  });

  it("отклоняет защищённый маршрут без сессии", async () => {
    db = createDb(":memory:");
    setDb(db);
    const res = await app.request("/api/settings");
    expect(res.status).toBe(401);
  });

  it("логинит пользователя по email и паролю", async () => {
    db = createDb(":memory:");
    setDb(db);
    const auth = seedTestAuth(db);

    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: auth.email, password: auth.password }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toMatchObject({
      email: auth.email,
      displayName: "Тестовый пользователь",
    });
    expect(body.integrations.tracker).toBe("clickup");
    expect(res.headers.get("set-cookie")).toContain("pm_assistant_session=");
  });

  it("возвращает сессию по cookie", async () => {
    db = createDb(":memory:");
    setDb(db);
    const auth = seedTestAuth(db);

    const res = await app.request("/api/auth/session", {
      headers: authHeaders(auth),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.initials).toBe("ТП");
    expect(body.user.email).toBe(auth.email);
  });

  it("разлогинивает и очищает cookie", async () => {
    db = createDb(":memory:");
    setDb(db);
    const auth = seedTestAuth(db);

    const res = await app.request("/api/auth/logout", {
      method: "POST",
      headers: authHeaders(auth),
    });
    expect(res.status).toBe(200);
    expect(db.getSession(auth.sessionId)).toBeNull();
  });

  it("пускает авторизованного на /api/settings", async () => {
    db = createDb(":memory:");
    setDb(db);
    const auth = seedTestAuth(db);

    const res = await app.request("/api/settings", {
      headers: authHeaders(auth),
    });
    expect(res.status).toBe(200);
  });
});
