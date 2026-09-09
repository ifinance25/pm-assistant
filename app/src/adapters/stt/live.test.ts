import { describe, expect, it } from "vitest";
import { DEFAULT_WHISPER_PROMPT, buildWhisperArgs } from "./live.ts";

describe("buildWhisperArgs", () => {
  it("без переменной окружения — словарь по умолчанию (фаза 5.2c)", () => {
    const args = buildWhisperArgs("a.wav", "/tmp/out", undefined, {});
    expect(args).toEqual([
      "a.wav",
      "--output_format",
      "json",
      "--output_dir",
      "/tmp/out",
      "--verbose",
      "False",
      "--initial_prompt",
      DEFAULT_WHISPER_PROMPT,
    ]);
  });

  it("явно пустая переменная отключает словарь совсем", () => {
    const args = buildWhisperArgs("a.wav", "/tmp/out", undefined, {
      PM_ASSISTANT_WHISPER_PROMPT: "",
    });
    expect(args).not.toContain("--initial_prompt");
  });

  it("добавляет --language при подсказке языка", () => {
    const args = buildWhisperArgs("a.wav", "/tmp/out", "ru", {
      PM_ASSISTANT_WHISPER_PROMPT: "",
    });
    expect(args).toContain("--language");
    expect(args).toContain("ru");
  });

  it("своя переменная переопределяет словарь по умолчанию целиком", () => {
    const args = buildWhisperArgs("a.wav", "/tmp/out", "ru", {
      PM_ASSISTANT_WHISPER_PROMPT: "блокеры, спринт, Jira",
    });
    const idx = args.indexOf("--initial_prompt");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("блокеры, спринт, Jira");
    expect(args[idx + 1]).not.toBe(DEFAULT_WHISPER_PROMPT);
  });

  it("переменная из одних пробелов — тоже отключает словарь", () => {
    const args = buildWhisperArgs("a.wav", "/tmp/out", "ru", {
      PM_ASSISTANT_WHISPER_PROMPT: "   ",
    });
    expect(args).not.toContain("--initial_prompt");
  });
});
