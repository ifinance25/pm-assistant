import type { SttSegment, Transcript } from "../stt/index.ts";
import { kimiChatConfig } from "./credentials.ts";
import { openAiChatText } from "./openai-chat.ts";
import {
  fetchLlm,
  parseLlmJson,
  throwIfNotOk,
} from "./live.ts";

export const TRANSCRIPT_REVISE_MAX_PASSES = 3;

export const REVISE_SYSTEM_PROMPT = [
  "Ты корректор расшифровки речи (STT). Ответь только JSON без markdown.",
  "Вход: segments с speaker, startedAtMs, endedAtMs, text.",
  "Исправь явные ослышки и несоответствия (бута→бота, лаланки→колонки, блогеры→блокеры).",
  "Галлюцинации на тишине вроде «субтитры создавал DimaTorzok» или «Н.Закомолдина» вычеркни: не включай сегмент.",
  "Нельзя выдумывать факты и речь, которых нет во входном тексте.",
  "Нельзя сжимать текст в саммари на этом шаге.",
  "Таймкоды не меняй без нужды: правь text сегмента, speaker оставляй.",
  "Если правок нет: {\"unchanged\":true}.",
  "Если правки есть: {\"unchanged\":false,\"segments\":[...полный список оставшихся сегментов...]}",
  "Не используй длинное тире.",
].join(" ");

export type ReviseJson = {
  unchanged?: boolean;
  segments?: Array<{
    speaker?: string;
    startedAtMs?: number;
    endedAtMs?: number | null;
    text?: string;
  }>;
};

type ClaudeResponse = {
  content?: Array<{ type?: string; text?: string }>;
};

export type RevisePassResult = {
  transcript: Transcript;
  changed: boolean;
};

export function transcriptFingerprint(transcript: Transcript): string {
  return transcript.segments
    .map(
      (segment) =>
        `${segment.speaker}\t${segment.startedAtMs}\t${segment.endedAtMs ?? ""}\t${segment.text}`,
    )
    .join("\n");
}

export function transcriptsEqual(a: Transcript, b: Transcript): boolean {
  return transcriptFingerprint(a) === transcriptFingerprint(b);
}

function normalizeSegment(
  raw: NonNullable<ReviseJson["segments"]>[number],
  index: number,
  original: Transcript,
): SttSegment | null {
  const fallback = original.segments[index];
  const text = String(raw.text ?? "").trim();
  if (!text) {
    return null;
  }
  const startedAtMs = Number(
    typeof raw.startedAtMs === "number"
      ? raw.startedAtMs
      : (raw.startedAtMs ?? fallback?.startedAtMs ?? 0),
  );
  const endedAtRaw = raw.endedAtMs;
  const endedAtMs =
    endedAtRaw === undefined || endedAtRaw === null
      ? (fallback?.endedAtMs ?? null)
      : Number.isFinite(Number(endedAtRaw))
        ? Number(endedAtRaw)
        : (fallback?.endedAtMs ?? null);
  return {
    speaker: String(raw.speaker ?? fallback?.speaker ?? "Спикер").trim() || "Спикер",
    startedAtMs,
    endedAtMs,
    text,
  };
}

export function applyReviseJson(
  original: Transcript,
  parsed: ReviseJson,
): RevisePassResult {
  if (parsed.unchanged === true) {
    return { transcript: original, changed: false };
  }
  const rawSegments = parsed.segments;
  if (!Array.isArray(rawSegments)) {
    return { transcript: original, changed: false };
  }
  const segments = rawSegments
    .map((item, index) => normalizeSegment(item, index, original))
    .filter((item): item is SttSegment => item !== null);
  if (segments.length === 0) {
    return { transcript: original, changed: false };
  }
  const next: Transcript = { mode: original.mode, segments };
  if (transcriptsEqual(original, next)) {
    return { transcript: original, changed: false };
  }
  return { transcript: next, changed: true };
}

export function reviseUserContent(transcript: Transcript): string {
  return JSON.stringify({
    segments: transcript.segments.map((segment) => ({
      speaker: segment.speaker,
      startedAtMs: segment.startedAtMs,
      endedAtMs: segment.endedAtMs,
      text: segment.text,
    })),
  });
}

async function readClaudeText(res: Response): Promise<string> {
  const body = (await res.json()) as ClaudeResponse;
  const raw = body.content?.find((block) => block.type === "text")?.text;
  if (!raw) {
    throw new Error("llm вернул пустой ответ");
  }
  return raw;
}

export async function liveRevise(
  transcript: Transcript,
  apiKey: string,
): Promise<RevisePassResult> {
  const raw = await openAiChatText(
    { apiKey, model: "gpt-4o-mini" },
    REVISE_SYSTEM_PROMPT,
    reviseUserContent(transcript),
    true,
  );
  return applyReviseJson(transcript, parseLlmJson<ReviseJson>(raw));
}

export async function liveReviseKimi(
  transcript: Transcript,
  apiKey: string,
): Promise<RevisePassResult> {
  const raw = await openAiChatText(
    kimiChatConfig(apiKey),
    REVISE_SYSTEM_PROMPT,
    reviseUserContent(transcript),
    true,
  );
  return applyReviseJson(transcript, parseLlmJson<ReviseJson>(raw));
}

export async function liveReviseClaude(
  transcript: Transcript,
  oauthToken: string,
): Promise<RevisePassResult> {
  const res = await fetchLlm("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${oauthToken}`,
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "oauth-2025-04-20",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 8192,
      system: REVISE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: reviseUserContent(transcript) }],
    }),
  });
  throwIfNotOk(res);
  return applyReviseJson(transcript, parseLlmJson<ReviseJson>(await readClaudeText(res)));
}

export async function reviseTranscriptLoop(
  revisePass: (transcript: Transcript) => Promise<RevisePassResult>,
  transcript: Transcript,
  maxPasses: number = TRANSCRIPT_REVISE_MAX_PASSES,
): Promise<Transcript> {
  let current = transcript;
  let applied = false;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    let result: RevisePassResult;
    try {
      result = await revisePass(current);
    } catch (err) {
      if (applied) {
        console.error(
          `llm: ревью расшифровки, проход ${pass + 1} не удался, оставляю предыдущие правки`,
        );
        return current;
      }
      throw err;
    }
    if (!result.changed) {
      console.error(
        applied
          ? `llm: ревью расшифровки, проход ${pass + 1}: правок нет`
          : "llm: ревью расшифровки: правок нет",
      );
      return current;
    }
    current = result.transcript;
    applied = true;
  }
  console.error(`llm: ревью расшифровки: ${maxPasses} прохода, стоп`);
  return current;
}
