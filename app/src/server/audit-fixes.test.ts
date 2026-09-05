import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { createDb, setDb } from "../db/index.ts";
import { app } from "./app.ts";
import { authHeaders, seedTestAuth, setupAuthedDb } from "./test-auth.ts";
import { OAUTH_STATE_COOKIE, SESSION_COOKIE } from "./auth/session.ts";
import { clearLoginRateLimit } from "./auth/rate-limit.ts";
import { dispatchActionItems } from "../adapters/asana/index.ts";
import { dispatchTrackerActionItems } from "../adapters/tracker/index.ts";
import { runOnce } from "../worker/pipeline.ts";

describe("аудит: auth", () => {
  let db: ReturnType<typeof createDb>;

  afterEach(() => {
    db?.close();
    clearLoginRateLimit();
    delete process.env.PM_ASSISTANT_AUTH_ALLOWLIST;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    vi.unstubAllGlobals();
  });

  it("отклоняет Google callback без валидного state", async () => {
    db = createDb(":memory:");
    setDb(db);
    const res = await app.request("/api/auth/google/callback?code=abc&state=nope");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("error=state");
    expect(res.headers.get("set-cookie") ?? "").not.toContain(`${SESSION_COOKIE}=`);
  });

  it("google start кладёт state в cookie", async () => {
    db = createDb(":memory:");
    setDb(db);
    process.env.GOOGLE_CLIENT_ID = "test-client";
    const res = await app.request("/api/auth/google/start");
    expect(res.status).toBe(302);
    expect(res.headers.get("set-cookie") ?? "").toContain(OAUTH_STATE_COOKIE);
  });

  it("не пускает Google email вне allowlist и не создаёт сессию", async () => {
    db = createDb(":memory:");
    setDb(db);
    process.env.PM_ASSISTANT_AUTH_ALLOWLIST = "allowed@example.com";
    process.env.GOOGLE_CLIENT_ID = "id";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/token")) {
          return new Response(JSON.stringify({ access_token: "tok" }), { status: 200 });
        }
        return new Response(
          JSON.stringify({
            sub: "sub-1",
            email: "stranger@example.com",
            email_verified: true,
            name: "Чужой",
          }),
          { status: 200 },
        );
      }),
    );
    const res = await app.request(
      "/api/auth/google/callback?code=ok&state=st",
      { headers: { cookie: `${OAUTH_STATE_COOKIE}=st` } },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("error=forbidden");
    expect(db.getUserByEmail("stranger@example.com")).toBeNull();
  });

  it("запрещает вход если email_verified=false", async () => {
    db = createDb(":memory:");
    setDb(db);
    process.env.GOOGLE_CLIENT_ID = "id";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/token")) {
          return new Response(JSON.stringify({ access_token: "tok" }), { status: 200 });
        }
        return new Response(
          JSON.stringify({
            sub: "sub-2",
            email: "test@example.com",
            email_verified: false,
          }),
          { status: 200 },
        );
      }),
    );
    const res = await app.request(
      "/api/auth/google/callback?code=ok&state=st",
      { headers: { cookie: `${OAUTH_STATE_COOKIE}=st` } },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("error=unverified");
  });

  it("после 10 неверных логинов отвечает 429", async () => {
    db = createDb(":memory:");
    setDb(db);
    seedTestAuth(db);
    let lastStatus = 0;
    for (let i = 0; i < 11; i += 1) {
      const res = await app.request("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "nobody@example.com", password: "x" }),
      });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });

  it("ставит Secure на cookie при HTTPS", async () => {
    db = createDb(":memory:");
    setDb(db);
    const auth = seedTestAuth(db);
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-proto": "https",
      },
      body: JSON.stringify({ email: auth.email, password: auth.password }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie") ?? "").toMatch(/HttpOnly/i);
    expect(res.headers.get("set-cookie") ?? "").toMatch(/SameSite=Lax/i);
    expect(res.headers.get("set-cookie") ?? "").toMatch(/Secure/i);
  });

  it("меняет пароль без SQL", async () => {
    ({ db } = (() => {
      const setup = setupAuthedDb();
      return setup;
    })());
    const auth = seedTestAuth(db, { email: "pwd@example.com", password: "old-password" });
    const res = await app.request("/api/auth/password", {
      method: "POST",
      headers: authHeaders(auth, { "content-type": "application/json" }),
      body: JSON.stringify({
        currentPassword: "old-password",
        newPassword: "new-password",
      }),
    });
    expect(res.status).toBe(200);
    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "pwd@example.com", password: "new-password" }),
    });
    expect(login.status).toBe(200);
  });
});

