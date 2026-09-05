import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { SILENT_MEAN_DB, measureLoudness } from "./audio-health.ts";
import { dropHallucinations } from "./hallucinations.ts";
import type { SttEngine, Transcript, TranscribeOptions } from "./index.ts";

type WhisperSegment = {
  start?: number;
  end?: number;
  text?: string;
};

type WhisperJson = {
  segments?: WhisperSegment[];
};

export async function liveTranscribe(
  audioPath: string,
  options: TranscribeOptions,
  engine: SttEngine,
): Promise<Transcript> {
  const loudness = await measureLoudness(audioPath);
  if (loudness && loudness.meanDb < SILENT_MEAN_DB) {
    throw new Error(
      `звук не записался: бот не поймал аудио звонка (средняя громкость ${loudness.meanDb} dB)`,
    );
  }
  const tmp = await mkdtemp(join(tmpdir(), "pm-stt-"));
  try {
    await runWhisper(engine.bin, audioPath, tmp, options.languageHint);
    const jsonPath = join(
      tmp,
      `${basename(audioPath, extname(audioPath))}.json`,
    );
    const data = JSON.parse(await readFile(jsonPath, "utf8")) as WhisperJson;
    const segments = dropHallucinations(
      (data.segments ?? []).map((segment) => ({
        speaker: "Спикер 1",
        startedAtMs: Math.round((segment.start ?? 0) * 1000),
        endedAtMs:
          segment.end == null ? null : Math.round(segment.end * 1000),
        text: String(segment.text ?? "").trim(),
      })),
    );
    return { mode: "live", segments };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

function runWhisper(
  bin: string,
  audioPath: string,
  outputDir: string,
  languageHint?: string,
): Promise<void> {
  const args = [
    audioPath,
    "--output_format",
    "json",
    "--output_dir",
    outputDir,
    "--verbose",
    "False",
  ];
  if (languageHint) {
    args.push("--language", languageHint);
  }
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        LD_LIBRARY_PATH: [
          "/usr/local/lib",
          process.env.LD_LIBRARY_PATH ?? "",
        ]
          .filter(Boolean)
          .join(":"),
      },
    });
    const timeoutMs = Number(process.env.PM_ASSISTANT_WHISPER_TIMEOUT_MS) || 10 * 60 * 1000;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("whisper превысил время ожидания"));
    }, timeoutMs);
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      const detail = stderr.trim().slice(-1500);
      reject(
        new Error(
          detail
            ? `whisper завершился с кодом ${code}: ${detail}`
            : `whisper завершился с кодом ${code}`,
        ),
      );
    });
  });
}
