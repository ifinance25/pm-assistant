import { describe, expect, it } from "vitest";
import {
  meetingIdFromAudioPath,
  speakersTimelinePath,
  trimOffsetPath,
} from "./audio-id.ts";

describe("meetingIdFromAudioPath", () => {
  it("снимает расширение с сырого файла", () => {
    expect(meetingIdFromAudioPath("/data/audio/abc123.webm")).toBe("abc123");
    expect(meetingIdFromAudioPath("/data/audio/abc123.wav")).toBe("abc123");
  });

  it("снимает .speech.wav целиком, не только .wav", () => {
    expect(meetingIdFromAudioPath("/data/audio/abc123.speech.wav")).toBe(
      "abc123",
    );
  });
});

describe("speakersTimelinePath / trimOffsetPath", () => {
  it("совпадают для сырого и обработанного пути одной встречи", () => {
    const raw = "/data/audio/m1.webm";
    const speech = "/data/audio/m1.speech.wav";
    expect(speakersTimelinePath(raw)).toBe(speakersTimelinePath(speech));
    expect(trimOffsetPath(raw)).toBe(trimOffsetPath(speech));
    expect(speakersTimelinePath(raw)).toBe("/data/audio/m1.speakers.json");
    expect(trimOffsetPath(raw)).toBe("/data/audio/m1.trim-offset.json");
  });
});
