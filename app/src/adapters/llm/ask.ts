import type { ActionItem, Summary, TranscriptSegment } from "../../shared/types.ts";
import { kimiChatConfig } from "./credentials.ts";
import { runCursorCliPrompt } from "./cursor-cli.ts";
import {
  fetchLlm,
  parseLlmJson,
  throwIfNotOk,
} from "./live.ts";
import { openAiChatText } from "./openai-chat.ts";

export type MeetingAskContext = {
  meetingTitle: string | null;
  transcript: TranscriptSegment[];
  summary: Summary | null;
  actionItems: Array<Pick<ActionItem, "title" | "assignee">>;
  epicKey: string | null;
  question: string;
};

export const MEETING_ASK_SYSTEM_PROMPT = [
  "Ты отвечаешь на вопрос только по материалам одной встречи:",
  "расшифровка, резюме, задачи, epic проекта (если указан).",
  "Запрещено использовать внешние знания, общие факты и домыслы.",
  "Если вопрос не по теме встречи или тема не звучала в материалах,",
  'верни {"inScope":false,"answer":"В данной встрече эта тема не обсуждалась."}.',
  "Если ответ есть в материалах, верни inScope:true и краткий точный answer на русском.",
  'Ответь только JSON: {"inScope": boolean, "answer": "..."}.',
  "Не используй длинное тире.",
].join(" ");

type AskJson = {
  inScope?: boolean;
  answer?: string;
};

type ClaudeResponse = {
  content?: Array<{ type?: string; text?: string }>;
};

export function buildMeetingAskUserContent(ctx: MeetingAskContext): string {
  const lines: string[] = [];
  if (ctx.meetingTitle?.trim()) {
    lines.push(`Название встречи: ${ctx.meetingTitle.trim()}`);
  }
  if (ctx.epicKey?.trim()) {
    lines.push(`Epic проекта: ${ctx.epicKey.trim()}`);
  }
  if (ctx.summary) {
    lines.push("Резюме:");
    lines.push(`- Заголовок: ${ctx.summary.headline}`);
    lines.push(`- Решения: ${ctx.summary.decisions}`);
    lines.push(`- Риски: ${ctx.summary.risks}`);
    lines.push(`- Следующий шаг: ${ctx.summary.nextStep}`);
  }
  if (ctx.actionItems.length > 0) {
    lines.push("Задачи из встречи:");
    for (const item of ctx.actionItems) {
      const who = item.assignee?.trim();
      lines.push(`- ${item.title}${who ? ` (${who})` : ""}`);
    }
  }
  lines.push("Расшифровка:");
  for (const segment of ctx.transcript) {
    lines.push(`${segment.speaker}: ${segment.text}`);
  }
  lines.push("");
  lines.push(`Вопрос: ${ctx.question}`);
  return lines.join("\n");
}

export function parseAskAnswer(raw: string): string {
  const parsed = parseLlmJson<AskJson>(raw);
  const answer = String(parsed.answer ?? "").trim();
  if (!answer) {
    throw new Error("llm вернул пустой ответ");
  }
  if (parsed.inScope === false) {
    return answer;
  }
  return answer;
}

async function askViaOpenAiChat(
  config: { apiKey: string; baseUrl?: string; model?: string },
  user: string,
): Promise<string> {
  const raw = await openAiChatText(
    config,
    MEETING_ASK_SYSTEM_PROMPT,
    user,
    true,
  );
  return parseAskAnswer(raw);
}

async function askViaClaude(oauthToken: string, user: string): Promise<string> {
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
      max_tokens: 2048,
      system: MEETING_ASK_SYSTEM_PROMPT,
      messages: [{ role: "user", content: user }],
    }),
  });
  throwIfNotOk(res);
  const body = (await res.json()) as ClaudeResponse;
  const raw = body.content?.find((block) => block.type === "text")?.text;
  if (!raw) {
    throw new Error("llm вернул пустой ответ");
  }
  return parseAskAnswer(raw);
}

async function askViaCursor(apiKey: string, user: string): Promise<string> {
  const prompt = [MEETING_ASK_SYSTEM_PROMPT, "", user].join("\n");
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
  return parseAskAnswer(text);
}

export function stubAskMeeting(ctx: MeetingAskContext): string {
  const lower = ctx.question.toLowerCase();
  const corpus = [
    ctx.meetingTitle ?? "",
    ctx.summary?.headline ?? "",
    ctx.summary?.decisions ?? "",
    ctx.summary?.risks ?? "",
    ctx.summary?.nextStep ?? "",
    ...ctx.actionItems.map((item) => `${item.title} ${item.assignee ?? ""}`),
    ...ctx.transcript.map((segment) => segment.text),
  ]
    .join("\n")
    .toLowerCase();

  if (lower.includes("epic") || lower.includes("эпик")) {
    return ctx.epicKey
      ? `Epic этой встречи: ${ctx.epicKey}.`
      : "Epic для проекта встречи не задан.";
  }

  const keywords = lower
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 4);
  const matched = keywords.some((word) => corpus.includes(word));
  if (matched && ctx.summary?.decisions) {
    return ctx.summary.decisions;
  }
  if (matched && ctx.transcript.length > 0) {
    return ctx.transcript[0]?.text ?? "В данной встрече эта тема не обсуждалась.";
  }
  return "В данной встрече эта тема не обсуждалась.";
}

export async function liveAskMeetingOpenAi(
  ctx: MeetingAskContext,
  apiKey: string,
): Promise<string> {
  return askViaOpenAiChat(
    { apiKey, model: "gpt-4o-mini" },
    buildMeetingAskUserContent(ctx),
  );
}

export async function liveAskMeetingClaude(
  ctx: MeetingAskContext,
  oauthToken: string,
): Promise<string> {
  return askViaClaude(oauthToken, buildMeetingAskUserContent(ctx));
}

export async function liveAskMeetingKimi(
  ctx: MeetingAskContext,
  apiKey: string,
): Promise<string> {
  return askViaOpenAiChat(
    kimiChatConfig(apiKey),
    buildMeetingAskUserContent(ctx),
  );
}

export async function liveAskMeetingCursor(
  ctx: MeetingAskContext,
  apiKey: string,
): Promise<string> {
  return askViaCursor(apiKey, buildMeetingAskUserContent(ctx));
}
