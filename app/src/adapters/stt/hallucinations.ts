import type { SttSegment } from "./index.ts";

/**
 * Whisper на тишине выдаёт заученные титры из обучающих данных.
 * Список собран по реальным расшифровкам проекта, см. artifacts/audio-regression-2026-09-04.
 */
const HALLUCINATION_PREFIXES = [
  "продолжение следует",
  "субтитры создавал",
  "субтитры сделал",
  "субтитры делал",
  "редактор субтитров",
  "спасибо за просмотр",
  "спасибо за внимание всем пока",
  "подписывайтесь на канал",
  "dimatorzok",
  "н закомолдина",
];

/** Сколько ещё символов после шаблона считаем частью той же выдумки, а не живой речью. */
const TAIL_TOLERANCE = 40;

export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function isHallucination(text: string): boolean {
  const normalized = normalizeForMatch(text);
  if (!normalized) {
    return true;
  }
  return HALLUCINATION_PREFIXES.some((prefix) => {
    if (!normalized.startsWith(prefix)) {
      return false;
    }
    return normalized.length <= prefix.length + TAIL_TOLERANCE;
  });
}

export function dropHallucinations(segments: SttSegment[]): SttSegment[] {
  return segments.filter((segment) => !isHallucination(segment.text));
}
