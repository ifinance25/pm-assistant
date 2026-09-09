import { afterEach, describe, expect, it, vi } from "vitest";
import { createSttAdapter, resolveSttEngineKind } from "./index.ts";

describe("stt", () => {
  it("transcribe на фикстуре возвращает сегменты с speaker и русским текстом", async () => {
    const stt = createSttAdapter({ detectEngine: () => null });
    const result = await stt.transcribe("fixtures/demo.wav", {
      languageHint: "ru",
    });

    expect(result.mode).toBe("stub");
    expect(result.segments.length).toBeGreaterThan(1);
    expect(result.segments[0]).toMatchObject({
      speaker: "Анна Петрова",
      startedAtMs: 0,
    });
    expect(result.segments[0].text).toMatch(/standup/);
    expect(result.segments.some((s) => /[А-Яа-яЁё]/.test(s.text))).toBe(true);
    expect(result.segments.every((s) => typeof s.speaker === "string")).toBe(
      true,
    );
  });

  it("без бинаря режим stub и не падает, с движком mode live", async () => {
    const stub = createSttAdapter({ detectEngine: () => null });
    expect(stub.mode).toBe("stub");
    await expect(stub.transcribe("missing.wav", {})).resolves.toMatchObject({
      mode: "stub",
    });

    const live = createSttAdapter({
      detectEngine: () => ({
        kind: "whisper-cli",
        bin: "/opt/homebrew/bin/whisper",
      }),
    });
    expect(live.mode).toBe("live");
  });
});

describe("resolveSttEngineKind", () => {
  it("по умолчанию whisper-cli", () => {
    expect(resolveSttEngineKind({})).toBe("whisper-cli");
  });

  it("supadata только по точному значению переменной", () => {
    expect(resolveSttEngineKind({ PM_ASSISTANT_STT_ENGINE: "supadata" })).toBe(
      "supadata",
    );
    expect(resolveSttEngineKind({ PM_ASSISTANT_STT_ENGINE: "Supadata" })).toBe(
      "whisper-cli",
    );
  });
});

describe("createSttAdapter с engineKind: supadata", () => {
  const prevEnv = {
    APP_API_TOKEN: process.env.APP_API_TOKEN,
    PM_ASSISTANT_PUBLIC_BASE_URL: process.env.PM_ASSISTANT_PUBLIC_BASE_URL,
    SUPADATA_API_KEY: process.env.SUPADATA_API_KEY,
  };

  afterEach(() => {
    for (const [key, value] of Object.entries(prevEnv)) {
      if (value === undefined) {
        delete process.env[key as keyof typeof prevEnv];
      } else {
        process.env[key as keyof typeof prevEnv] = value;
      }
    }
    vi.unstubAllGlobals();
  });

  it("при ошибке Supadata пробует откатиться на найденный whisper", async () => {
    delete process.env.SUPADATA_API_KEY;
    const detectEngine = vi.fn(() => ({
      kind: "whisper-cli" as const,
      bin: "/bin/несуществующий-whisper",
    }));
    const adapter = createSttAdapter({ engineKind: "supadata", detectEngine });
    expect(adapter.mode).toBe("live");
    // Supadata падает без ключа сразу (до сети); откат зовёт detectEngine и пытается
    // whisper — в тестовом окружении бинаря нет, поэтому ошибка тоже будет, но уже
    // не "нет SUPADATA_API_KEY", а от попытки запустить whisper. Это доказывает, что
    // откат действительно сработал, а не просто пробросил исходную ошибку.
    await expect(adapter.transcribe("a.wav", {})).rejects.not.toThrow(
      /SUPADATA_API_KEY/,
    );
    expect(detectEngine).toHaveBeenCalled();
  });

  it("без движка whisper пробрасывает исходную ошибку Supadata", async () => {
    delete process.env.SUPADATA_API_KEY;
    const adapter = createSttAdapter({
      engineKind: "supadata",
      detectEngine: () => null,
    });
    await expect(adapter.transcribe("a.wav", {})).rejects.toThrow(
      /SUPADATA_API_KEY/,
    );
  });
});
