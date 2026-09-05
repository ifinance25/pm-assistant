import { existsSync, openSync, readSync, closeSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { TranscribeProgress } from "../../shared/types.ts";
import type { SttSegment } from "./index.ts";

export const DEFAULT_WHISPER_TIMEOUT_MS = 23 * 60 * 60 * 1000;

export type WhisperProgressFile = {
  percent: number;
  transcribedMs: number;
  updatedAt: string;
};

export function whisperTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = Number(env.PM_ASSISTANT_WHISPER_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  return DEFAULT_WHISPER_TIMEOUT_MS;
}

export function parseClockToMs(value: string): number {
  const parts = value.trim().split(":");
  if (parts.length === 3) {
    const hours = Number(parts[0]);
    const minutes = Number(parts[1]);
    const seconds = Number(parts[2]);
    return Math.round(((hours * 60 + minutes) * 60 + seconds) * 1000);
  }
  if (parts.length === 2) {
    const minutes = Number(parts[0]);
    const seconds = Number(parts[1]);
    return Math.round((minutes * 60 + seconds) * 1000);
  }
  return Math.round(Number(value) * 1000);
}

const SEGMENT_LINE =
  /\[(\d{1,2}:\d{2}(?::\d{2})?\.\d{3})\s+-->\s+(\d{1,2}:\d{2}(?::\d{2})?\.\d{3})\]\s*(.*)$/;
const PROGRESS_LINE = /progress\s*=\s*(\d+)\s*%/i;

export function parseWhisperLine(
  line: string,
):
  | { kind: "segment"; segment: SttSegment }
  | { kind: "progress"; percent: number }
  | null {
  const progress = PROGRESS_LINE.exec(line);
  if (progress) {
    return { kind: "progress", percent: Number(progress[1]) };
  }
  const match = SEGMENT_LINE.exec(line.trim());
  if (!match) {
    return null;
  }
  const text = match[3].trim();
  if (!text) {
    return null;
  }
  return {
    kind: "segment",
    segment: {
      speaker: "Спикер 1",
      startedAtMs: parseClockToMs(match[1]),
      endedAtMs: parseClockToMs(match[2]),
      text,
    },
  };
}

export function estimateTranscribeFinish(input: {
  startedAt: string;
  now: string;
  audioDurationMs: number;
  transcribedMs: number;
  percentHint?: number | null;
}): { percent: number; etaAt: string | null; remainingMs: number | null } {
  const elapsed = Date.parse(input.now) - Date.parse(input.startedAt);
  const fromAudio =
    input.audioDurationMs > 0
      ? (input.transcribedMs / input.audioDurationMs) * 100
      : 0;
  const percent = Math.min(
    99.9,
    Math.max(0, input.percentHint ?? fromAudio),
  );
  if (percent <= 0 || elapsed <= 0) {
    return { percent, etaAt: null, remainingMs: null };
  }
  const remainingMs = Math.round(elapsed * ((100 - percent) / percent));
  return {
    percent,
    etaAt: new Date(Date.parse(input.now) + remainingMs).toISOString(),
    remainingMs,
  };
}

export function wavDurationMs(path: string): number | null {
  if (!existsSync(path)) {
    return null;
  }
  const size = statSync(path).size;
  if (size <= 44) {
    return null;
  }
  const header = Buffer.alloc(44);
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return null;
  }
  try {
    if (readSync(fd, header, 0, 44, 0) < 44) {
      return null;
    }
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
  try {
    if (header.toString("ascii", 0, 4) !== "RIFF") {
      return null;
    }
    const channels = header.readUInt16LE(22);
    const sampleRate = header.readUInt32LE(24);
    const bitsPerSample = header.readUInt16LE(34);
    const bytesPerSec = sampleRate * channels * (bitsPerSample / 8);
    if (!bytesPerSec) {
      return null;
    }
    return Math.round(((size - 44) / bytesPerSec) * 1000);
  } catch {
    return null;
  }
}

export function progressFilePath(audioPath: string): string {
  return join(dirname(audioPath), `${basename(audioPath)}.progress.json`);
}

export function writeProgressFile(
  audioPath: string,
  data: Omit<WhisperProgressFile, "updatedAt">,
): void {
  const payload: WhisperProgressFile = {
    ...data,
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(progressFilePath(audioPath), JSON.stringify(payload));
}

export function readProgressFile(
  audioPath: string,
): WhisperProgressFile | null {
  const path = progressFilePath(audioPath);
  if (!existsSync(path)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as WhisperProgressFile;
    if (!Number.isFinite(parsed.percent)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function lastTranscribedMs(
  segments: { endedAtMs: number | null }[],
): number {
  let last = 0;
  for (const segment of segments) {
    if (segment.endedAtMs != null && segment.endedAtMs > last) {
      last = segment.endedAtMs;
    }
  }
  return last;
}

export function buildTranscribeProgress(input: {
  startedAt: string | null;
  now?: string;
  audioPath: string | null;
  segments: { endedAtMs: number | null }[];
}): TranscribeProgress | null {
  if (!input.startedAt) {
    return null;
  }
  const transcribedMs = lastTranscribedMs(input.segments);
  const audioDurationMs = input.audioPath
    ? wavDurationMs(input.audioPath)
    : null;
  const stored = input.audioPath ? readProgressFile(input.audioPath) : null;
  const estimated = estimateTranscribeFinish({
    startedAt: input.startedAt,
    now: input.now ?? new Date().toISOString(),
    audioDurationMs: audioDurationMs ?? 0,
    transcribedMs: stored?.transcribedMs ?? transcribedMs,
    percentHint: stored?.percent ?? null,
  });
  return {
    percent: estimated.percent,
    etaAt: estimated.etaAt,
    remainingMs: estimated.remainingMs,
    transcribedMs: stored?.transcribedMs ?? transcribedMs,
    audioDurationMs,
    startedAt: input.startedAt,
  };
}
