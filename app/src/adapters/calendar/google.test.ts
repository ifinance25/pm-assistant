import { describe, expect, it } from "vitest";
import { extractConferenceUrl } from "./google.ts";

describe("extractConferenceUrl", () => {
  it("находит ссылку в conferenceData (высший приоритет)", () => {
    const url = extractConferenceUrl({
      id: "1",
      conferenceData: {
        entryPoints: [
          { entryPointType: "video", uri: "https://zoom.us/j/123456" },
        ],
      },
      hangoutLink: "https://meet.google.com/abc-defg-hij",
    });
    expect(url).toBe("https://zoom.us/j/123456");
  });

  it("находит ссылку в hangoutLink, если conferenceData пуст", () => {
    const url = extractConferenceUrl({
      id: "2",
      hangoutLink: "https://meet.google.com/abc-defg-hij",
    });
    expect(url).toBe("https://meet.google.com/abc-defg-hij");
  });

  it("находит ссылку в location, если нет conferenceData и hangoutLink", () => {
    const url = extractConferenceUrl({
      id: "3",
      location: "Звонок: https://telemost.yandex.ru/j/12345 (основная переговорка)",
    });
    expect(url).toBe("https://telemost.yandex.ru/j/12345");
  });

  it("находит ссылку в description, если её нет больше нигде", () => {
    const url = extractConferenceUrl({
      id: "4",
      description: "Повестка дня.\nСсылка на звонок: https://zoom.us/j/999",
    });
    expect(url).toBe("https://zoom.us/j/999");
  });

  it("возвращает null, если ни один источник не содержит распознанной ссылки", () => {
    const url = extractConferenceUrl({
      id: "5",
      location: "Переговорка 4 этаж",
      description: "Просто обсуждение без звонка. См. https://example.com/doc",
    });
    expect(url).toBeNull();
  });
});
