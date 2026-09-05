import { describe, expect, it } from "vitest";
import { assertStatusTransition } from "./status.ts";

describe("переходы статусов встречи", () => {
  it("принимает конвейер queued→joining→recording→transcribing→summarizing→ready", () => {
    const chain = [
      "queued",
      "joining",
      "recording",
      "transcribing",
      "summarizing",
      "ready",
    ] as const;
    for (let i = 0; i < chain.length - 1; i += 1) {
      expect(() => assertStatusTransition(chain[i], chain[i + 1])).not.toThrow();
    }
  });

  it("принимает переход в error с любого шага конвейера", () => {
    for (const from of [
      "queued",
      "joining",
      "recording",
      "transcribing",
      "summarizing",
    ] as const) {
      expect(() => assertStatusTransition(from, "error")).not.toThrow();
    }
  });

  it("отвергает недопустимые переходы", () => {
    expect(() => assertStatusTransition("queued", "recording")).toThrow();
    expect(() => assertStatusTransition("queued", "ready")).toThrow();
    expect(() => assertStatusTransition("ready", "joining")).toThrow();
    expect(() => assertStatusTransition("error", "ready")).toThrow();
  });

  it("принимает повторную расшифровку ready→transcribing, error→transcribing и joining→transcribing", () => {
    expect(() => assertStatusTransition("ready", "transcribing")).not.toThrow();
    expect(() => assertStatusTransition("error", "transcribing")).not.toThrow();
    expect(() => assertStatusTransition("joining", "transcribing")).not.toThrow();
    expect(() => assertStatusTransition("queued", "transcribing")).not.toThrow();
    expect(() => assertStatusTransition("summarizing", "transcribing")).not.toThrow();
  });
});
