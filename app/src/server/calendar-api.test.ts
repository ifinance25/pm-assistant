import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "./app.ts";
import { authHeaders, setupAuthedDb } from "./test-auth.ts";

describe("GET /api/calendar/events", () => {
  let db: ReturnType<typeof setupAuthedDb>["db"];
  let auth: ReturnType<typeof setupAuthedDb>["auth"];

  afterEach(() => {
    db?.close();
    vi.unstubAllGlobals();
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });

  it("без подключённого календаря отвечает пустым отключённым фидом", async () => {
    ({ db, auth } = setupAuthedDb());
    const res = await app.request("/api/calendar/events", {
      headers: authHeaders(auth),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      connected: false,
      account: null,
      expired: false,
      events: [],
    });
  });

  it("с подключённым календарём отдаёт события с распознанной ссылкой, отсортированные по времени, и скрывает остальные", async () => {
    ({ db, auth } = setupAuthedDb());
    db.upsertIntegrationToken("google_calendar", {
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      meta: { email: "user@example.com" },
    });
    const meeting = db.createMeeting({
      url: "https://zoom.us/j/111",
      platform: "zoom",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            items: [
              {
                id: "evt-2",
                summary: "Второй звонок",
                start: { dateTime: "2026-09-10T12:00:00+03:00" },
                end: { dateTime: "2026-09-10T12:30:00+03:00" },
                hangoutLink: "https://meet.google.com/abc-defg-hij",
              },
              {
                id: "evt-1",
                summary: "Синк с командой",
                start: { dateTime: "2026-09-08T10:00:00+03:00" },
                end: { dateTime: "2026-09-08T10:30:00+03:00" },
                conferenceData: {
                  entryPoints: [
                    { entryPointType: "video", uri: "https://zoom.us/j/111" },
                  ],
                },
              },
              {
                id: "evt-3",
                summary: "Без видеозвонка",
                start: { dateTime: "2026-09-09T09:00:00+03:00" },
                location: "Переговорка",
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    const res = await app.request("/api/calendar/events", {
      headers: authHeaders(auth),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.connected).toBe(true);
    expect(body.account).toBe("user@example.com");
    expect(body.expired).toBe(false);
    expect(body.events).toHaveLength(2);
    expect(body.events[0].id).toBe("evt-1");
    expect(body.events[0].meetingId).toBe(meeting.id);
    expect(body.events[0].meetingStatus).toBe("queued");
    expect(body.events[0].supported).toBe(true);
    expect(body.events[1].id).toBe("evt-2");
    expect(body.events[1].platform).toBe("meet");
    expect(body.events[1].supported).toBe(false);
    expect(body.events[1].meetingId).toBeNull();
  });

  it("истёкший access-токен обновляется по refresh-токену перед запросом", async () => {
    ({ db, auth } = setupAuthedDb());
    process.env.GOOGLE_CLIENT_ID = "id";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    db.upsertIntegrationToken("google_calendar", {
      accessToken: "expired-access",
      refreshToken: "refresh-1",
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      meta: { email: "user@example.com" },
    });
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (String(url).includes("/token")) {
        return new Response(
          JSON.stringify({ access_token: "fresh-access", expires_in: 3600 }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await app.request("/api/calendar/events", {
      headers: authHeaders(auth),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ connected: true, expired: false });
    const eventsCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("calendar/v3"),
    );
    expect((eventsCall?.[1] as RequestInit | undefined)?.headers).toMatchObject({
      authorization: "Bearer fresh-access",
    });
    expect(db.getIntegrationToken("google_calendar")?.accessToken).toBe(
      "fresh-access",
    );
  });

  it("неудачное обновление токена удаляет запись и возвращает expired:true", async () => {
    ({ db, auth } = setupAuthedDb());
    process.env.GOOGLE_CLIENT_ID = "id";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    db.upsertIntegrationToken("google_calendar", {
      accessToken: "expired-access",
      refreshToken: "bad-refresh",
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      meta: { email: "user@example.com" },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("invalid_grant", { status: 400 })),
    );

    const res = await app.request("/api/calendar/events", {
      headers: authHeaders(auth),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      connected: false,
      account: "user@example.com",
      expired: true,
      events: [],
    });
    expect(db.isIntegrationConnected("google_calendar")).toBe(false);
  });

  it("при сбое запроса к Google логирует и отдаёт пустой список без 500", async () => {
    ({ db, auth } = setupAuthedDb());
    db.upsertIntegrationToken("google_calendar", {
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      meta: { email: "user@example.com" },
    });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    );

    const res = await app.request("/api/calendar/events", {
      headers: authHeaders(auth),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      connected: true,
      account: "user@example.com",
      expired: false,
      events: [],
    });
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});

describe("SessionInfo.integrations.googleCalendarAccount", () => {
  let db: ReturnType<typeof setupAuthedDb>["db"];
  let auth: ReturnType<typeof setupAuthedDb>["auth"];

  afterEach(() => {
    db?.close();
  });

  it("отдаёт null, если календарь не подключён, и почту, если подключён", async () => {
    ({ db, auth } = setupAuthedDb());
    const before = await app.request("/api/auth/session", {
      headers: authHeaders(auth),
    });
    expect((await before.json()).integrations.googleCalendarAccount).toBeNull();

    db.upsertIntegrationToken("google_calendar", {
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      meta: { email: "user@example.com" },
    });
    const after = await app.request("/api/auth/session", {
      headers: authHeaders(auth),
    });
    expect((await after.json()).integrations.googleCalendarAccount).toBe(
      "user@example.com",
    );
  });
});
