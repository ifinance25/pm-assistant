import { describe, expect, it } from "vitest";
import { createSttAdapter } from "./index.ts";

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
