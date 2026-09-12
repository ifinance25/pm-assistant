import { existsSync, readFileSync } from "node:fs";
import { speakersTimelinePath, trimOffsetPath } from "./audio-id.ts";
import type { SttSegment } from "./index.ts";

export type SpeakerTimelineEntry = { atMs: number; name: string };
export type SpeakerTimeline = SpeakerTimelineEntry[];

export function loadSpeakerTimeline(path: string): SpeakerTimeline {
  if (!existsSync(path)) {
    return [];
  }
  try {
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw.filter(
      (entry): entry is SpeakerTimelineEntry =>
        Boolean(entry) &&
        typeof (entry as SpeakerTimelineEntry).atMs === "number" &&
        typeof (entry as SpeakerTimelineEntry).name === "string" &&
        (entry as SpeakerTimelineEntry).name.trim().length > 0,
    );
  } catch {
    return [];
  }
}

export function loadTrimOffsetMs(audioPath: string): number {
  const path = trimOffsetPath(audioPath);
  if (!existsSync(path)) {
    return 0;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      startMs?: number;
    };
    return Number.isFinite(parsed.startMs) ? Number(parsed.startMs) : 0;
  } catch {
    return 0;
  }
}

/**
 * Ставит сегменту имя того, кто говорил дольше всех в его окне таймлайна.
 * Таймлайн — точки смены активного спикера, отсортированные по времени;
 * окно между соседними точками принадлежит имени слева от него.
 * Пустой таймлайн — сегменты не трогаем (см. фаза 4.3 спеки).
 */
export function assignSpeakers(
  segments: SttSegment[],
  timeline: SpeakerTimeline,
): SttSegment[] {
  if (timeline.length === 0) {
    return segments;
  }
  const sorted = [...timeline].sort((a, b) => a.atMs - b.atMs);
  return segments.map((segment) => {
    const name = dominantSpeaker(segment, sorted);
    return name ? { ...segment, speaker: name } : segment;
  });
}

function dominantSpeaker(
  segment: SttSegment,
  timeline: SpeakerTimeline,
): string | null {
  const start = segment.startedAtMs;
  const end = segment.endedAtMs ?? start;
  if (start < timeline[0].atMs) {
    return timeline[0].name;
  }
  const talkMs = new Map<string, number>();
  for (let i = 0; i < timeline.length; i += 1) {
    const entry = timeline[i];
    const next = timeline[i + 1];
    const entryEnd = next ? next.atMs : Number.POSITIVE_INFINITY;
    const overlap = Math.min(end, entryEnd) - Math.max(start, entry.atMs);
    if (overlap > 0) {
      talkMs.set(entry.name, (talkMs.get(entry.name) ?? 0) + overlap);
    }
  }
  let best: string | null = null;
  let bestMs = -1;
  for (const [name, ms] of talkMs) {
    if (ms > bestMs) {
      best = name;
      bestMs = ms;
    }
  }
  return best;
}

/**
 * Читает таймлайн и смещение после срезки тишины рядом с файлом звука
 * и раскладывает реплики по именам. Нет таймлайна — сегменты не трогаем.
 */
export function applySpeakerTimeline(
  segments: SttSegment[],
  audioPath: string,
): SttSegment[] {
  const raw = loadSpeakerTimeline(speakersTimelinePath(audioPath));
  if (raw.length === 0) {
    return segments;
  }
  const offsetMs = loadTrimOffsetMs(audioPath);
  const shifted =
    offsetMs === 0
      ? raw
      : raw.map((entry) => ({
          ...entry,
          atMs: Math.max(0, entry.atMs - offsetMs),
        }));
  return assignSpeakers(segments, shifted);
}
