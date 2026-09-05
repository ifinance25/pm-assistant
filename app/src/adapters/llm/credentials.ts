import { getDb } from "../../db/index.ts";
import type { LlmProvider } from "../../shared/types.ts";

export function llmEnvKey(provider: LlmProvider): string {
  switch (provider) {
    case "claude":
      return "CLAUDE_CODE_OAUTH_TOKEN";
    case "openai":
      return "OPENAI_API_KEY";
    case "cursor":
      return "CURSOR_API_KEY";
    case "kimi":
      return "KIMI_API_KEY";
  }
}

export function resolveLlmCredential(
  provider: LlmProvider,
  explicit?: string | null,
): string {
  if (explicit !== undefined) {
    return explicit?.trim() ?? "";
  }
  const fromEnv = process.env[llmEnvKey(provider)]?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  if (provider === "cursor") {
    const legacy = process.env.CURSOR_AUTH_TOKEN?.trim();
    if (legacy) {
      return legacy;
    }
  }
  if (provider === "kimi") {
    const legacy = process.env.MOONSHOT_API_KEY?.trim();
    if (legacy) {
      return legacy;
    }
  }
  return getDb().getIntegrationAccessToken(`llm:${provider}`) ?? "";
}

export function kimiChatConfig(apiKey: string): {
  apiKey: string;
  baseUrl: string;
  model: string;
} {
  const baseUrl = (
    process.env.KIMI_BASE_URL?.trim() || "https://api.moonshot.cn/v1"
  ).replace(/\/$/, "");
  const model = process.env.KIMI_MODEL?.trim() || "moonshot-v1-32k";
  return { apiKey, baseUrl, model };
}
