import { createHash, randomBytes } from "node:crypto";
import { fetchWithTimeout } from "../shared/http-timeout.ts";
import type { LlmProvider } from "../shared/types.ts";
import { llmEnvKey } from "../adapters/llm/credentials.ts";
import { upsertEnvVariable } from "./env-file.ts";

const CLAUDE_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const CLAUDE_AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const CLAUDE_TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";
const CLAUDE_REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback";
const CLAUDE_SCOPE = "org:create_api_key user:profile user:inference";

export type PkcePair = {
  verifier: string;
  challenge: string;
};

export function generatePkce(): PkcePair {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256")
    .update(verifier)
    .digest("base64url");
  return { verifier, challenge };
}

export function buildClaudeAuthorizeUrl(pkce: PkcePair): string {
  const params = new URLSearchParams({
    code: "true",
    client_id: CLAUDE_CLIENT_ID,
    response_type: "code",
    redirect_uri: CLAUDE_REDIRECT_URI,
    scope: CLAUDE_SCOPE,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    state: pkce.verifier,
  });
  return `${CLAUDE_AUTHORIZE_URL}?${params.toString()}`;
}

export type ClaudeTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
};

export async function exchangeClaudeCode(
  code: string,
  verifier: string,
): Promise<ClaudeTokenResponse> {
  let exchangeCode = code.trim();
  let exchangeState = verifier;
  const hash = exchangeCode.indexOf("#");
  if (hash >= 0) {
    const fragment = exchangeCode.slice(hash + 1);
    exchangeCode = exchangeCode.slice(0, hash);
    if (fragment) {
      exchangeState = fragment;
    }
  }
  const res = await fetchWithTimeout(CLAUDE_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "anthropic-beta": "oauth-2025-04-20",
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: CLAUDE_CLIENT_ID,
      code: exchangeCode,
      state: exchangeState,
      redirect_uri: CLAUDE_REDIRECT_URI,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`обмен кода Claude не удался: ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as ClaudeTokenResponse;
}

export { llmEnvKey };

export function llmIntegrationProvider(provider: LlmProvider): string {
  return `llm:${provider}`;
}

export function openAiAuthorizeUrl(): string {
  return "https://platform.openai.com/api-keys";
}

export function cursorAuthorizeUrl(): string {
  return "https://cursor.com/dashboard/api";
}

export function kimiAuthorizeUrl(): string {
  return "https://platform.moonshot.cn/console/api-keys";
}

export function saveLlmToken(provider: LlmProvider, token: string): void {
  upsertEnvVariable(llmEnvKey(provider), token);
}
