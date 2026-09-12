import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { SILENT_MEAN_DB, measureLoudness } from "./audio-health.ts";
import { applySpeakerTimeline } from "./diarize.ts";
import { dropHallucinations } from "./hallucinations.ts";
import type { SttEngine, SttSegment, Transcript, TranscribeOptions } from "./index.ts";
import {
  parseWhisperLine,
  whisperTimeoutMs,
  writeProgressFile,
} from "./whisper-progress.ts";
import {
  flattenTranscriptBlocks,
  groupTranscriptSegments,
} from "../../shared/group-transcript.ts";

type WhisperSegment = {
  start?: number;
  end?: number;
  text?: string;
};

type WhisperJson = {
  segments?: WhisperSegment[];
};

function groupedStt(segments: SttSegment[]): SttSegment[] {
  return flattenTranscriptBlocks(groupTranscriptSegments(segments));
}

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
    await runWhisper(
      engine.bin,
      audioPath,
      tmp,
      options.languageHint,
      (segments, percent) => {
        const cleaned = groupedStt(
          applySpeakerTimeline(dropHallucinations(segments), audioPath),
        );
        options.onPartial?.(cleaned);
        try {
          writeProgressFile(audioPath, {
            percent,
            transcribedMs: cleaned.reduce(
              (max, segment) =>
                Math.max(max, segment.endedAtMs ?? segment.startedAtMs),
              0,
            ),
          });
        } catch {
          // экран просто без процента, расшифровка идёт дальше
        }
      },
    );
    const jsonPath = join(
      tmp,
      `${basename(audioPath, extname(audioPath))}.json`,
    );
    const data = JSON.parse(await readFile(jsonPath, "utf8")) as WhisperJson;
    const segments = groupedStt(
      applySpeakerTimeline(
        dropHallucinations(
          (data.segments ?? []).map((segment) => ({
            speaker: "Спикер 1",
            startedAtMs: Math.round((segment.start ?? 0) * 1000),
            endedAtMs:
              segment.end == null ? null : Math.round(segment.end * 1000),
            text: String(segment.text ?? "").trim(),
          })),
        ),
        audioPath,
      ),
    );
    return { mode: "live", segments };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/**
 * Словарь по умолчанию (фаза 5.2c): только рабочий жаргон проекта, без
 * имён коллег — их не подставляем от себя. PM_ASSISTANT_WHISPER_PROMPT
 * переопределяет это значение целиком, пустая строка в переменной
 * отключает словарь совсем.
 */
export const DEFAULT_WHISPER_PROMPT =
  "блокеры, спринт, релиз, деплой, Jira, Asana, ClickUp, эпик, ретро, стендап";

/**
 * PM_ASSISTANT_WHISPER_PROMPT — словарь терминов и жаргона для Whisper
 * (фаза 5.2 плана качества). whisper-compat.py передаёт его дальше
 * в whisper.cpp как --prompt.
 */
export function buildWhisperArgs(
  audioPath: string,
  outputDir: string,
  languageHint: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
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
  const rawPrompt = env.PM_ASSISTANT_WHISPER_PROMPT;
  const prompt = rawPrompt === undefined ? DEFAULT_WHISPER_PROMPT : rawPrompt.trim();
  if (prompt) {
    args.push("--initial_prompt", prompt);
  }
  return args;
}

function runWhisper(
  bin: string,
  audioPath: string,
  outputDir: string,
  languageHint: string | undefined,
  onUpdate: (segments: SttSegment[], percent: number) => void,
): Promise<void> {
  const args = buildWhisperArgs(audioPath, outputDir, languageHint);
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
        LD_LIBRARY_PATH: ["/usr/local/lib", process.env.LD_LIBRARY_PATH ?? ""]
          .filter(Boolean)
          .join(":"),
      },
    });
    const timeoutMs = whisperTimeoutMs();
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2000);
      reject(new Error("whisper превысил время ожидания"));
    }, timeoutMs);
    const partial: SttSegment[] = [];
    let percent = 0;
    let stderr = "";
    const onLine = (line: string) => {
      const parsed = parseWhisperLine(line);
      if (!parsed) {
        return;
      }
      if (parsed.kind === "progress") {
        percent = parsed.percent;
        onUpdate(partial, percent);
        return;
      }
      const existing = partial.findIndex(
        (item) => item.startedAtMs === parsed.segment.startedAtMs,
      );
      if (existing >= 0) {
        partial[existing] = parsed.segment;
      } else {
        partial.push(parsed.segment);
      }
      onUpdate(partial, percent);
    };
    const feed = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderr += text;
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) {
          onLine(line);
        }
      }
    };
    child.stdout?.on("data", feed);
    child.stderr?.on("data", feed);
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
