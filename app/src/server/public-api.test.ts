import { afterEach, describe, expect, it } from "vitest";
import { createDb, setDb } from "../db/index.ts";
import { app } from "./app.ts";

describe("GET /api/public/meetings", () => {
  let db: ReturnType<typeof createDb>;
  const prevToken = process.env.APP_API_TOKEN;

  afterEach(() => {
    db?.close();
    if (prevToken === undefined) {
      delete process.env.APP_API_TOKEN;
    } else {
      process.env.APP_API_TOKEN = prevToken;
    }
  });

  it("без токена отвечает 401", async () => {
    db = createDb(":memory:");
    setDb(db);
    process.env.APP_API_TOKEN = "secret-token";
    const res = await app.request("/api/public/meetings");
    expect(res.status).toBe(401);
    const one = await app.request("/api/public/meetings/any-id");
    expect(one.status).toBe(401);
  });

  it("с токеном отдаёт JSON списка встреч", async () => {
    db = createDb(":memory:");
    setDb(db);
    process.env.APP_API_TOKEN = "secret-token";
    const meeting = db.createMeeting({
      url: "https://zoom.us/j/555",
      platform: "zoom",
    });
    const res = await app.request("/api/public/meetings", {
      headers: { authorization: "Bearer secret-token" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meetings).toHaveLength(1);
    expect(body.meetings[0]).toMatchObject({
      id: meeting.id,
      url: "https://zoom.us/j/555",
      platform: "zoom",
      status: "queued",
    });
  });

  it("с токеном отдаёт JSON одной встречи", async () => {
    db = createDb(":memory:");
    setDb(db);
    process.env.APP_API_TOKEN = "secret-token";
    const meeting = db.createMeeting({
      url: "https://meet.google.com/abc-defg-hij",
      platform: "meet",
    });
    const res = await app.request(`/api/public/meetings/${meeting.id}`, {
      headers: { authorization: "Bearer secret-token" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      meeting: db.getMeeting(meeting.id),
    });
  });
});
