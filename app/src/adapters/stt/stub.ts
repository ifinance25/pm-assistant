import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SttSegment, Transcript } from "./index.ts";

type DemoFixture = {
  segments: SttSegment[];
};

export function loadDemoSegments(): SttSegment[] {
  const path = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../fixtures/demo-meeting.json",
  );
  const raw = JSON.parse(readFileSync(path, "utf8")) as DemoFixture;
  return raw.segments;
}

export async function stubTranscribe(): Promise<Transcript> {
  return {
    mode: "stub",
    segments: loadDemoSegments(),
  };
}