describe("аудит: изоляция и настройки", () => {
  let db: ReturnType<typeof setupAuthedDb>["db"];

  afterEach(() => {
    db?.close();
  });

  it("пользователь B не видит встречу A и не меняет настройки", async () => {
    const setup = setupAuthedDb();
    db = setup.db;
    const authA = setup.auth;
    const meeting = db.createMeeting({
      url: "https://zoom.us/j/owner-a",
      ownerUserId: authA.userId,
    });
    const authB = seedTestAuth(db, {
      email: "b@example.com",
      role: "user",
    });

    const list = await app.request("/api/meetings", { headers: authHeaders(authB) });
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { meetings: { id: string }[] };
    expect(listBody.meetings.map((row) => row.id)).not.toContain(meeting.id);

    const detail = await app.request(`/api/meetings/${meeting.id}`, {
      headers: authHeaders(authB),
    });
    expect(detail.status).toBe(404);

    const before = db.getSettings().trackerType;
    const put = await app.request("/api/settings", {
      method: "PUT",
      headers: authHeaders(authB, { "content-type": "application/json" }),
      body: JSON.stringify({ trackerType: "asana" }),
    });
    expect(put.status).toBe(403);
    expect(db.getSettings().trackerType).toBe(before);
  });

  it("PUT /api/settings отклоняет невалидный trackerType и private webhook", async () => {
    const setup = setupAuthedDb();
    db = setup.db;
    const auth = setup.auth;
    const badType = await app.request("/api/settings", {
      method: "PUT",
      headers: authHeaders(auth, { "content-type": "application/json" }),
      body: JSON.stringify({ trackerType: "invalid" }),
    });
    expect(badType.status).toBe(400);

    const ssrf = await app.request("/api/settings", {
      method: "PUT",
      headers: authHeaders(auth, { "content-type": "application/json" }),
      body: JSON.stringify({ webhookUrl: "http://169.254.169.254/" }),
    });
    expect(ssrf.status).toBe(400);

    const badJson = await app.request("/api/settings", {
      method: "PUT",
      headers: authHeaders(auth, { "content-type": "application/json" }),
      body: "{",
    });
    expect(badJson.status).toBe(400);
  });

  it("перезапуск бота без admin и без confirm запрещён", async () => {
    const setup = setupAuthedDb();
    db = setup.db;
    const user = seedTestAuth(db, { email: "user@example.com", role: "user" });
    const forbidden = await app.request("/api/bot/restart", {
      method: "POST",
      headers: authHeaders(user, { "content-type": "application/json" }),
      body: JSON.stringify({ confirm: true }),
    });
    expect(forbidden.status).toBe(403);
    const noConfirm = await app.request("/api/bot/restart", {
      method: "POST",
      headers: authHeaders(setup.auth, { "content-type": "application/json" }),
      body: JSON.stringify({}),
    });
    expect(noConfirm.status).toBe(400);
  });
});

describe("аудит: поиск FTS", () => {
  let db: ReturnType<typeof setupAuthedDb>["db"];
  let auth: ReturnType<typeof setupAuthedDb>["auth"];

  afterEach(() => {
    db?.close();
  });

  it("кавычка и OR не роняют поиск", async () => {
    ({ db, auth } = setupAuthedDb());
    db.createMeeting({
      url: "https://zoom.us/j/search-or",
      title: "Планирование",
    });
    const quote = await app.request('/api/search?q="', {
      headers: authHeaders(auth),
    });
    expect([200, 400]).toContain(quote.status);
    const orRes = await app.request("/api/search?q=OR", {
      headers: authHeaders(auth),
    });
    expect([200, 400]).toContain(orRes.status);
    if (quote.status === 200) {
      expect((await quote.json() as { results: unknown[] }).results).toEqual([]);
    }
  });
});

describe("аудит: БД", () => {
  it("не сбрасывает tracker_type clickup при повторном migrate", () => {
    const dir = mkdtempSync(join(tmpdir(), "pm-mig-"));
    const path = join(dir, "app.sqlite");
    const first = createDb(path);
    const meeting = first.createMeeting({ url: "https://zoom.us/j/1" });
    const [item] = first.saveActionItems(meeting.id, [
      {
        title: "Задача",
        assignee: null,
        dueAt: null,
        timecodeMs: null,
        segmentId: null,
      },
    ]);
    first.markActionItemsQueued([item.id], "clickup");
    expect(first.listActionItems(meeting.id)[0].trackerType).toBe("clickup");
    first.close();
    const second = createDb(path);
    expect(second.listActionItems(meeting.id)[0].trackerType).toBe("clickup");
    second.close();
  });

  it("при апгрейде с user_version=1 повышает существующих пользователей до admin", () => {
    const dir = mkdtempSync(join(tmpdir(), "pm-admin-"));
    const path = join(dir, "app.sqlite");
    const first = createDb(path);
    first.createUser({ email: "ops@example.com", displayName: "Ops" });
    expect(first.getUserByEmail("ops@example.com")?.role).toBe("user");
    first.close();
    const raw = new Database(path);
    raw.exec("UPDATE users SET role = 'user'");
    raw.exec("PRAGMA user_version = 1");
    raw.close();
    const second = createDb(path);
    expect(second.getUserByEmail("ops@example.com")?.role).toBe("admin");
    second.close();
  });

  it("не даёт создать второй email в другом регистре", () => {
    const db = createDb(":memory:");
    db.createUser({ email: "Ivan@example.com", displayName: "A" });
    expect(() =>
      db.createUser({ email: "ivan@example.com", displayName: "B" }),
    ).toThrow();
    db.close();
  });

  it("после удаления default project создаёт проект заново", () => {
    const db = createDb(":memory:");
    const def = db.getDefaultProject();
    expect(db.deleteProject(def.id)).toBe("deleted");
    const meeting = db.createMeeting({ url: "https://zoom.us/j/1" });
    expect(meeting.projectId).toBeTruthy();
    expect(db.getProject(meeting.projectId ?? "")).not.toBeNull();
    db.close();
  });
});

