import type { SttSegment } from "../stt/index.ts";

export type SummarizeSegment = SttSegment & { id?: string };

export const SUMMARIZE_SEGMENT_PROMPT = [
  "Вход: строки [id=<segmentId>] Спикер: текст.",
  "decisionItems: массив {text, segmentId} для каждого решения.",
  "actionItems: массив {assignee, title, dueAt (YYYY-MM-DD или null), timecodeMs (число или null), segmentId}.",
  "segmentId и timecodeMs должны ссылаться на сегмент из входа.",
].join(" ");

export function summarizeUserContent(segments: SummarizeSegment[]): string {
  return segments
    .map((segment) => {
      const id = segment.id?.trim() || "unknown";
      return `[id=${id}] ${segment.speaker}: ${segment.text}`;
    })
    .join("\n");
}

export function resolveSegmentId(
  segments: SummarizeSegment[],
  timecodeMs: number | null,
  explicitId: string | null | undefined,
): string | null {
  const ids = new Set(
    segments.map((segment) => segment.id).filter((id): id is string => Boolean(id)),
  );
  if (explicitId && ids.has(explicitId)) {
    return explicitId;
  }
  if (timecodeMs == null) {
    return null;
  }
  const exact = segments.find((segment) => segment.startedAtMs === timecodeMs);
  if (exact?.id) {
    return exact.id;
  }
  const range = segments.find(
    (segment) =>
      timecodeMs >= segment.startedAtMs &&
      (segment.endedAtMs == null || timecodeMs <= segment.endedAtMs),
  );
  return range?.id ?? null;
}
