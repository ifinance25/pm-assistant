import type { Transcript } from "../stt/index.ts";
import type {
  ActionItemDraft,
  DecisionItemDraft,
  MeetingSummary,
  SummarizeResult,
} from "./index.ts";
import { kimiChatConfig } from "./credentials.ts";
import { openAiChatText } from "./openai-chat.ts";
import { fetchWithTimeout } from "../../shared/http-timeout.ts";
import {
  resolveSegmentId,
  SUMMARIZE_SEGMENT_PROMPT,
  summarizeUserContent,
  type SummarizeSegment,
} from "./summarize-content.ts";

export const SUMMARIZE_SYSTEM_PROMPT = [
  "Ты секретарь встречи. Ответь только JSON без markdown.",
  "Поля: summary.headline, summary.risks, summary.nextStep (русский текст),",
  SUMMARIZE_SEGMENT_PROMPT,
  "Не используй длинное тире.",
].join(" ");

type LlmJson = {
  summary?: MeetingSummary & { decisions?: string };
  decisionItems?: DecisionItemDraft[];
  actionItems?: Array<
    ActionItemDraft & { segmentId?: string | number | null }
  >;
};

type ClaudeResponse = {
  content?: Array<{ type?: string; text?: string }>;
};

export class LlmHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`llm ответил статусом ${status}`);
    this.name = "LlmHttpError";
    this.status = status;
  }
}

export function isLlmRateLimitError(err: unknown): boolean {
  if (err instanceof LlmHttpError) {
    return err.status === 429;
  }
  const message = err instanceof Error ? err.message : String(err);
  return /\b429\b/.test(message);
}

function retryDelaysMs(): number[] {
  if (process.env.VITEST) {
    return [0, 0, 0];
  }
  return [2000, 4000, 8000];
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function drainBody(res: Response): Promise<void> {
  try {
    await res.arrayBuffer();
  } catch {
    // тело ответа не логируем
  }
}

export async function fetchLlm(url: string, init: RequestInit): Promise<Response> {
  const delays = retryDelaysMs();
  let last: Response | undefined;
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    const res = await fetchWithTimeout(url, init);
    if (res.status !== 429) {
      return res;
    }
    last = res;
    await drainBody(res);
    if (attempt === delays.length) {
      break;
    }
    const retryAfterRaw = res.headers.get("retry-after");
    const retryAfterSec = retryAfterRaw ? Number(retryAfterRaw) : Number.NaN;
    const waitMs =
      Number.isFinite(retryAfterSec) && retryAfterSec > 0
        ? Math.min(retryAfterSec * 1000, 15_000)
        : delays[attempt];
    console.error(`llm: статус 429, повтор ${attempt + 1} через ${waitMs} мс`);
    await sleep(waitMs);
  }
  return last as Response;
}

function userContent(transcript: Transcript): string {
  return summarizeUserContent(transcript.segments as SummarizeSegment[]);
}

function parseDecisionItems(parsed: LlmJson): DecisionItemDraft[] {
  if (Array.isArray(parsed.decisionItems)) {
    return parsed.decisionItems
      .map((item) => ({
        text: String(item.text ?? "").trim(),
        segmentId:
          item.segmentId == null || item.segmentId === ""
            ? null
            : String(item.segmentId),
      }))
      .filter((item) => item.text.length > 0);
  }
  const raw = parsed.summary?.decisions;
  if (!raw) {
    return [];
  }
  return String(raw)
    .split(/\n+/)
    .map((line) => line.replace(/^[-•]\s*/, "").trim())
    .filter(Boolean)
    .map((text) => ({ text, segmentId: null }));
}

export function toSummarizeResult(
  parsed: LlmJson,
  segments: SummarizeSegment[] = [],
): SummarizeResult {
  const decisionItems = parseDecisionItems(parsed);
  const decisionSegmentIds = [
    ...new Set(
      decisionItems
        .map((item) =>
          resolveSegmentId(segments, null, item.segmentId),
        )
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const decisionsText =
    decisionItems.length > 0
      ? decisionItems.map((item) => item.text).join("\n")
      : String(parsed.summary?.decisions ?? "");

  return {
    mode: "live",
    summary: {
      headline: String(parsed.summary?.headline ?? ""),
      decisions: decisionsText,
      risks: String(parsed.summary?.risks ?? ""),
      nextStep: String(parsed.summary?.nextStep ?? ""),
      decisionSegmentIds,
    },
    actionItems: (parsed.actionItems ?? []).map((item) => {
      const timecodeMs = (() => {
        const raw = item.timecodeMs as string | number | null | undefined;
        if (raw == null || raw === "") {
          return null;
        }
        const value = Number(raw);
        return Number.isFinite(value) ? value : null;
      })();
      const explicitSegmentId =
        item.segmentId == null || item.segmentId === ""
          ? null
          : String(item.segmentId);
      return {
        assignee:
          item.assignee == null || item.assignee === ""
            ? null
            : String(item.assignee),
        title: String(item.title ?? ""),
        dueAt:
          item.dueAt == null || item.dueAt === "" ? null : String(item.dueAt),
        timecodeMs,
        segmentId: resolveSegmentId(
          segments,
          timecodeMs,
          explicitSegmentId,
        ),
      };
    }),
  };
}

export function parseLlmJson<T = LlmJson>(raw: string): T {
  const trimmed = raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/, "")
    .replace(/```$/, "")
    .trim();
  return JSON.parse(trimmed) as T;
}

export function throwIfNotOk(res: Response): void {
  if (!res.ok) {
    throw new LlmHttpError(res.status);
  }
}

export async function liveSummarizeClaude(
  transcript: Transcript,
  oauthToken: string,
): Promise<SummarizeResult> {
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
      max_tokens: 4096,
      system: SUMMARIZE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent(transcript) }],
    }),
  });
  throwIfNotOk(res);
  const body = (await res.json()) as ClaudeResponse;
  const raw = body.content?.find((block) => block.type === "text")?.text;
  if (!raw) {
    throw new Error("llm вернул пустой ответ");
  }
  return toSummarizeResult(
    parseLlmJson(raw),
    transcript.segments as SummarizeSegment[],
  );
}

export async function liveSummarize(
  transcript: Transcript,
  apiKey: string,
): Promise<SummarizeResult> {
  const raw = await openAiChatText(
    { apiKey, model: "gpt-4o-mini" },
    SUMMARIZE_SYSTEM_PROMPT,
    userContent(transcript),
    true,
  );
  return toSummarizeResult(
    parseLlmJson(raw),
    transcript.segments as SummarizeSegment[],
  );
}

export async function liveSummarizeKimi(
  transcript: Transcript,
  apiKey: string,
): Promise<SummarizeResult> {
  const config = kimiChatConfig(apiKey);
  const raw = await openAiChatText(
    config,
    SUMMARIZE_SYSTEM_PROMPT,
    userContent(transcript),
    true,
  );
  return toSummarizeResult(
    parseLlmJson(raw),
    transcript.segments as SummarizeSegment[],
  );
}
