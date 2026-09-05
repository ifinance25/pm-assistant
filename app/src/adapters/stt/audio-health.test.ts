import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SILENT_MEAN_DB,
  measureLoudness,
  parseVolumedetect,
} from "./audio-health.ts";
import { liveTranscribe } from "./live.ts";
import { runFfmpeg, whichFfmpeg } from "./trim-silence.ts";

describe("parseVolumedetect", () => {
  it("читает уровни из вывода ffmpeg", () => {
    const log = [
      "[Parsed_volumedetect_0 @ 0x80f004e40] n_samples: 789120",
      "[Parsed_volumedetect_0 @ 0x80f004e40] mean_volume: -38.0 dB",
      "[Parsed_volumedetect_0 @ 0x80f004e40] max_volume: -16.9 dB",
    ].join("\n");
    expect(parseVolumedetect(log)).toEqual({ meanDb: -38, maxDb: -16.9 });
  });

  it("на цифровой тишине даёт уровень ниже порога", () => {
    const log = [
      "[Parsed_volumedetect_0 @ 0x1] mean_volume: -91.0 dB",
      "[Parsed_volumedetect_0 @ 0x1] max_volume: -91.0 dB",
    ].join("\n");
    const loudness = parseVolumedetect(log);
    expect(loudness?.meanDb).toBeLessThan(SILENT_MEAN_DB);
  });

  it("без уровней в логе возвращает null", () => {
    expect(parseVolumedetect("Duration: 00:00:36.00")).toBeNull();
  });
});

describe("measureLoudness", () => {
  it("на тишине даёт уровень ниже порога, на тоне выше", async () => {
    const ffmpeg = whichFfmpeg();
    if (!ffmpeg) {
      return;
    }
    const dir = await mkdtemp(join(tmpdir(), "pm-health-"));
    try {
      const silent = join(dir, "silent.wav");
      const tone = join(dir, "tone.wav");
      await runFfmpeg(ffmpeg, [
        "-y", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono",
        "-t", "2", silent,
      ]);
      await runFfmpeg(ffmpeg, [
        "-y", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=16000",
        "-t", "2", "-ac", "1", tone,
      ]);

      const quiet = await measureLoudness(silent, ffmpeg);
      expect(quiet?.meanDb).toBeLessThan(SILENT_MEAN_DB);

      const loud = await measureLoudness(tone, ffmpeg);
      expect(loud?.meanDb).toBeGreaterThan(SILENT_MEAN_DB);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("liveTranscribe на тишине", () => {
  it("падает с понятной ошибкой и не запускает whisper", async () => {
    const ffmpeg = whichFfmpeg();
    if (!ffmpeg) {
      return;
    }
    const dir = await mkdtemp(join(tmpdir(), "pm-health-"));
    try {
      const silent = join(dir, "silent.wav");
      await runFfmpeg(ffmpeg, [
        "-y", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono",
        "-t", "2", silent,
      ]);

      await expect(
        liveTranscribe(
          silent,
          { languageHint: "ru" },
          { kind: "whisper-cli", bin: "/nonexistent/whisper" },
        ),
      ).rejects.toThrow(/звук не записался/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
