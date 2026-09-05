import { describe, expect, it } from "vitest";
import {
  LIVE_AUDIO_PENDING_TEXT,
  isLivePendingTranscript,
  liveAudioPendingTranscript,
} from "./pending.ts";

describe("pending live STT", () => {
  it("с путём к звуку даёт русскую пометку, не фикстуру standup", () => {
    const transcript = liveAudioPendingTranscript("/tmp/meeting.webm");
    expect(transcript.mode).toBe("live");
    expect(transcript.segments).toHaveLength(1);
    expect(transcript.segments[0]?.text).toBe(LIVE_AUDIO_PENDING_TEXT);
    expect(transcript.segments[0]?.text).not.toMatch(/standup/i);
    expect(isLivePendingTranscript(transcript)).toBe(true);
  });

  it("без файла звука не маскируется под расшифровку", () => {
    const transcript = liveAudioPendingTranscript(null);
    expect(transcript.segments[0]?.text).toMatch(/не записан/i);
    expect(isLivePendingTranscript(transcript)).toBe(true);
  });
});
