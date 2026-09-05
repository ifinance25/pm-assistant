import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Transcript } from "../stt/index.ts";
import type { ActionItemDraft, MeetingSummary, SummarizeResult } from "./index.ts";
import { resolveSegmentId, type SummarizeSegment } from "./summarize-content.ts";

type DemoFixture = {
  summary: Omit<MeetingSummary, "decisionSegmentIds">;
  actionItems: Array<Omit<ActionItemDraft, "segmentId">>;
};

function loadDemo(): DemoFixture {
  const path = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../fixtures/demo-meeting.json",
  );
  return JSON.parse(readFileSync(path, "utf8")) as DemoFixture;
}

export async function stubSummarize(
  transcript: Transcript,
): Promise<SummarizeResult> {
  const demo = loadDemo();
  const segments = transcript.segments as SummarizeSegment[];
  const decisionSegmentIds = segments
    .slice(1, 4)
    .map((segment) => segment.id)
    .filter((id): id is string => Boolean(id));
  return {
    mode: "stub",
    summary: {
      ...demo.summary,
      decisionSegmentIds,
    },
    actionItems: demo.actionItems.map((item) => ({
      ...item,
      segmentId: resolveSegmentId(segments, item.timecodeMs, null),
    })),
  };
}

export async function stubReviseTranscript(
  transcript: Transcript,
): Promise<Transcript> {
  return transcript;
}
