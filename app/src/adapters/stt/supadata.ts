import { meetingIdFromAudioPath } from "./audio-id.ts";
import { SILENT_MEAN_DB, measureLoudness } from "./audio-health.ts";
import { applySpeakerTimeline } from "./diarize.ts";
import { dropHallucinations } from "./hallucinations.ts";
import type { SttSegment, Transcript, TranscribeOptions } from "./index.ts";
import { createAudioShareToken } from "../../shared/audio-share-token.ts";
import {
  flattenTranscriptBlocks,
  groupTranscriptSegments,
} from "../../shared/group-transcript.ts";

const API_BASE = "https://api.supadata.ai/v1";
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 30 * 60 * 1000;

type SupadataContentItem = {
  text?: string;
  offset?: number;
  duration?: number;
};

type SupadataResponse = {
  jobId?: string;
  status?: "completed" | "failed" | "queued" | "active";
  content?: SupadataContentItem[] | string;
  error?: string;
};

export type SupadataDeps = {
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

/**
 * URL, по которому Supadata (внешний сервис) может скачать запись —
 * временная подписанная ссылка (фаза 6, "по токенам"), не открытие
 * всего приложения наружу. PM_ASSISTANT_PUBLIC_BASE_URL — публичный
 * адрес сервера (EC2), который сервер сам о себе знать не может:
 * задаёт пользователь явно.
 */
export function publicAudioUrl(meetingId: string): string {
  const base = (process.env.PM_ASSISTANT_PUBLIC_BASE_URL ?? "")
    .trim()
    .replace(/\/+$/, "");
  if (!base) {
    throw new Error(
      "нет PM_ASSISTANT_PUBLIC_BASE_URL: Supadata не сможет скачать файл по 127.0.0.1",
    );
  }
  const token = createAudioShareToken(meetingId);
  if (!token) {
    throw new Error(
      "нет APP_API_TOKEN: временную ссылку на запись нечем подписать",
    );
  }
  return `${base}/api/audio-share/${token}`;
}

function toSegments(
  content: SupadataContentItem[] | string | undefined,
): SttSegment[] {
  if (content == null) {
    return [];
  }
  if (typeof content === "string") {
    const text = content.trim();
    return text ? [{ speaker: "Спикер 1", startedAtMs: 0, endedAtMs: null, text }] : [];
  }
  return content
    .map((item) => {
      const offset = Math.max(0, Math.round(item.offset ?? 0));
      const duration = item.duration != null ? Math.round(item.duration) : null;
      return {
        speaker: "Спикер 1",
        startedAtMs: offset,
        endedAtMs: duration == null ? null : offset + duration,
        text: String(item.text ?? "").trim(),
      };
    })
    .filter((segment) => segment.text.length > 0);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollJob(
  jobId: string,
  apiKey: string,
  deps: Required<SupadataDeps>,
): Promise<SupadataResponse> {
  const deadline = deps.now() + POLL_TIMEOUT_MS;
  while (deps.now() < deadline) {
    const res = await deps.fetchImpl(`${API_BASE}/transcript/${jobId}`, {
      headers: { "x-api-key": apiKey },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Supadata: опрос задания вернул ${res.status} ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as SupadataResponse;
    if (data.status === "completed") {
      return data;
    }
    if (data.status === "failed") {
      throw new Error(`Supadata: задание не выполнено — ${data.error ?? "без деталей"}`);
    }
    await deps.sleep(POLL_INTERVAL_MS);
  }
  throw new Error("Supadata: превышено время ожидания задания");
}

/**
 * STT (распознавание речи) через внешний движок Supadata — второй движок
 * на выбор, не замена Whisper (см. Decisions Log 2026-09-05). Требует
 * публично доступный URL записи (фаза 6): подписанная временная ссылка,
 * не открытие приложения наружу целиком.
 */
export async function supadataTranscribe(
  audioPath: string,
  options: TranscribeOptions,
  deps: SupadataDeps = {},
): Promise<Transcript> {
  const apiKey = (process.env.SUPADATA_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new Error("нет SUPADATA_API_KEY");
  }
  const loudness = await measureLoudness(audioPath);
  if (loudness && loudness.meanDb < SILENT_MEAN_DB) {
    throw new Error(
      `звук не записался: бот не поймал аудио звонка (средняя громкость ${loudness.meanDb} dB)`,
    );
  }
  const fullDeps: Required<SupadataDeps> = {
    fetchImpl: deps.fetchImpl ?? fetch,
    now: deps.now ?? Date.now,
    sleep: deps.sleep ?? defaultSleep,
  };
  const meetingId = meetingIdFromAudioPath(audioPath);
  const url = publicAudioUrl(meetingId);
  const params = new URLSearchParams({ url, mode: "generate" });
  if (options.languageHint) {
    params.set("lang", options.languageHint);
  }
  const res = await fullDeps.fetchImpl(`${API_BASE}/transcript?${params.toString()}`, {
    headers: { "x-api-key": apiKey },
  });
  let data: SupadataResponse;
  if (res.status === 202) {
    const job = (await res.json()) as SupadataResponse;
    if (!job.jobId) {
      throw new Error("Supadata: нет jobId в ответе 202");
    }
    data = await pollJob(job.jobId, apiKey, fullDeps);
  } else if (res.ok) {
    data = (await res.json()) as SupadataResponse;
  } else {
    const body = await res.text().catch(() => "");
    throw new Error(`Supadata: ошибка ${res.status} ${body.slice(0, 300)}`);
  }
  const segments = flattenTranscriptBlocks(
    groupTranscriptSegments(
      applySpeakerTimeline(dropHallucinations(toSegments(data.content)), audioPath),
    ),
  );
  return { mode: "live", segments };
}
