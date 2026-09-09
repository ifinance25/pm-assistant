import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AUDIO_SHARE_TOKEN_TTL_MS,
  createAudioShareToken,
  verifyAudioShareToken,
} from "./audio-share-token.ts";

describe("audio-share-token", () => {
  const originalToken = process.env.APP_API_TOKEN;

  beforeEach(() => {
    process.env.APP_API_TOKEN = "секрет-приложения";
  });

  afterEach(() => {
    process.env.APP_API_TOKEN = originalToken;
  });

  it("выпускает токен, который проверяется обратно на тот же meetingId", () => {
    const token = createAudioShareToken("meeting-1");
    expect(token).not.toBeNull();
    const verified = verifyAudioShareToken(token as string);
    expect(verified).toEqual({ meetingId: "meeting-1" });
  });

  it("без APP_API_TOKEN не выпускает и не проверяет токены", () => {
    process.env.APP_API_TOKEN = "";
    expect(createAudioShareToken("meeting-1")).toBeNull();

    process.env.APP_API_TOKEN = "секрет-приложения";
    const token = createAudioShareToken("meeting-1") as string;
    process.env.APP_API_TOKEN = "";
    expect(verifyAudioShareToken(token)).toBeNull();
  });

  it("отклоняет истёкший токен", () => {
    const start = Date.parse("2026-01-01T00:00:00Z");
    const token = createAudioShareToken("meeting-1", start) as string;
    const justBefore = verifyAudioShareToken(
      token,
      start + AUDIO_SHARE_TOKEN_TTL_MS,
    );
    expect(justBefore).toEqual({ meetingId: "meeting-1" });
    const justAfter = verifyAudioShareToken(
      token,
      start + AUDIO_SHARE_TOKEN_TTL_MS + 1,
    );
    expect(justAfter).toBeNull();
  });

  it("отклоняет подделанный токен (другой meetingId в payload)", () => {
    const token = createAudioShareToken("meeting-1") as string;
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const [, expiresAt, signature] = decoded.split(".");
    const forged = Buffer.from(
      `meeting-2.${expiresAt}.${signature}`,
      "utf8",
    ).toString("base64url");
    expect(verifyAudioShareToken(forged)).toBeNull();
  });

  it("отклоняет мусорный токен без падения", () => {
    expect(verifyAudioShareToken("не-токен")).toBeNull();
    expect(verifyAudioShareToken("")).toBeNull();
  });

  it("отклоняет токен с секретом от другого APP_API_TOKEN", () => {
    const token = createAudioShareToken("meeting-1") as string;
    process.env.APP_API_TOKEN = "другой-секрет";
    expect(verifyAudioShareToken(token)).toBeNull();
  });
});
