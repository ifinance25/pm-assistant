import type { Transcript } from "../stt/index.ts";
import { getDb } from "../../db/index.ts";
import type { LlmProvider } from "../../shared/types.ts";
import {
  liveAskMeetingClaude,
  liveAskMeetingCursor,
  liveAskMeetingKimi,
  liveAskMeetingOpenAi,
  stubAskMeeting,
  type MeetingAskContext,
} from "./ask.ts";
import { resolveLlmCredential } from "./credentials.ts";
import { liveReviseCursor, liveSummarizeCursor } from "./cursor.ts";
import { liveSummarize, liveSummarizeClaude, liveSummarizeKimi } from "./live.ts";
import {
  liveRevise,
  liveReviseClaude,
  liveReviseKimi,
  reviseTranscriptLoop,
} from "./revise.ts";
import { stubReviseTranscript, stubSummarize } from "./stub.ts";

export type LlmMode = "live" | "stub";

export type ActionItemDraft = {
  assignee: string | null;
  title: string;
  dueAt: string | null;
  timecodeMs: number | null;
  segmentId: string | null;
};

export type DecisionItemDraft = {
  text: string;
  segmentId: string | null;
};

export type MeetingSummary = {
  headline: string;
  decisions: string;
  risks: string;
  nextStep: string;
  decisionSegmentIds: string[];
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
  askMeeting(context: MeetingAskContext): Promise<string>;
};

export { TRANSCRIPT_REVISE_MAX_PASSES, reviseTranscriptLoop } from "./revise.ts";
export { REVIEW_SKIPPED_NOTICE } from "./pending.ts";
export {
  llmEnvKey,
  resolveLlmCredential,
  kimiChatConfig,
} from "./credentials.ts";
export type { MeetingAskContext } from "./ask.ts";
export { buildMeetingAskUserContent, parseAskAnswer, stubAskMeeting } from "./ask.ts";

export function resolveClaudeOauthToken(explicit?: string | null): string {
  return resolveLlmCredential("claude", explicit);
}

export function resolveApiKey(explicit?: string | null): string {
  return resolveLlmCredential("openai", explicit);
}

export function resolveCursorApiKey(explicit?: string | null): string {
  return resolveLlmCredential("cursor", explicit);
}

export function resolveKimiApiKey(explicit?: string | null): string {
  return resolveLlmCredential("kimi", explicit);
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
    askMeeting: (context) => liveAskMeetingOpenAi(context, apiKey),
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
    askMeeting: (context) => liveAskMeetingClaude(context, oauthToken),
  };
}

function liveCursorAdapter(apiKey: string): LlmAdapter {
  return {
    mode: "live",
    reviseTranscript: (transcript) =>
      reviseTranscriptLoop(
        (current) => liveReviseCursor(current, apiKey),
        transcript,
        1,
      ),
    summarize: (transcript) => liveSummarizeCursor(transcript, apiKey),
    askMeeting: (context) => liveAskMeetingCursor(context, apiKey),
  };
}

function liveKimiAdapter(apiKey: string): LlmAdapter {
  return {
    mode: "live",
    reviseTranscript: (transcript) =>
      reviseTranscriptLoop(
        (current) => liveReviseKimi(current, apiKey),
        transcript,
      ),
    summarize: (transcript) => liveSummarizeKimi(transcript, apiKey),
    askMeeting: (context) => liveAskMeetingKimi(context, apiKey),
  };
}

function stubAdapter(): LlmAdapter {
  return {
    mode: "stub",
    reviseTranscript: stubReviseTranscript,
    summarize: stubSummarize,
    askMeeting: async (context) => stubAskMeeting(context),
  };
}

function adapterForProvider(
  provider: LlmProvider,
  credential: string,
): LlmAdapter {
  if (!credential) {
    return stubAdapter();
  }
  switch (provider) {
    case "claude":
      return liveClaudeAdapter(credential);
    case "openai":
      return liveOpenAiAdapter(credential);
    case "cursor":
      return liveCursorAdapter(credential);
    case "kimi":
      return liveKimiAdapter(credential);
  }
}

export function createLlmAdapter(opts?: {
  provider?: LlmProvider;
  apiKey?: string | null;
  oauthToken?: string | null;
}): LlmAdapter {
  const provider = opts?.provider ?? getDb().getSettings().llmProvider;
  const oauthExplicit = opts && "oauthToken" in opts;
  const apiExplicit = opts && "apiKey" in opts;

  if (provider === "claude") {
    return adapterForProvider(
      "claude",
      resolveClaudeOauthToken(oauthExplicit ? opts.oauthToken : undefined),
    );
  }
  if (provider === "openai") {
    return adapterForProvider(
      "openai",
      resolveApiKey(apiExplicit ? opts.apiKey : undefined),
    );
  }
  if (provider === "cursor") {
    return adapterForProvider(
      "cursor",
      resolveCursorApiKey(apiExplicit ? opts.apiKey : undefined),
    );
  }
  return adapterForProvider(
    "kimi",
    resolveKimiApiKey(apiExplicit ? opts.apiKey : undefined),
  );
}

export function summarize(transcript: Transcript): Promise<SummarizeResult> {
  return createLlmAdapter().summarize(transcript);
}

export function askMeetingQuestion(
  context: MeetingAskContext,
): Promise<string> {
  return createLlmAdapter().askMeeting(context);
}