describe("аудит: Asana и трекер", () => {
  it("при падении на 2-й задаче помечает только первую sent", async () => {
    const db = createDb(":memory:");
    const meeting = db.createMeeting({ url: "https://zoom.us/j/2" });
    const items = db.saveActionItems(meeting.id, [
      { title: "Первая", assignee: null, dueAt: null, timecodeMs: null, segmentId: null },
      { title: "Вторая", assignee: null, dueAt: null, timecodeMs: null, segmentId: null },
      { title: "Третья", assignee: null, dueAt: null, timecodeMs: null, segmentId: null },
    ]);
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 2) {
        return new Response("fail", { status: 500 });
      }
      return new Response(JSON.stringify({ data: { gid: `gid-${calls}` } }), {
        status: 201,
      });
    });
    await dispatchActionItems(db, items, {
      token: "pat",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const saved = db.listActionItems(meeting.id);
    expect(saved[0].trackerState).toBe("created");
    expect(saved[0].asanaState).toBe("sent");
    expect(saved[1].trackerState).toBe("queued");
    expect(saved[2].trackerState).toBe("queued");
    db.close();
  });

  it("stub трекера не ставит created", async () => {
    const db = createDb(":memory:");
    const meeting = db.createMeeting({ url: "https://zoom.us/j/3" });
    const items = db.saveActionItems(meeting.id, [
      { title: "Задача", assignee: null, dueAt: null, timecodeMs: null, segmentId: null },
    ]);
    db.upsertIntegrationToken("tracker:clickup", {
      accessToken: "stub",
      meta: { stub: true },
    });
    const result = await dispatchTrackerActionItems(db, items, "clickup");
    expect(result.mode).toBe("queued");
    expect(db.listActionItems(meeting.id)[0].trackerState).toBe("queued");
    expect(db.isIntegrationConnected("tracker:clickup")).toBe(false);
    db.close();
  });
});

describe("аудит: воркер timeout", () => {
  it("зависшая LLM роняет задание и даёт обработать следующую встречу", async () => {
    const prev = process.env.PM_ASSISTANT_LLM_TIMEOUT_MS;
    process.env.PM_ASSISTANT_LLM_TIMEOUT_MS = "30";
    const db = createDb(":memory:");
    const first = db.createMeeting({ url: "https://zoom.us/j/hang", platform: "zoom" });
    db.enqueueJob({ meetingId: first.id, type: "join" });
    await expect(
      runOnce(db, {
        join: async (_item, hooks) => {
          await hooks?.onJoined?.({ mode: "live" });
          return { mode: "live", audioPath: "/tmp/hang.wav" };
        },
        transcribe: async () => ({
          mode: "live",
          segments: [
            { speaker: "Спикер 1", startedAtMs: 0, endedAtMs: 1, text: "Привет" },
          ],
        }),
        reviseTranscript: () => new Promise(() => undefined),
        resolveLlmKey: () => "sk-test",
      }),
    ).rejects.toThrow(/время ожидания/);
    expect(db.getMeeting(first.id)?.status).toBe("error");
    const second = db.createMeeting({ url: "https://zoom.us/j/next", platform: "zoom" });
    db.enqueueJob({ meetingId: second.id, type: "join" });
    expect(
      await runOnce(db, {
        join: async (_item, hooks) => {
          await hooks?.onJoined?.({ mode: "live" });
          return { mode: "live", audioPath: "/tmp/next.wav" };
        },
        transcribe: async () => ({
          mode: "live",
          segments: [
            { speaker: "Спикер 1", startedAtMs: 0, endedAtMs: 1, text: "Вторая" },
          ],
        }),
        resolveLlmKey: () => "",
      }),
    ).toBe(true);
    expect(db.getMeeting(second.id)?.status).toBe("ready");
    db.close();
    if (prev === undefined) {
      delete process.env.PM_ASSISTANT_LLM_TIMEOUT_MS;
    } else {
      process.env.PM_ASSISTANT_LLM_TIMEOUT_MS = prev;
    }
  });
});
