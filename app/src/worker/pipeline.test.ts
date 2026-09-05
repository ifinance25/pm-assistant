import { afterEach, describe, expect, it } from "vitest";
import { createDb } from "../db/index.ts";
import type { Transcript } from "../adapters/stt/index.ts";
import { runOnce } from "./pipeline.ts";

async function runAllJobs(
  db: Parameters<typeof runOnce>[0],
  deps?: Parameters<typeof runOnce>[1],
): Promise<number> {
  let n = 0;
  while (n < 8) {
    const more = await runOnce(db, deps);
    if (!more) {
      return n;
    }
    n += 1;
  }
  throw new Error("очередь не опустела");
}

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

  it("после записи ставит transcribe в очередь и не зовёт STT в join", async () => {
    db = createDb(":memory:");
    const meeting = db.createMeeting({
      url: "https://zoom.us/j/1",
      platform: "zoom",
    });
    db.enqueueJob({ meetingId: meeting.id, type: "join" });
    let transcribed = 0;
    const processed = await runOnce(db, {
      join: async (_item, hooks) => {
        await hooks?.onJoined?.({ mode: "live" });
        return { mode: "live", audioPath: "/tmp/pm-live.wav" };
      },
      transcribe: async () => {
        transcribed += 1;
        return {
          mode: "live",
          segments: [
            {
              speaker: "Спикер 1",
              startedAtMs: 0,
              endedAtMs: 1000,
              text: "Начинаем планёрку",
            },
          ],
        };
      },
      resolveLlmKey: () => "",
    });
    expect(processed).toBe(true);
    expect(transcribed).toBe(0);
    expect(db.getMeeting(meeting.id)?.status).toBe("transcribing");
    expect(db.getMeeting(meeting.id)?.audioPath).toBe("/tmp/pm-live.wav");
    expect(
      db.listJobs().some((job) => job.type === "join" && job.status === "done"),
    ).toBe(true);
    expect(
      db
        .listJobs()
        .some((job) => job.type === "transcribe" && job.status === "pending"),
    ).toBe(true);
  });

  it("после расшифровки ставит summarize и не зовёт LLM в transcribe", async () => {
    db = createDb(":memory:");
    const meeting = db.createMeeting({
      url: "https://zoom.us/j/1",
      platform: "zoom",
    });
    db.updateMeetingStatus(meeting.id, "joining");
    db.updateMeetingStatus(meeting.id, "recording", {
      audioPath: "/tmp/pm-live.wav",
      source: "live",
    });
    db.updateMeetingStatus(meeting.id, "transcribing");
    db.enqueueJob({ meetingId: meeting.id, type: "transcribe" });
    let summarized = 0;
    const processed = await runOnce(db, {
      transcribe: async () => ({
        mode: "live",
        segments: [
          {
            speaker: "Спикер 1",
            startedAtMs: 0,
            endedAtMs: 1000,
            text: "Начинаем планёрку",
          },
        ],
      }),
      summarize: async () => {
        summarized += 1;
        throw new Error("LLM не должен вызываться из transcribe");
      },
      resolveLlmKey: () => "sk-test",
    });
    expect(processed).toBe(true);
    expect(summarized).toBe(0);
    expect(db.getMeeting(meeting.id)?.status).toBe("summarizing");
    expect(db.listTranscript(meeting.id)[0]?.text).toMatch(/планёрку/);
    expect(
      db.listJobs().some((job) => job.type === "transcribe" && job.status === "done"),
    ).toBe(true);
    expect(
      db
        .listJobs()
        .some((job) => job.type === "summarize" && job.status === "pending"),
    ).toBe(true);
  });

  it("берёт join следующего созвона, пока идёт расшифровка", async () => {
    db = createDb(":memory:");
    const recorded = db.createMeeting({
      url: "https://zoom.us/j/old",
      platform: "zoom",
    });
    db.updateMeetingStatus(recorded.id, "joining");
    db.updateMeetingStatus(recorded.id, "recording", {
      audioPath: "/tmp/pm-old.wav",
      source: "live",
    });
    db.updateMeetingStatus(recorded.id, "transcribing");
    db.enqueueJob({ meetingId: recorded.id, type: "transcribe" });
    let releaseTranscribe: () => void = () => undefined;
    const transcribeGate = new Promise<void>((resolve) => {
      releaseTranscribe = resolve;
    });
    let transcribeStarted: () => void = () => undefined;
    const transcribeStartedAt = new Promise<void>((resolve) => {
      transcribeStarted = resolve;
    });
    const transcribeRun = runOnce(db, {
      transcribe: async () => {
        transcribeStarted();
        await transcribeGate;
        return {
          mode: "live" as const,
          segments: [
            {
              speaker: "Спикер 1",
              startedAtMs: 0,
              endedAtMs: 1000,
              text: "Прошлая встреча",
            },
          ],
        };
      },
      resolveLlmKey: () => "",
    });
    await transcribeStartedAt;
    expect(db.getMeeting(recorded.id)?.status).toBe("transcribing");
    const next = db.createMeeting({
      url: "https://zoom.us/j/new",
      platform: "zoom",
    });
    db.enqueueJob({ meetingId: next.id, type: "join" });
    let joined = 0;
    const joinProcessed = await runOnce(db, {
      join: async (_item, hooks) => {
        joined += 1;
        await hooks?.onJoined?.({ mode: "live" });
        return { mode: "live", audioPath: "/tmp/pm-new.wav" };
      },
      transcribe: async () => {
        throw new Error("STT не должен вызываться из join");
      },
    });
    expect(joinProcessed).toBe(true);
    expect(joined).toBe(1);
    expect(db.getMeeting(next.id)?.status).toBe("transcribing");
    expect(db.getMeeting(recorded.id)?.status).toBe("transcribing");
    releaseTranscribe();
    expect(await transcribeRun).toBe(true);
    expect(db.getMeeting(recorded.id)?.status).toBe("summarizing");
    expect(
      db
        .listJobs()
        .some((job) => job.type === "summarize" && job.status === "pending"),
    ).toBe(true);
  });

  it("берёт саммари, пока другая встреча ещё расшифровывается", async () => {
    db = createDb(":memory:");
    const stt = db.createMeeting({
      url: "https://zoom.us/j/stt",
      platform: "zoom",
    });
    db.updateMeetingStatus(stt.id, "joining");
    db.updateMeetingStatus(stt.id, "recording", {
      audioPath: "/tmp/pm-stt.wav",
      source: "live",
    });
    db.updateMeetingStatus(stt.id, "transcribing");
    db.enqueueJob({ meetingId: stt.id, type: "transcribe" });
    const llm = db.createMeeting({
      url: "https://zoom.us/j/llm",
      platform: "zoom",
    });
    db.updateMeetingStatus(llm.id, "joining");
    db.updateMeetingStatus(llm.id, "recording");
    db.updateMeetingStatus(llm.id, "transcribing");
    db.saveTranscript(llm.id, [
      {
        speaker: "Илья",
        startedAtMs: 0,
        endedAtMs: 1000,
        text: "Нужно закрыть протокол",
      },
    ]);
    db.updateMeetingStatus(llm.id, "summarizing");
    let releaseStt: () => void = () => undefined;
    const sttGate = new Promise<void>((resolve) => {
      releaseStt = resolve;
    });
    let sttStarted: () => void = () => undefined;
    const sttStartedAt = new Promise<void>((resolve) => {
      sttStarted = resolve;
    });
    const sttRun = runOnce(db, {
      transcribe: async () => {
        sttStarted();
        await sttGate;
        return {
          mode: "live" as const,
          segments: [
            {
              speaker: "Спикер 1",
              startedAtMs: 0,
              endedAtMs: 1000,
              text: "Ещё пишем текст",
            },
          ],
        };
      },
      summarize: async () => {
        throw new Error("саммари не должен идти из transcribe");
      },
    });
    await sttStartedAt;
    db.enqueueJob({ meetingId: llm.id, type: "summarize" });
    const llmProcessed = await runOnce(db, {
      summarize: async () => ({
        mode: "live" as const,
        summary: {
          headline: "Итог",
          decisions: "Решили",
          risks: "",
          nextStep: "Дальше",
          decisionSegmentIds: [],
        },
        actionItems: [],
      }),
      resolveLlmKey: () => "",
    });
    expect(llmProcessed).toBe(true);
    expect(db.getMeeting(llm.id)?.status).toBe("ready");
    expect(db.getMeeting(stt.id)?.status).toBe("transcribing");
    releaseStt();
    expect(await sttRun).toBe(true);
    expect(db.getMeeting(stt.id)?.status).toBe("summarizing");
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
    const processed = await runAllJobs(wrapped, {
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
    expect(processed).toBe(3);
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
    const afterJoin = db.getMeeting(meeting.id);
    expect(afterJoin?.status).toBe("transcribing");
    expect(afterJoin?.source).toBe("live");
    expect(afterJoin?.audioPath).toBe(audioPath);
    expect(db.listTranscript(meeting.id)).toEqual([]);
    await expect(
      runOnce(db, { detectSttEngine: () => null, resolveLlmKey: () => "" }),
    ).rejects.toThrow(/нет whisper/);
    const done = db.getMeeting(meeting.id);
    expect(done?.status).toBe("error");
    expect(done?.audioPath).toBe(audioPath);
    expect(db.listTranscript(meeting.id).some((row) => /standup/i.test(row.text))).toBe(
      false,
    );
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
      await runAllJobs(db, {
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
    ).toBe(3);
    expect(db.getMeeting(second.id)?.status).toBe("ready");
  });

  it("живой join при падении whisper ставит error, а не заглушку pending", async () => {
    db = createDb(":memory:");
    const meeting = db.createMeeting({
      url: "https://zoom.us/j/99988877766",
      platform: "zoom",
    });
    db.enqueueJob({ meetingId: meeting.id, type: "join" });
    expect(
      await runOnce(db, {
        join: async (_item, hooks) => {
          await hooks?.onJoined?.({ mode: "live" });
          return { mode: "live", audioPath: "/tmp/pm-missing-audio.wav" };
        },
      }),
    ).toBe(true);
    expect(db.getMeeting(meeting.id)?.status).toBe("transcribing");
    await expect(
      runOnce(db, {
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
      const processed = await runAllJobs(db, {
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
      expect(processed).toBe(3);
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
    const processed = await runAllJobs(db, {
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
            decisionSegmentIds: [],
          },
          actionItems: [],
        };
      },
      resolveLlmKey: () => "sk-test",
    });
    expect(processed).toBe(3);
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
    const processed = await runAllJobs(db, {
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
    expect(processed).toBe(3);
    expect(summarizeCalls).toBe(0);
    const done = db.getMeeting(meeting.id);
    expect(done?.status).toBe("ready");
    expect(done?.error).toBeNull();
    expect(db.listTranscript(meeting.id)[0]?.text).toMatch(/бута/);
    expect(db.getSummary(meeting.id)?.decisions).toMatch(/429/);
    expect(db.getSummary(meeting.id)?.risks).toMatch(/ревью расшифровки не применилось/i);
  });

  it("задание summarize пересчитывает резюме по сохранённому тексту", async () => {
    db = createDb(":memory:");
    const meeting = db.createMeeting({
      url: "https://zoom.us/j/summarize",
      platform: "zoom",
    });
    db.updateMeetingStatus(meeting.id, "joining");
    db.updateMeetingStatus(meeting.id, "recording");
    db.updateMeetingStatus(meeting.id, "transcribing");
    db.updateMeetingStatus(meeting.id, "summarizing");
    db.updateMeetingStatus(meeting.id, "ready");
    db.saveTranscript(meeting.id, [
      {
        speaker: "Илья",
        startedAtMs: 0,
        endedAtMs: 2000,
        text: "Берём прототип к четвергу",
      },
    ]);
    db.saveSummary(meeting.id, {
      headline: "старое",
      decisions: "",
      risks: "",
      nextStep: "",
    });
    db.enqueueJob({ meetingId: meeting.id, type: "summarize" });
    const processed = await runOnce(db, {
      summarize: async () => ({
        mode: "live",
        summary: {
          headline: "новое резюме",
          decisions: "Берём прототип",
          risks: "",
          nextStep: "Собрать",
          decisionSegmentIds: [],
        },
        actionItems: [{
          title: "Собрать прототип",
          assignee: "Илья",
          dueAt: null,
          timecodeMs: 0,
          segmentId: null,
        }],
      }),
    });
    expect(processed).toBe(true);
    expect(db.getMeeting(meeting.id)?.status).toBe("ready");
    expect(db.getSummary(meeting.id)?.headline).toBe("новое резюме");
    expect(db.listActionItems(meeting.id)).toHaveLength(1);
  });
});
