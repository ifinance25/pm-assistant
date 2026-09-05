import { afterEach, describe, expect, it } from "vitest";
import { createDb } from "../db/index.ts";
import { LIVE_AUDIO_PENDING_TEXT } from "../adapters/stt/pending.ts";
import type { Transcript } from "../adapters/stt/index.ts";
import { runOnce } from "./pipeline.ts";

describe("воркер конвейера", () => {
  let db: ReturnType<typeof createDb>;

  afterEach(() => {
    db?.close();
  });

  it("без запуска воркера встреча остаётся queued", () => {
    db = createDb(":memory:");
    const meeting = db.createMeeting({
      url: "https://zoom.us/j/1",
      platform: "zoom",
    });
    db.enqueueJob({ meetingId: meeting.id, type: "join" });
    expect(db.getMeeting(meeting.id)?.status).toBe("queued");
  });

  it("прогоняет queued до ready по фикстуре и пишет объявление", async () => {
    db = createDb(":memory:");
    const meeting = db.createMeeting({
      url: "https://telemost.yandex.ru/j/12345678901234",
      platform: "telemost",
    });
    db.enqueueJob({ meetingId: meeting.id, type: "join" });
    await expect(runOnce(db)).rejects.toThrow(/не реализован/);
    const done = db.getMeeting(meeting.id);
    expect(done?.status).toBe("error");
    expect(db.listTranscript(meeting.id)).toEqual([]);
  });

  it("пишет сегмент фикстуры до статуса ready", async () => {
    db = createDb(":memory:");
    const meeting = db.createMeeting({
      url: "https://zoom.us/j/1",
      platform: "zoom",
    });
    db.enqueueJob({ meetingId: meeting.id, type: "join" });
    const statusesAtSave: string[] = [];
    const wrapped = {
      ...db,
      saveTranscript(
        meetingId: string,
        segments: Parameters<typeof db.saveTranscript>[1],
      ) {
        const current = db.getMeeting(meetingId);
        statusesAtSave.push(current?.status ?? "missing");
        expect(current?.status).not.toBe("ready");
        expect(segments.length).toBeGreaterThan(0);
        return db.saveTranscript(meetingId, segments);
      },
    };
    const processed = await runOnce(wrapped, {
      join: async (_item, hooks) => {
        await hooks?.onJoined?.({ mode: "live" });
        return { mode: "live", audioPath: "/tmp/pm-live.wav" };
      },
      transcribe: async () => ({
        mode: "live" as const,
        segments: [
          {
            speaker: "Спикер 1",
            startedAtMs: 0,
            endedAtMs: 1000,
            text: "Начинаем планёрку",
          },
        ],
      }),
      resolveLlmKey: () => "",
    });
    expect(processed).toBe(true);
    expect(statusesAtSave.length).toBeGreaterThan(0);
    expect(["recording", "transcribing"]).toContain(statusesAtSave[0]);
    expect(db.getMeeting(meeting.id)?.status).toBe("ready");
    expect(db.listTranscript(meeting.id).length).toBeGreaterThan(0);
  });

  it("живой join без STT сохраняет звук и не подставляет фикстуру standup", async () => {
    db = createDb(":memory:");
    const meeting = db.createMeeting({
      url: "https://zoom.us/j/99988877766",
      platform: "zoom",
    });
    db.enqueueJob({ meetingId: meeting.id, type: "join" });
    const audioPath = `/tmp/pm-live-${meeting.id}.webm`;
    const processed = await runOnce(db, {
      join: async (_meeting, hooks) => {
        await hooks?.onJoined?.({ mode: "live" });
        return { mode: "live", audioPath };
      },
      detectSttEngine: () => null,
      resolveLlmKey: () => "",
    });
    expect(processed).toBe(true);
    const done = db.getMeeting(meeting.id);
    expect(done?.status).toBe("ready");
    expect(done?.source).toBe("live");
    expect(done?.audioPath).toBe(audioPath);
    const transcript = db.listTranscript(meeting.id);
    expect(transcript).toHaveLength(1);
    expect(transcript[0]?.text).toBe(LIVE_AUDIO_PENDING_TEXT);
    expect(transcript.some((row) => /standup/i.test(row.text))).toBe(false);
    const summary = db.getSummary(meeting.id);
    expect(summary?.headline).toBe(LIVE_AUDIO_PENDING_TEXT);
    expect(summary?.headline).not.toMatch(/hotfix/i);
    expect(db.listActionItems(meeting.id)).toEqual([]);
  });

  it("падение join ставит error и даёт обработать следующую встречу", async () => {
    db = createDb(":memory:");
    const first = db.createMeeting({
      url: "https://zoom.us/j/11122233344",
      platform: "zoom",
    });
    db.enqueueJob({ meetingId: first.id, type: "join" });
    await expect(
      runOnce(db, {
        join: async () => {
          throw new Error("нет chromium");
        },
      }),
    ).rejects.toThrow(/нет chromium/);
    expect(db.getMeeting(first.id)?.status).toBe("error");
    const second = db.createMeeting({
      url: "https://zoom.us/j/55566677788",
      platform: "zoom",
    });
    db.enqueueJob({ meetingId: second.id, type: "join" });
    expect(
      await runOnce(db, {
        join: async (_item, hooks) => {
          await hooks?.onJoined?.({ mode: "live" });
          return { mode: "live", audioPath: "/tmp/pm-second.wav" };
        },
        transcribe: async () => ({
          mode: "live",
          segments: [
            {
              speaker: "Спикер 1",
              startedAtMs: 0,
              endedAtMs: 1000,
              text: "Вторая встреча",
            },
          ],
        }),
        resolveLlmKey: () => "",
      }),
    ).toBe(true);
    expect(db.getMeeting(second.id)?.status).toBe("ready");
  });

  it("живой join при падении whisper ставит error, а не заглушку pending", async () => {
    db = createDb(":memory:");
    const meeting = db.createMeeting({
      url: "https://zoom.us/j/99988877766",
      platform: "zoom",
    });
    db.enqueueJob({ meetingId: meeting.id, type: "join" });
    await expect(
      runOnce(db, {
        join: async (_item, hooks) => {
          await hooks?.onJoined?.({ mode: "live" });
          return { mode: "live", audioPath: "/tmp/pm-missing-audio.wav" };
        },
        detectSttEngine: () => ({
          kind: "whisper-cli",
          bin: "/tmp/pm-assistant-missing-whisper",
        }),
        resolveLlmKey: () => "",
      }),
    ).rejects.toThrow();
    const done = db.getMeeting(meeting.id);
    expect(done?.status).toBe("error");
    expect(done?.error).toMatch(/whisper|ENOENT|spawn/i);
    expect(db.listTranscript(meeting.id)).toEqual([]);
  });

  it("задание transcribe требует whisper и файл звука", async () => {
    db = createDb(":memory:");
    const meeting = db.createMeeting({
      url: "https://zoom.us/j/99988877766",
      platform: "zoom",
    });
    db.updateMeetingStatus(meeting.id, "joining");
    db.updateMeetingStatus(meeting.id, "recording", {
      audioPath: "/tmp/pm-live.wav",
      source: "live",
    });
    db.updateMeetingStatus(meeting.id, "transcribing");
    db.updateMeetingStatus(meeting.id, "summarizing");
    db.updateMeetingStatus(meeting.id, "ready");
    db.enqueueJob({ meetingId: meeting.id, type: "transcribe" });
    await expect(
      runOnce(db, { detectSttEngine: () => null }),
    ).rejects.toThrow(/нет whisper/);
    expect(db.getMeeting(meeting.id)?.status).toBe("error");
  });

  it("join при audio_path не входит в звонок, а ставит расшифровку", async () => {
    db = createDb(":memory:");
    const meeting = db.createMeeting({
      url: "https://zoom.us/j/99988877766",
      platform: "zoom",
    });
    db.updateMeetingStatus(meeting.id, "joining");
    db.updateMeetingStatus(meeting.id, "recording", {
      audioPath: "/tmp/pm-live.wav",
      source: "live",
    });
    db.updateMeetingStatus(meeting.id, "error", {
      error: "llm ответил статусом 429",
    });
    db.enqueueJob({ meetingId: meeting.id, type: "join" });
    let joined = 0;
    await expect(
      runOnce(db, {
        join: async () => {
          joined += 1;
          return { mode: "live", audioPath: "/tmp/pm-live.wav" };
        },
        detectSttEngine: () => null,
      }),
    ).rejects.toThrow(/нет whisper/);
    expect(joined).toBe(0);
    expect(
      db.listJobs().some((job) => job.type === "join" && job.status === "running"),
    ).toBe(false);
  });

  it("живой join при 429 llm сохраняет расшифровку и ставит ready", async () => {
    db = createDb(":memory:");
    const meeting = db.createMeeting({
      url: "https://zoom.us/j/99988877766",
      platform: "zoom",
    });
    db.enqueueJob({ meetingId: meeting.id, type: "join" });
    const prevFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("rate limited", {
        status: 429,
        headers: { "retry-after": "0" },
      })) as typeof fetch;
    try {
      const processed = await runOnce(db, {
        join: async (_item, hooks) => {
          await hooks?.onJoined?.({ mode: "live" });
          return { mode: "live", audioPath: "/tmp/pm-live.wav" };
        },
        transcribe: async () => ({
          mode: "live",
          segments: [
            {
              speaker: "Спикер 1",
              startedAtMs: 0,
              endedAtMs: 2000,
              text: "Начинаем ежедневный митинг.",
            },
          ],
        }),
        resolveLlmKey: () => "sk-test",
      });
      expect(processed).toBe(true);
      const done = db.getMeeting(meeting.id);
      expect(done?.status).toBe("ready");
      expect(db.listTranscript(meeting.id)[0]?.text).toMatch(/митинг/);
      expect(db.getSummary(meeting.id)?.decisions).toMatch(/429/);
      expect(done?.error).toBeNull();
      expect(db.getSummary(meeting.id)?.risks).toMatch(/ревью расшифровки не применилось/i);
    } finally {
      globalThis.fetch = prevFetch;
    }
  });

  const STT_MISHEARS: Transcript = {
    mode: "live",
    segments: [
      {
        speaker: "Спикер 1",
        startedAtMs: 0,
        endedAtMs: 2000,
        text: "Запускаем бута на сервер.",
      },
      {
        speaker: "Спикер 1",
        startedAtMs: 2000,
        endedAtMs: 4000,
        text: "Проверь лаланки в кабинете.",
      },
      {
        speaker: "Спикер 2",
        startedAtMs: 4000,
        endedAtMs: 6000,
        text: "Есть блогеры по деплою.",
      },
      {
        speaker: "Спикер 2",
        startedAtMs: 6000,
        endedAtMs: 8000,
        text: "субтитры создавал DimaTorzok",
      },
    ],
  };

  const STT_REVISED: Transcript = {
    mode: "live",
    segments: [
      {
        speaker: "Спикер 1",
        startedAtMs: 0,
        endedAtMs: 2000,
        text: "Запускаем бота на сервер.",
      },
      {
        speaker: "Спикер 1",
        startedAtMs: 2000,
        endedAtMs: 4000,
        text: "Проверь колонки в кабинете.",
      },
      {
        speaker: "Спикер 2",
        startedAtMs: 4000,
        endedAtMs: 6000,
        text: "Есть блокеры по деплою.",
      },
    ],
  };

  it("ревью правит ослышки, summarize вызывается только после revise", async () => {
    db = createDb(":memory:");
    const meeting = db.createMeeting({
      url: "https://zoom.us/j/99988877766",
      platform: "zoom",
    });
    db.enqueueJob({ meetingId: meeting.id, type: "join" });
    const order: string[] = [];
    let summarizedText = "";
    const processed = await runOnce(db, {
      join: async (_item, hooks) => {
        await hooks?.onJoined?.({ mode: "live" });
        return { mode: "live", audioPath: "/tmp/pm-live.wav" };
      },
      transcribe: async () => STT_MISHEARS,
      reviseTranscript: async (transcript) => {
        order.push("revise");
        expect(transcript.segments.some((row) => /бута/.test(row.text))).toBe(
          true,
        );
        return STT_REVISED;
      },
      summarize: async (transcript) => {
        order.push("summarize");
        summarizedText = transcript.segments.map((row) => row.text).join(" ");
        return {
          mode: "live",
          summary: {
            headline: "Итог по исправленному тексту",
            decisions: "Решили",
            risks: "",
            nextStep: "Дальше",
          },
          actionItems: [],
        };
      },
      resolveLlmKey: () => "sk-test",
    });
    expect(processed).toBe(true);
    expect(order).toEqual(["revise", "summarize"]);
    expect(summarizedText).toMatch(/бота/);
    expect(summarizedText).toMatch(/колонки/);
    expect(summarizedText).toMatch(/блокеры/);
    expect(summarizedText).not.toMatch(/бута|лаланки|блогеры|DimaTorzok/);
    const saved = db.listTranscript(meeting.id).map((row) => row.text).join(" ");
    expect(saved).toMatch(/бота/);
    expect(saved).not.toMatch(/бута|DimaTorzok/);
    expect(db.getMeeting(meeting.id)?.status).toBe("ready");
    expect(db.getSummary(meeting.id)?.headline).toBe("Итог по исправленному тексту");
    expect(db.getMeeting(meeting.id)?.title).toBe("Итог по исправленному тексту");
  });

  it("при 429 на revise не вызывает summarize и ставит ready", async () => {
    db = createDb(":memory:");
    const meeting = db.createMeeting({
      url: "https://zoom.us/j/99988877766",
      platform: "zoom",
    });
    db.enqueueJob({ meetingId: meeting.id, type: "join" });
    let summarizeCalls = 0;
    const processed = await runOnce(db, {
      join: async (_item, hooks) => {
        await hooks?.onJoined?.({ mode: "live" });
        return { mode: "live", audioPath: "/tmp/pm-live.wav" };
      },
      transcribe: async () => STT_MISHEARS,
      reviseTranscript: async () => {
        const { LlmHttpError } = await import("../adapters/llm/live.ts");
        throw new LlmHttpError(429);
      },
      summarize: async () => {
        summarizeCalls += 1;
        throw new Error("summarize не должен вызываться на сыром STT");
      },
      resolveLlmKey: () => "sk-test",
    });
    expect(processed).toBe(true);
    expect(summarizeCalls).toBe(0);
    const done = db.getMeeting(meeting.id);
    expect(done?.status).toBe("ready");
    expect(done?.error).toBeNull();
    expect(db.listTranscript(meeting.id)[0]?.text).toMatch(/бута/);
    expect(db.getSummary(meeting.id)?.decisions).toMatch(/429/);
    expect(db.getSummary(meeting.id)?.risks).toMatch(/ревью расшифровки не применилось/i);
  });
});
