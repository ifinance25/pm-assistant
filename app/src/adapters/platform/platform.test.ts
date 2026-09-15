import { describe, expect, it } from "vitest";
import { createJoinAdapter, detectPlatform } from "./index.ts";
import type { Meeting } from "../../shared/types.ts";

function meeting(platform: Meeting["platform"]): Meeting {
  return {
    id: "m1",
    url: "https://zoom.us/j/1",
    platform,
    title: null,
    status: "queued",
    recordingMode: "text",
    startedAt: null,
    endedAt: null,
    error: null,
    announcementStatus: null,
    source: "stub",
    audioPath: null,
    projectId: null,
  };
}

describe("detectPlatform", () => {
  it("распознаёт Zoom, Meet, Телемост и отклоняет чужой URL", () => {
    expect(detectPlatform("https://zoom.us/j/123456789")).toBe("zoom");
    expect(detectPlatform("https://company.zoom.us/j/555")).toBe("zoom");
    expect(detectPlatform("https://meet.google.com/abc-defg-hij")).toBe("meet");
    expect(
      detectPlatform("https://telemost.yandex.ru/j/12345678901234"),
    ).toBe("telemost");
    expect(detectPlatform("https://telemost.yandex.com/j/99")).toBe("telemost");
    expect(detectPlatform("https://example.com/meeting")).toBeNull();
    expect(detectPlatform("не ссылка")).toBeNull();
  });

  it("join без ключей не ходит в сеть и явно отказывает", async () => {
    // Meet и Телемост теперь реализованы: их join трогает Docker, поэтому
    // здесь, где ничего не подменяется, проверяется только Zoom.
    // Поведение Meet и Телемоста без Docker/образа покрыто их собственными
    // meet-bot.test.ts / telemost-bot.test.ts с подменённым runBrowserBot.
    const previousFetch = globalThis.fetch;
    globalThis.fetch = () => {
      throw new Error("сеть недоступна в тесте join");
    };
    const prevZoomId = process.env.ZOOM_CLIENT_ID;
    const prevZoomSecret = process.env.ZOOM_CLIENT_SECRET;
    const prevGoogleId = process.env.GOOGLE_CLIENT_ID;
    const prevGoogleSecret = process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.ZOOM_CLIENT_ID;
    delete process.env.ZOOM_CLIENT_SECRET;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    try {
      await expect(createJoinAdapter().join(meeting("zoom"))).rejects.toThrow(
        /Zoom-бот не настроен/,
      );
    } finally {
      globalThis.fetch = previousFetch;
      if (prevZoomId === undefined) delete process.env.ZOOM_CLIENT_ID;
      else process.env.ZOOM_CLIENT_ID = prevZoomId;
      if (prevZoomSecret === undefined) delete process.env.ZOOM_CLIENT_SECRET;
      else process.env.ZOOM_CLIENT_SECRET = prevZoomSecret;
      if (prevGoogleId === undefined) delete process.env.GOOGLE_CLIENT_ID;
      else process.env.GOOGLE_CLIENT_ID = prevGoogleId;
      if (prevGoogleSecret === undefined) {
        delete process.env.GOOGLE_CLIENT_SECRET;
      } else {
        process.env.GOOGLE_CLIENT_SECRET = prevGoogleSecret;
      }
    }
  });
});
