import type { Transcript } from "../stt/index.ts";
import type { SummarizeResult } from "./index.ts";
import type { RevisePassResult } from "./revise.ts";
import {
  applyReviseJson,
  reviseUserContent,
  type ReviseJson,
} from "./revise.ts";
import {
  parseLlmJson,
  SUMMARIZE_SYSTEM_PROMPT,
  toSummarizeResult,
} from "./live.ts";
import {
  summarizeUserContent,
  type SummarizeSegment,
} from "./summarize-content.ts";
import { runCursorCliPrompt } from "./cursor-cli.ts";

async function cursorCliText(
  apiKey: string,
  system: string,
  user: string,
): Promise<string> {
  const prompt = [
    system,
    "",
    user,
    "",
    "Ответь только JSON без markdown и без пояснений вне JSON.",
  ].join("\n");
  const result = await runCursorCliPrompt(prompt, apiKey);
  const text = result.stdout.trim();
  if (!result.ok) {
    const detail = (result.stderr || text).trim().slice(0, 300);
    throw new Error(
      detail
        ? `cursor cli завершился с ошибкой: ${detail}`
        : "cursor cli завершился с ошибкой",
    );
  }
  if (!text) {
    throw new Error("cursor cli вернул пустой ответ");
  }
  return text;
}

export async function liveSummarizeCursor(
  transcript: Transcript,
  apiKey: string,
): Promise<SummarizeResult> {
  const raw = await cursorCliText(
    apiKey,
    SUMMARIZE_SYSTEM_PROMPT,
    summarizeUserContent(transcript.segments as SummarizeSegment[]),
  );
  return toSummarizeResult(
    parseLlmJson(raw),
    transcript.segments as SummarizeSegment[],
  );
}

export async function liveReviseCursor(
  transcript: Transcript,
  apiKey: string,
): Promise<RevisePassResult> {
  const raw = await cursorCliText(
    apiKey,
    [
      "Ты корректор расшифровки речи (STT). Ответь только JSON без markdown.",
      "Вход: segments с speaker, startedAtMs, endedAtMs, text.",
      "Исправь явные ослышки и несоответствия (бута→бота, лаланки→колонки, блогеры→блокеры).",
      "Галлюцинации на тишине вычеркни: не включай сегмент.",
      "Нельзя выдумывать факты и речь, которых нет во входном тексте.",
      "Нельзя сжимать текст в саммари на этом шаге.",
      "Таймкоды не меняй без нужды: правь text сегмента, speaker оставляй.",
      'Если правок нет: {"unchanged":true}.',
      'Если правки есть: {"unchanged":false,"segments":[...полный список оставшихся сегментов...]}',
      "Не используй длинное тире.",
    ].join(" "),
    reviseUserContent(transcript),
  );
  return applyReviseJson(transcript, parseLlmJson<ReviseJson>(raw));
}
