import type { Transcript } from "../stt/index.ts";
import type {
  ActionItemDraft,
  MeetingSummary,
  SummarizeResult,
} from "./index.ts";
import { fetchWithTimeout } from "../../shared/http-timeout.ts";

const SYSTEM_PROMPT = [
  "Ты секретарь встречи. Ответь только JSON без markdown.",
  "Поля: summary.headline, summary.decisions, summary.risks, summary.nextStep (русский текст),",
  "actionItems: массив {assignee, title, dueAt (YYYY-MM-DD или null), timecodeMs (число или null)}.",
  "Не используй длинное тире.",
].join(" ");

type LlmJson = {
  summary?: MeetingSummary;
  actionItems?: ActionItemDraft[];
};

type ChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
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
  return transcript.segments
    .map((segment) => `${segment.speaker}: ${segment.text}`)
    .join("\n");
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

function toResult(parsed: LlmJson): SummarizeResult {
  return {
    mode: "live",
    summary: {
      headline: parsed.summary?.headline ?? "",
      decisions: parsed.summary?.decisions ?? "",
      risks: parsed.summary?.risks ?? "",
      nextStep: parsed.summary?.nextStep ?? "",
    },
    actionItems: (parsed.actionItems ?? []).map((item) => ({
      assignee: item.assignee ?? null,
      title: item.title ?? "",
      dueAt: item.dueAt ?? null,
      timecodeMs: item.timecodeMs ?? null,
    })),
  };
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
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent(transcript) }],
    }),
  });
  throwIfNotOk(res);
  const body = (await res.json()) as ClaudeResponse;
  const raw = body.content?.find((block) => block.type === "text")?.text;
  if (!raw) {
    throw new Error("llm вернул пустой ответ");
  }
  return toResult(parseLlmJson(raw));
}

export async function liveSummarize(
  transcript: Transcript,
  apiKey: string,
): Promise<SummarizeResult> {
  const res = await fetchLlm("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: userContent(transcript),
        },
      ],
    }),
  });
  throwIfNotOk(res);
  const body = (await res.json()) as ChatResponse;
  const raw = body.choices?.[0]?.message?.content;
  if (!raw) {
    throw new Error("llm вернул пустой ответ");
  }
  return toResult(parseLlmJson(raw));
}
