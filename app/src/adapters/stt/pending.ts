import type { Transcript } from "./index.ts";

export const LIVE_AUDIO_PENDING_TEXT =
  "Звук сохранён, расшифровка ещё не подключена";

export const LIVE_AUDIO_MISSING_TEXT = "Звук звонка не записан, расшифровка недоступна";

export function liveAudioPendingTranscript(
  audioPath: string | null,
): Transcript {
  return {
    mode: "live",
    segments: [
      {
        speaker: "Система",
        startedAtMs: 0,
        endedAtMs: null,
        text: audioPath ? LIVE_AUDIO_PENDING_TEXT : LIVE_AUDIO_MISSING_TEXT,
      },
    ],
  };
}

export function isLivePendingTranscript(transcript: Transcript): boolean {
  const first = transcript.segments[0];
  if (transcript.mode !== "live" || transcript.segments.length !== 1 || !first) {
    return false;
  }
  return (
    first.speaker === "Система" &&
    (first.text === LIVE_AUDIO_PENDING_TEXT ||
      first.text === LIVE_AUDIO_MISSING_TEXT)
  );
}
