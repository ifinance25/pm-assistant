import { detectSttEngine } from "./detect.ts";
import { liveTranscribe } from "./live.ts";
import { stubTranscribe } from "./stub.ts";

export type SttMode = "live" | "stub";

export type SttSegment = {
  speaker: string;
  startedAtMs: number;
  endedAtMs: number | null;
  text: string;
};

export type Transcript = {
  mode: SttMode;
  segments: SttSegment[];
};

export type TranscribeOptions = {
  languageHint?: string;
  onPartial?: (segments: SttSegment[]) => void;
};

export type SttEngine = {
  kind: "whisper-cli";
  bin: string;
};

export type SttAdapter = {
  mode: SttMode;
  transcribe(
    audioPath: string,
    options: TranscribeOptions,
  ): Promise<Transcript>;
};

export { detectSttEngine };

export function createSttAdapter(opts?: {
  detectEngine?: () => SttEngine | null;
}): SttAdapter {
  const engine = (opts?.detectEngine ?? detectSttEngine)();
  if (!engine) {
    return { mode: "stub", transcribe: stubTranscribe };
  }
  return {
    mode: "live",
    transcribe: (audioPath, options) =>
      liveTranscribe(audioPath, options, engine),
  };
}

export function transcribe(
  audioPath: string,
  options: TranscribeOptions = {},
): Promise<Transcript> {
  return createSttAdapter().transcribe(audioPath, options);
}
