import { describe, expect, it } from "vitest";
import { createVoiceprintAdapter, VOICEPRINT_UNAVAILABLE } from "./index.ts";

describe("voiceprint adapter", () => {
  it("без модели ставит Спикер N и подпись, без сети", () => {
    const fetchCalls: unknown[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((...args: unknown[]) => {
      fetchCalls.push(args);
      throw new Error("сеть запрещена в тесте адаптера отпечатка");
    }) as typeof fetch;

    try {
      const adapter = createVoiceprintAdapter();
      const labeled = adapter.label([
        { speaker: "Анна Петрова" },
        { speaker: "Иван Смирнов" },
        { speaker: "Анна Петрова" },
      ]);

      expect(adapter.mode).toBe("stub");
      expect(adapter.modelAvailable).toBe(false);
      expect(labeled.map((s) => s.speaker)).toEqual([
        "Спикер 1",
        "Спикер 2",
        "Спикер 1",
      ]);
      expect(
        labeled.every((s) => s.voiceprintLabel === VOICEPRINT_UNAVAILABLE),
      ).toBe(true);
      expect(VOICEPRINT_UNAVAILABLE).toBe("отпечаток не рассчитан");
      expect(fetchCalls).toHaveLength(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
