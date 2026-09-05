import {
  LIVE_AUDIO_MISSING_TEXT,
  LIVE_AUDIO_PENDING_TEXT,
} from "../stt/pending.ts";
import type { Transcript } from "../stt/index.ts";
import type { SummarizeResult } from "./index.ts";

export function liveAudioPendingSummary(
  audioPath: string | null,
): SummarizeResult {
  if (audioPath) {
    return {
      mode: "live",
      summary: {
        headline: LIVE_AUDIO_PENDING_TEXT,
        decisions:
          "Расшифровка не запускалась: нет локального Whisper или он не смог прочитать файл.",
        risks: "Итоги встречи появятся после расшифровки сохранённого звука.",
        nextStep:
          "Проверьте WHISPER_BIN и обработайте встречу снова, когда распознавание будет доступно.",
        decisionSegmentIds: [],
      },
      actionItems: [],
    };
  }
  return {
    mode: "live",
    summary: {
      headline: LIVE_AUDIO_MISSING_TEXT,
      decisions: "Файл звука не получен после живого входа в звонок.",
      risks: "Без звука нет расшифровки и списка задач.",
      nextStep:
        "Повторите звонок и дождитесь, пока бот останется до конца встречи.",
      decisionSegmentIds: [],
    },
    actionItems: [],
  };
}

export const REVIEW_SKIPPED_NOTICE =
  "Ревью расшифровки не применилось, показан сырой текст.";

export function summaryFromTranscriptOnly(
  transcript: Transcript,
  opts?: {
    reason?: "missing-key" | "rate-limit" | "failed";
    reviewSkipped?: boolean;
  },
): SummarizeResult {
  const text = transcript.segments
    .map((segment) => segment.text)
    .join(" ")
    .trim();
  const reason = opts?.reason ?? "missing-key";
  const decisions =
    reason === "rate-limit"
      ? "Автоматическое резюме недоступно: языковая модель вернула лимит запросов (429)."
      : reason === "failed"
        ? "Автоматическое резюме недоступно: языковая модель не ответила."
        : "Автоматическое резюме недоступно: нет ключа языковой модели.";
  const nextStep =
    reason === "rate-limit"
      ? "Повторите подготовку резюме позже, когда лимит запросов снимется."
      : "Добавьте CLAUDE_CODE_OAUTH_TOKEN (подписка) или OPENAI_API_KEY, чтобы получить краткое резюме и задачи.";
  const risks = [
    opts?.reviewSkipped ? REVIEW_SKIPPED_NOTICE : "",
    reason === "rate-limit"
      ? "Резюме собрано из расшифровки без языковой модели."
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  return {
    mode: "live",
    summary: {
      headline:
        text.slice(0, 180) ||
        "Расшифровка готова, резюме без языковой модели",
      decisions: text ? decisions : "В расшифровке нет текста.",
      risks,
      nextStep,
      decisionSegmentIds: [],
    },
    actionItems: [],
  };
}
