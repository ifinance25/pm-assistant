import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDb, setDb } from "../db/index.ts";
import { createAudioShareToken } from "../shared/audio-share-token.ts";
import { app } from "./app.ts";

describe("GET /api/audio-share/:token", () => {
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

  it("не требует сессии (не отвечает 401 «нужна сессия»)", async () => {
    db = createDb(":memory:");
    setDb(db);
    process.env.APP_API_TOKEN = "";
    const res = await app.request("/api/audio-share/мусор");
    const body = await res.json();
    expect(body.error).not.toBe("нужна сессия");
  });

  it("без APP_API_TOKEN всегда 401", async () => {
    db = createDb(":memory:");
    setDb(db);
    process.env.APP_API_TOKEN = "";
    const res = await app.request("/api/audio-share/что-угодно");
    expect(res.status).toBe(401);
  });

  it("с валидным токеном отдаёт содержимое файла", async () => {
    db = createDb(":memory:");
    setDb(db);
    process.env.APP_API_TOKEN = "секрет";
    const dir = mkdtempSync(join(tmpdir(), "pm-audio-share-"));
    const audioPath = join(dir, "meeting.wav");
    writeFileSync(audioPath, Buffer.from("RIFF...фейковый wav"));
    const meeting = db.createMeeting({
      url: "https://zoom.us/j/1",
      platform: "zoom",
    });
    db.updateMeetingStatus(meeting.id, "joining");
    db.updateMeetingStatus(meeting.id, "recording", {
      audioPath,
      source: "live",
    });
    const token = createAudioShareToken(meeting.id) as string;
    const res = await app.request(`/api/audio-share/${token}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/wav");
    const text = await res.text();
    expect(text).toBe("RIFF...фейковый wav");
  });

  it("с истёкшим или подделанным токеном отвечает 401", async () => {
    db = createDb(":memory:");
    setDb(db);
    process.env.APP_API_TOKEN = "секрет";
    const meeting = db.createMeeting({
      url: "https://zoom.us/j/1",
      platform: "zoom",
    });
    const expired = createAudioShareToken(
      meeting.id,
      Date.parse("2020-01-01T00:00:00Z"),
    ) as string;
    const res = await app.request(`/api/audio-share/${expired}`);
    expect(res.status).toBe(401);
  });

  it("для встречи без файла звука отвечает 404", async () => {
    db = createDb(":memory:");
    setDb(db);
    process.env.APP_API_TOKEN = "секрет";
    const meeting = db.createMeeting({
      url: "https://zoom.us/j/1",
      platform: "zoom",
    });
    const token = createAudioShareToken(meeting.id) as string;
    const res = await app.request(`/api/audio-share/${token}`);
    expect(res.status).toBe(404);
  });
});
