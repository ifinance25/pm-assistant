import { afterEach, describe, expect, it } from "vitest";
import { app } from "./app.ts";
import { authHeaders, setupAuthedDb } from "./test-auth.ts";

describe("GET/POST /api/meetings", () => {
  let db: ReturnType<typeof setupAuthedDb>["db"];
  let auth: ReturnType<typeof setupAuthedDb>["auth"];

  afterEach(() => {
    db?.close();
  });

  function jsonHeaders(): Record<string, string> {
    return authHeaders(auth, { "content-type": "application/json" });
  }

  function projectId(): string {
    return db.getDefaultProject().id;
  }

  async function postMeeting(url: string, extra: Record<string, unknown> = {}) {
    return app.request("/api/meetings", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ url, projectId: projectId(), ...extra }),
    });
  }

  it("возвращает пустой список встреч", async () => {
    ({ db, auth } = setupAuthedDb());
    const res = await app.request("/api/meetings", {
      headers: authHeaders(auth),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      meetings: [],
      storage: { meetingCount: 0, usedBytes: 0 },
    });
  });

  it("создаёт встречу queued по ссылке Zoom", async () => {
    ({ db, auth } = setupAuthedDb());
    const url = "https://zoom.us/j/123456789";
    const res = await postMeeting(url);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.alreadyRunning).toBe(false);
    expect(body.meeting).toMatchObject({
      url,
      platform: "zoom",
      status: "queued",
      source: "stub",
      projectId: projectId(),
    });
    expect(body.meeting.id).toEqual(expect.any(String));
    expect(db.listMeetings()).toHaveLength(1);
    expect(db.listMeetings()[0].id).toBe(body.meeting.id);
  });

  it("создаёт встречу queued по ссылке Google Meet", async () => {
    ({ db, auth } = setupAuthedDb());
    const url = "https://meet.google.com/abc-defg-hij";
    const res = await postMeeting(url);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      error: "Google Meet пока не реализован",
    });
    expect(db.listMeetings()).toEqual([]);
  });

  it("создаёт встречу queued по ссылке Телемоста", async () => {
    ({ db, auth } = setupAuthedDb());
    const url = "https://telemost.yandex.ru/j/12345678901234";
    const res = await postMeeting(url);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      error: "Яндекс.Телемост пока не реализован",
    });
    expect(db.listMeetings()).toEqual([]);
  });

  it("отклоняет пустую ссылку русской ошибкой", async () => {
    ({ db, auth } = setupAuthedDb());
    const res = await app.request("/api/meetings", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ url: "   " }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Вставьте ссылку на встречу" });
    expect(db.listMeetings()).toEqual([]);
  });

  it("отклоняет запрос без projectId", async () => {
    ({ db, auth } = setupAuthedDb());
    const res = await app.request("/api/meetings", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ url: "https://zoom.us/j/123" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "выберите проект" });
    expect(db.listMeetings()).toEqual([]);
  });

  it("отклоняет неизвестный projectId", async () => {
    ({ db, auth } = setupAuthedDb());
    const res = await postMeeting("https://zoom.us/j/123", {
      projectId: "missing-project",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "проект не найден" });
  });

  it("отклоняет чужую ссылку русской ошибкой", async () => {
    ({ db, auth } = setupAuthedDb());
    const res = await postMeeting("https://example.com/meeting");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Ссылка не похожа на Zoom, Google Meet или Телемост",
    });
    expect(db.listMeetings()).toEqual([]);
  });

  it("не создаёт дубль встречи в статусе queued", async () => {
    ({ db, auth } = setupAuthedDb());
    const url = "https://zoom.us/j/555111222";
    const first = await postMeeting(url);
    const firstBody = await first.json();
    const second = await postMeeting(url);
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.alreadyRunning).toBe(true);
    expect(secondBody.meeting.id).toBe(firstBody.meeting.id);
    expect(db.listMeetings()).toHaveLength(1);
  });

  it("не создаёт дубль встречи в статусе joining или recording", async () => {
    ({ db, auth } = setupAuthedDb());
    const url = "https://zoom.us/j/555111222";
    const created = await postMeeting(url);
    const meeting = (await created.json()).meeting;
    db.updateMeetingStatus(meeting.id, "joining");
    const again = await postMeeting(url);
    expect(again.status).toBe(200);
    expect((await again.json()).meeting.id).toBe(meeting.id);
    expect(db.listMeetings()).toHaveLength(1);

    db.updateMeetingStatus(meeting.id, "recording");
    const third = await postMeeting(url);
    expect(third.status).toBe(200);
    expect(db.listMeetings()).toHaveLength(1);
  });
});
