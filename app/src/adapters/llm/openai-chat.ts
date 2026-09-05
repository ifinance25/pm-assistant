import { fetchLlm, throwIfNotOk } from "./live.ts";

export type OpenAiChatConfig = {
  apiKey: string;
  baseUrl?: string;
  model?: string;
};

type ChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

export async function openAiChatText(
  config: OpenAiChatConfig,
  system: string,
  user: string,
  jsonMode = false,
): Promise<string> {
  const baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").replace(
    /\/$/,
    "",
  );
  const body: Record<string, unknown> = {
    model: config.model ?? "gpt-4o-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  if (jsonMode) {
    body.response_format = { type: "json_object" };
  }
  const res = await fetchLlm(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  throwIfNotOk(res);
  const payload = (await res.json()) as ChatResponse;
  const raw = payload.choices?.[0]?.message?.content;
  if (!raw) {
    throw new Error("llm вернул пустой ответ");
  }
  return raw;
}
