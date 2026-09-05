import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_WHISPER_TIMEOUT_MS,
  buildTranscribeProgress,
  estimateTranscribeFinish,
  parseClockToMs,
  parseWhisperLine,
  whisperTimeoutMs,
  writeProgressFile,
} from "./whisper-progress.ts";

describe("таймаут whisper", () => {
  it("по умолчанию 23 часа", () => {
    expect(DEFAULT_WHISPER_TIMEOUT_MS).toBe(23 * 60 * 60 * 1000);
    expect(whisperTimeoutMs({})).toBe(DEFAULT_WHISPER_TIMEOUT_MS);
  });

  it("берёт PM_ASSISTANT_WHISPER_TIMEOUT_MS если задан", () => {
    expect(
      whisperTimeoutMs({ PM_ASSISTANT_WHISPER_TIMEOUT_MS: "120000" }),
    ).toBe(120000);
  });
});

describe("разбор вывода whisper", () => {
  it("читает сегмент с таймкодом", () => {
    const parsed = parseWhisperLine(
      "[00:00:04.000 --> 00:00:08.200]  Начинаем созвон",
    );
    expect(parsed).toEqual({
      kind: "segment",
      segment: {
        speaker: "Спикер 1",
        startedAtMs: 4000,
        endedAtMs: 8200,
        text: "Начинаем созвон",
      },
    });
  });

  it("читает процент прогресса", () => {
    expect(
      parseWhisperLine("whisper_print_progress_callback: progress = 12%"),
    ).toEqual({ kind: "progress", percent: 12 });
  });

  it("игнорирует служебные строки", () => {
    expect(parseWhisperLine("main: processing audio")).toBeNull();
  });
});

describe("оценка окончания расшифровки", () => {
  it("считает ETA по доле обработанного звука", () => {
    expect(parseClockToMs("00:01:03.500")).toBe(63500);
    const result = estimateTranscribeFinish({
      startedAt: "2026-09-05T14:00:00.000Z",
      now: "2026-09-05T14:05:00.000Z",
      audioDurationMs: 600_000,
      transcribedMs: 150_000,
    });
    expect(result.percent).toBe(25);
    expect(result.remainingMs).toBe(15 * 60 * 1000);
    expect(result.etaAt).toBe("2026-09-05T14:20:00.000Z");
  });

  it("без прогресса не выдумывает время", () => {
    const result = estimateTranscribeFinish({
      startedAt: "2026-09-05T14:00:00.000Z",
      now: "2026-09-05T14:05:00.000Z",
      audioDurationMs: 600_000,
      transcribedMs: 0,
    });
    expect(result.etaAt).toBeNull();
  });

  it("собирает прогресс из файла и сегментов", () => {
    const dir = mkdtempSync(join(tmpdir(), "pm-progress-"));
    const audioPath = join(dir, "meeting.wav");
    writeFileSync(audioPath, "RIFF");
    writeProgressFile(audioPath, { percent: 40, transcribedMs: 120_000 });
    const progress = buildTranscribeProgress({
      startedAt: "2026-09-05T14:00:00.000Z",
      now: "2026-09-05T14:10:00.000Z",
      audioPath,
      segments: [{ endedAtMs: 80_000 }],
    });
    expect(progress?.percent).toBe(40);
    expect(progress?.etaAt).toBe("2026-09-05T14:25:00.000Z");
  });
});
