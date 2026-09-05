import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import {
  normalizeMeetingAudio,
  parseSpeechWindow,
  probeDurationMs,
  speechAudioPath,
  trimEdgeSilence,
  whichFfmpeg,
} from "./trim-silence.ts";

describe("parseSpeechWindow", () => {
  it("берёт только ведущую и хвостовую тишину, паузу в середине оставляет в окне", () => {
    const log = [
      "silence_start: 0",
      "silence_end: 1.0 | silence_duration: 1.0",
      "silence_start: 2.0",
      "silence_end: 3.0 | silence_duration: 1.0",
      "silence_start: 4.0",
      "silence_end: 5.0 | silence_duration: 1.0",
    ].join("\n");
    expect(parseSpeechWindow(log, 5000)).toEqual({
      startMs: 1000,
      endMs: 4000,
    });
  });

  it("без тишины в начале оставляет start=0", () => {
    const log = [
      "silence_start: 2.5",
      "silence_end: 3.0 | silence_duration: 0.5",
    ].join("\n");
    expect(parseSpeechWindow(log, 5000)).toEqual({
      startMs: 0,
      endMs: 5000,
    });
  });

  it("на сплошной тишине возвращает null", () => {
    const log = [
      "silence_start: 0",
      "silence_end: 10.0 | silence_duration: 10.0",
    ].join("\n");
    expect(parseSpeechWindow(log, 10000)).toBeNull();
  });

  it("на живой записи срезает 86 с начала и хвост, паузы в середине оставляет", () => {
    const log = [
      "silence_start: 0",
      "silence_end: 85.979187 | silence_duration: 85.979187",
      "silence_start: 91.760875",
      "silence_end: 94.44225 | silence_duration: 2.681375",
      "silence_start: 155.309188",
      "silence_end: 162.42 | silence_duration: 7.110812",
    ].join("\n");
    expect(parseSpeechWindow(log, 162420)).toEqual({
      startMs: 85979,
      endMs: 155309,
    });
  });
});

describe("speechAudioPath", () => {
  it("даёт один и тот же путь и не наращивает суффикс при повторе", () => {
    const once = speechAudioPath("/data/audio/abc-123.webm");
    expect(once).toBe("/data/audio/abc-123.speech.wav");
    expect(speechAudioPath(once)).toBe(once);
  });
});

describe("normalizeMeetingAudio", () => {
  it("кладёт подготовленный файл рядом и удаляет исходник", async () => {
    const ffmpeg = whichFfmpeg();
    if (!ffmpeg) {
      return;
    }
    const dir = await mkdtemp(join(tmpdir(), "pm-normalize-"));
    try {
      const src = join(dir, "meeting.wav");
      await writeFile(src, makeToneWav());

      const prepared = await normalizeMeetingAudio(src, ffmpeg);

      expect(prepared).toBe(join(dir, "meeting.speech.wav"));
      expect(existsSync(prepared as string)).toBe(true);
      expect(existsSync(src)).toBe(false);

      const duration = await probeDurationMs(prepared as string);
      expect(duration).toBeGreaterThan(1500);
      expect(duration).toBeLessThan(3000);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("на сплошной тишине возвращает null и исходник не удаляет", async () => {
    const ffmpeg = whichFfmpeg();
    if (!ffmpeg) {
      return;
    }
    const dir = await mkdtemp(join(tmpdir(), "pm-normalize-"));
    try {
      const src = join(dir, "silent.wav");
      await writeFile(src, makeSilentWav());

      expect(await normalizeMeetingAudio(src, ffmpeg)).toBeNull();
      expect(existsSync(src)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("trimEdgeSilence", () => {
  it("срезает края wav и сохраняет тишину между двумя тонами", async () => {
    const ffmpeg = whichFfmpeg();
    if (!ffmpeg) {
      return;
    }
    const dir = await mkdtemp(join(tmpdir(), "pm-trim-"));
    try {
      const src = join(dir, "src.wav");
      const dest = join(dir, "out.wav");
      await writeFile(src, makeToneWav());
      const window = await trimEdgeSilence(src, dest);
      expect(window).not.toBeNull();
      expect(window?.startMs).toBeGreaterThanOrEqual(800);
      expect(window?.startMs).toBeLessThan(1300);
      const duration = await probeDurationMs(dest);
      expect(duration).toBeGreaterThan(1500);
      expect(duration).toBeLessThan(3000);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function makeToneWav(): Buffer {
  const rate = 16000;
  const amp = 8000;
  return wavFromChunks([
    new Int16Array(rate),
    tone(rate * 0.5, rate, amp),
    new Int16Array(rate),
    tone(rate * 0.5, rate, amp),
    new Int16Array(rate),
  ]);
}

function makeSilentWav(): Buffer {
  return wavFromChunks([new Int16Array(16000 * 3)]);
}

function wavFromChunks(chunks: Int16Array[]): Buffer {
  const rate = 16000;
  const total = chunks.reduce((sum, part) => sum + part.length, 0);
  const pcm = new Int16Array(total);
  let offset = 0;
  for (const part of chunks) {
    pcm.set(part, offset);
    offset += part.length;
  }
  const dataBytes = pcm.length * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);
  Buffer.from(pcm.buffer, pcm.byteOffset, dataBytes).copy(buffer, 44);
  return buffer;
}

function tone(samples: number, rate: number, amp: number): Int16Array {
  const out = new Int16Array(samples);
  for (let i = 0; i < samples; i++) {
    out[i] = Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * amp);
  }
  return out;
}
