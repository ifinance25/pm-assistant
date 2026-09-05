import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createSlidesAdapter, SLIDES_UNAVAILABLE } from "./index.ts";

type DemoFixture = {
  slides: { id: string; title: string; capturedAtMs: number }[];
};

function loadFixtureSlides() {
  const path = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../fixtures/demo-meeting.json",
  );
  const raw = JSON.parse(readFileSync(path, "utf8")) as DemoFixture;
  return raw.slides;
}

describe("slides adapter", () => {
  it("без захвата возвращает подпись и слоты из фикстуры, без сети", async () => {
    const fetchCalls: unknown[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((...args: unknown[]) => {
      fetchCalls.push(args);
      throw new Error("сеть запрещена в тесте адаптера слайдов");
    }) as typeof fetch;

    try {
      const adapter = createSlidesAdapter();
      const capture = await adapter.capture();
      const fixtureSlots = loadFixtureSlides();

      expect(adapter.mode).toBe("stub");
      expect(adapter.captureAvailable).toBe(false);
      expect(capture.notice).toBe(SLIDES_UNAVAILABLE);
      expect(capture.notice).toBe("захват недоступен");
      expect(capture.slots.length).toBeGreaterThan(0);
      expect(capture.slots).toEqual(fixtureSlots);
      expect(adapter.listSlots()).toEqual(fixtureSlots);
      expect(fetchCalls).toHaveLength(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
