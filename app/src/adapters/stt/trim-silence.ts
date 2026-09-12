import { execFileSync, spawn } from "node:child_process";
import { existsSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { trimOffsetPath } from "./audio-id.ts";

export type SpeechWindow = {
  startMs: number;
  endMs: number;
};

export type TrimmedAudio = {
  path: string;
  startMs: number;
};

const EDGE_EPS_MS = 80;
const MIN_SPEECH_MS = 250;
const SILENCE_NOISE = "-50dB";
const SILENCE_DURATION = "0.3";
const MIN_OUTPUT_BYTES = 1024;

/**
 * highpass убирает гул ниже речи, loudnorm поднимает тихую запись до
 * вещательного уровня. Записи звонков приходят на -20..-38 dB, и это
 * главная причина ослышек Whisper.
 */
const AUDIO_FILTERS = "highpass=f=80,loudnorm=I=-16:TP=-1.5:LRA=11";

export function parseSpeechWindow(
  silencedetectLog: string,
  durationMs: number,
): SpeechWindow | null {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return null;
  }
  const starts: number[] = [];
  const ends: number[] = [];
  for (const line of silencedetectLog.split(/\r?\n/)) {
    const start = /silence_start:\s*([-\d.]+)/.exec(line);
    if (start) {
      starts.push(Math.round(Number(start[1]) * 1000));
    }
    const end = /silence_end:\s*([-\d.]+)/.exec(line);
    if (end) {
      ends.push(Math.round(Number(end[1]) * 1000));
    }
  }
  let startMs = 0;
  if (starts[0] !== undefined && starts[0] <= EDGE_EPS_MS) {
    startMs = ends[0] ?? durationMs;
  }
  let endMs = durationMs;
  const lastStart = starts.at(-1);
  const lastEnd = ends.at(-1);
  if (lastStart !== undefined && lastStart > startMs + EDGE_EPS_MS) {
    const reachesEof =
      lastEnd === undefined ||
      lastEnd + EDGE_EPS_MS < lastStart ||
      Math.abs(lastEnd - durationMs) <= EDGE_EPS_MS;
    if (reachesEof) {
      endMs = lastStart;
    }
  }
  startMs = clamp(startMs, 0, durationMs);
  endMs = clamp(endMs, 0, durationMs);
  if (endMs - startMs < MIN_SPEECH_MS) {
    return null;
  }
  return { startMs, endMs };
}

export function parseFfmpegDurationMs(log: string): number | null {
  const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(log);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
}

export function whichFfmpeg(): string | null {
  const candidates = [
    process.env.FFMPEG_BIN?.trim(),
    "/opt/homebrew/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    "/usr/bin/ffmpeg",
  ].filter((bin): bin is string => Boolean(bin));
  for (const bin of candidates) {
    if (existsSync(bin)) {
      return bin;
    }
  }
  try {
    const found = execFileSync("which", ["ffmpeg"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return found && existsSync(found) ? found : null;
  } catch {
    return null;
  }
}

export async function probeDurationMs(
  audioPath: string,
  ffmpegBin = whichFfmpeg(),
): Promise<number> {
  if (!ffmpegBin) {
    throw new Error("нет ffmpeg");
  }
  const result = await runFfmpeg(ffmpegBin, ["-i", audioPath]);
  const duration = parseFfmpegDurationMs(result.stderr);
  if (duration == null) {
    throw new Error("ffmpeg не вернул длительность файла");
  }
  return duration;
}

export async function trimEdgeSilence(
  audioPath: string,
  outputPath: string,
  ffmpegBin = whichFfmpeg(),
): Promise<TrimmedAudio | null> {
  if (!ffmpegBin) {
    return { path: audioPath, startMs: 0 };
  }
  const detect = await runFfmpeg(ffmpegBin, [
    "-i",
    audioPath,
    "-af",
    `silencedetect=noise=${SILENCE_NOISE}:d=${SILENCE_DURATION}`,
    "-f",
    "null",
    "-",
  ]);
  const durationMs = parseFfmpegDurationMs(detect.stderr);
  if (durationMs == null) {
    return { path: audioPath, startMs: 0 };
  }
  const window = parseSpeechWindow(detect.stderr, durationMs);
  if (!window) {
    return null;
  }
  const args = ["-y", "-i", audioPath];
  if (window.startMs > EDGE_EPS_MS) {
    args.push("-ss", (window.startMs / 1000).toFixed(3));
  }
  if (durationMs - window.endMs > EDGE_EPS_MS) {
    args.push("-t", ((window.endMs - window.startMs) / 1000).toFixed(3));
  }
  args.push(
    "-af",
    AUDIO_FILTERS,
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "pcm_s16le",
    outputPath,
  );
  const cut = await runFfmpeg(ffmpegBin, args);
  if (cut.code !== 0 || !existsSync(outputPath)) {
    return { path: audioPath, startMs: 0 };
  }
  return { path: outputPath, startMs: window.startMs };
}

export function speechAudioPath(audioPath: string): string {
  const name = basename(audioPath)
    .replace(/\.speech\.wav$/i, "")
    .replace(/\.[^.]+$/, "");
  return join(dirname(audioPath), `${name}.speech.wav`);
}

/**
 * Готовит запись встречи: срезает ожидание входа в начале и хвост после
 * разговора, выравнивает громкость и кладёт результат рядом. Исходник
 * удаляется только после проверки готового файла.
 *
 * Возвращает путь к файлу, который дальше слушает и плеер, и Whisper.
 * null означает, что в записи одна тишина: звук не записался.
 */
export async function normalizeMeetingAudio(
  audioPath: string,
  ffmpegBin = whichFfmpeg(),
): Promise<string | null> {
  if (!ffmpegBin || !existsSync(audioPath)) {
    return audioPath;
  }
  const outputPath = speechAudioPath(audioPath);
  if (outputPath === audioPath) {
    return audioPath;
  }
  const prepared = await trimEdgeSilence(audioPath, outputPath, ffmpegBin);
  if (!prepared) {
    return null;
  }
  if (prepared.path === audioPath || !existsSync(outputPath)) {
    return audioPath;
  }
  if (statSync(outputPath).size < MIN_OUTPUT_BYTES) {
    rmSync(outputPath, { force: true });
    return audioPath;
  }
  try {
    writeFileSync(
      trimOffsetPath(audioPath),
      JSON.stringify({ startMs: prepared.startMs }),
    );
  } catch {
    // смещение не критично: таймлайн спикеров (фаза 4) просто не подстроится
  }
  rmSync(audioPath, { force: true });
  return outputPath;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function runFfmpeg(
  bin: string,
  args: string[],
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", () => resolve({ code: 1, stderr }));
    child.on("close", (code) => resolve({ code: code ?? 1, stderr }));
  });
}
