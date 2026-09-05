import type { Transcript } from "../stt/index.ts";
import { liveSummarize, liveSummarizeClaude } from "./live.ts";
import {
  liveRevise,
  liveReviseClaude,
  reviseTranscriptLoop,
} from "./revise.ts";
import { stubReviseTranscript, stubSummarize } from "./stub.ts";

export type LlmMode = "live" | "stub";

export type MeetingSummary = {
  headline: string;
  decisions: string;
  risks: string;
  nextStep: string;
};

export type ActionItemDraft = {
  assignee: string | null;
  title: string;
  dueAt: string | null;
  timecodeMs: number | null;
};

export type SummarizeResult = {
  mode: LlmMode;
  summary: MeetingSummary;
  actionItems: ActionItemDraft[];
};

export type LlmAdapter = {
  mode: LlmMode;
  reviseTranscript(transcript: Transcript): Promise<Transcript>;
  summarize(transcript: Transcript): Promise<SummarizeResult>;
};

export { TRANSCRIPT_REVISE_MAX_PASSES, reviseTranscriptLoop } from "./revise.ts";
export { REVIEW_SKIPPED_NOTICE } from "./pending.ts";

export function resolveClaudeOauthToken(explicit?: string | null): string {
  const raw =
    explicit !== undefined ? explicit : process.env.CLAUDE_CODE_OAUTH_TOKEN;
  return raw?.trim() ?? "";
}

export function resolveApiKey(explicit?: string | null): string {
  const raw = explicit !== undefined ? explicit : process.env.OPENAI_API_KEY;
  return raw?.trim() ?? "";
}

function liveOpenAiAdapter(apiKey: string): LlmAdapter {
  return {
    mode: "live",
    reviseTranscript: (transcript) =>
      reviseTranscriptLoop(
        (current) => liveRevise(current, apiKey),
        transcript,
      ),
    summarize: (transcript) => liveSummarize(transcript, apiKey),
  };
}

function liveClaudeAdapter(oauthToken: string): LlmAdapter {
  return {
    mode: "live",
    reviseTranscript: (transcript) =>
      reviseTranscriptLoop(
        (current) => liveReviseClaude(current, oauthToken),
        transcript,
      ),
    summarize: (transcript) => liveSummarizeClaude(transcript, oauthToken),
  };
}

function stubAdapter(): LlmAdapter {
  return {
    mode: "stub",
    reviseTranscript: stubReviseTranscript,
    summarize: stubSummarize,
  };
}

export function createLlmAdapter(opts?: {
  apiKey?: string | null;
  oauthToken?: string | null;
}): LlmAdapter {
  const oauthExplicit = opts && "oauthToken" in opts;
  const apiExplicit = opts && "apiKey" in opts;
  const oauth = resolveClaudeOauthToken(
    oauthExplicit ? opts.oauthToken : undefined,
  );
  const apiKey = resolveApiKey(apiExplicit ? opts.apiKey : undefined);

  if (apiExplicit && !oauthExplicit) {
    if (!apiKey) {
      return stubAdapter();
    }
    return liveOpenAiAdapter(apiKey);
  }

  if (oauth) {
    return liveClaudeAdapter(oauth);
  }
  if (apiKey) {
    return liveOpenAiAdapter(apiKey);
  }
  return stubAdapter();
}

export function summarize(transcript: Transcript): Promise<SummarizeResult> {
  return createLlmAdapter().summarize(transcript);
}
