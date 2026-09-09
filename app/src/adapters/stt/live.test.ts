import { describe, expect, it } from "vitest";
import { buildWhisperArgs } from "./live.ts";

describe("buildWhisperArgs", () => {
  it("без языка и без словаря — базовые флаги", () => {
    const args = buildWhisperArgs("a.wav", "/tmp/out", undefined, {});
    expect(args).toEqual([
      "a.wav",
      "--output_format",
      "json",
      "--output_dir",
      "/tmp/out",
      "--verbose",
      "False",
    ]);
  });

  it("добавляет --language при подсказке языка", () => {
    const args = buildWhisperArgs("a.wav", "/tmp/out", "ru", {});
    expect(args).toContain("--language");
    expect(args).toContain("ru");
  });

  it("добавляет --initial_prompt из PM_ASSISTANT_WHISPER_PROMPT", () => {
    const args = buildWhisperArgs("a.wav", "/tmp/out", "ru", {
      PM_ASSISTANT_WHISPER_PROMPT: "блокеры, спринт, Jira",
    });
    const idx = args.indexOf("--initial_prompt");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("блокеры, спринт, Jira");
  });

  it("пустая переменная окружения — флаг не добавляется", () => {
    const args = buildWhisperArgs("a.wav", "/tmp/out", "ru", {
      PM_ASSISTANT_WHISPER_PROMPT: "   ",
    });
    expect(args).not.toContain("--initial_prompt");
  });
});
