import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Transcript } from "../stt/index.ts";
import type { ActionItemDraft, MeetingSummary, SummarizeResult } from "./index.ts";

type DemoFixture = {
  summary: MeetingSummary;
  actionItems: ActionItemDraft[];
};

function loadDemo(): DemoFixture {
  const path = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../fixtures/demo-meeting.json",
  );
  return JSON.parse(readFileSync(path, "utf8")) as DemoFixture;
}

export async function stubSummarize(): Promise<SummarizeResult> {
  const demo = loadDemo();
  return {
    mode: "stub",
    summary: demo.summary,
    actionItems: demo.actionItems,
  };
}

export async function stubReviseTranscript(
  transcript: Transcript,
): Promise<Transcript> {
  return transcript;
}
