import { detectSttEngine } from "./detect.ts";
import { liveTranscribe } from "./live.ts";
import { stubTranscribe } from "./stub.ts";
import { supadataTranscribe } from "./supadata.ts";

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

/** PM_ASSISTANT_STT_ENGINE=supadata включает внешний движок (фаза 6, 6.3). По умолчанию whisper. */
export function resolveSttEngineKind(
  env: NodeJS.ProcessEnv = process.env,
): "whisper-cli" | "supadata" {
  return env.PM_ASSISTANT_STT_ENGINE?.trim() === "supadata"
    ? "supadata"
    : "whisper-cli";
}

async function transcribeWithSupadataFallback(
  audioPath: string,
  options: TranscribeOptions,
  detectEngine: () => SttEngine | null,
): Promise<Transcript> {
  try {
    return await supadataTranscribe(audioPath, options);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const engine = detectEngine();
    if (!engine) {
      throw err;
    }
    console.error(`supadata: ${message}, откат на локальный whisper`);
    return liveTranscribe(audioPath, options, engine);
  }
}

export function createSttAdapter(opts?: {
  detectEngine?: () => SttEngine | null;
  engineKind?: "whisper-cli" | "supadata";
}): SttAdapter {
  const detectEngine = opts?.detectEngine ?? detectSttEngine;
  const engineKind = opts?.engineKind ?? resolveSttEngineKind();
  if (engineKind === "supadata") {
    return {
      mode: "live",
      transcribe: (audioPath, options) =>
        transcribeWithSupadataFallback(audioPath, options, detectEngine),
    };
  }
  const engine = detectEngine();
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
