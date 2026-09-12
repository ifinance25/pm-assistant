import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publicAudioUrl, supadataTranscribe } from "./supadata.ts";

const ENV_KEYS = [
  "APP_API_TOKEN",
  "PM_ASSISTANT_PUBLIC_BASE_URL",
  "SUPADATA_API_KEY",
] as const;

describe("supadata", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  describe("publicAudioUrl", () => {
    it("без PM_ASSISTANT_PUBLIC_BASE_URL бросает", () => {
      process.env.APP_API_TOKEN = "секрет";
      expect(() => publicAudioUrl("m1")).toThrow(/PM_ASSISTANT_PUBLIC_BASE_URL/);
    });

    it("без APP_API_TOKEN бросает", () => {
      process.env.PM_ASSISTANT_PUBLIC_BASE_URL = "https://example.com";
      expect(() => publicAudioUrl("m1")).toThrow(/APP_API_TOKEN/);
    });

    it("строит ссылку из базового адреса и токена", () => {
      process.env.APP_API_TOKEN = "секрет";
      process.env.PM_ASSISTANT_PUBLIC_BASE_URL = "https://example.com/";
      const url = publicAudioUrl("m1");
      expect(url).toMatch(/^https:\/\/example\.com\/api\/audio-share\/.+/);
    });
  });

  describe("supadataTranscribe", () => {
    beforeEach(() => {
      process.env.APP_API_TOKEN = "секрет";
      process.env.PM_ASSISTANT_PUBLIC_BASE_URL = "https://example.com";
    });

    it("без SUPADATA_API_KEY бросает", async () => {
      await expect(
        supadataTranscribe("нет-такого-файла.wav", {}),
      ).rejects.toThrow(/SUPADATA_API_KEY/);
    });

    it("синхронный ответ 200 маппится в сегменты", async () => {
      process.env.SUPADATA_API_KEY = "ключ";
      const fetchImpl = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          content: [
            { text: "привет", offset: 0, duration: 500 },
            { text: "как дела", offset: 500, duration: 800 },
          ],
        }),
      });
      const result = await supadataTranscribe(
        "нет-такого-файла.wav",
        { languageHint: "ru" },
        { fetchImpl: fetchImpl as unknown as typeof fetch },
      );
      expect(result.mode).toBe("live");
      // Оба сегмента — один спикер по умолчанию (нет таймлайна фазы 4),
      // группировка транскрипта склеивает их в один блок — как и для Whisper.
      expect(result.segments.map((s) => s.text)).toEqual([
        "привет как дела",
      ]);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const [calledUrl] = fetchImpl.mock.calls[0];
      expect(String(calledUrl)).toContain("mode=generate");
      expect(String(calledUrl)).toContain("lang=ru");
    });

    it("202 -> опрашивает jobId до completed", async () => {
      process.env.SUPADATA_API_KEY = "ключ";
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 202,
          json: async () => ({ jobId: "job-1" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ status: "queued" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            status: "completed",
            content: [{ text: "готово", offset: 0, duration: 100 }],
          }),
        });
      const sleep = vi.fn().mockResolvedValue(undefined);
      const result = await supadataTranscribe(
        "нет-такого-файла.wav",
        {},
        { fetchImpl: fetchImpl as unknown as typeof fetch, sleep },
      );
      expect(result.segments.map((s) => s.text)).toEqual(["готово"]);
      expect(fetchImpl).toHaveBeenCalledTimes(3);
      expect(sleep).toHaveBeenCalledTimes(1);
    });

    it("failed job бросает с текстом ошибки", async () => {
      process.env.SUPADATA_API_KEY = "ключ";
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 202,
          json: async () => ({ jobId: "job-1" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ status: "failed", error: "файл недоступен" }),
        });
      await expect(
        supadataTranscribe(
          "нет-такого-файла.wav",
          {},
          { fetchImpl: fetchImpl as unknown as typeof fetch },
        ),
      ).rejects.toThrow(/файл недоступен/);
    });

    it("ошибка HTTP пробрасывается с кодом", async () => {
      process.env.SUPADATA_API_KEY = "ключ";
      const fetchImpl = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => "доступ запрещён",
        json: async () => ({}),
      });
      await expect(
        supadataTranscribe(
          "нет-такого-файла.wav",
          {},
          { fetchImpl: fetchImpl as unknown as typeof fetch },
        ),
      ).rejects.toThrow(/403/);
    });
  });
});
