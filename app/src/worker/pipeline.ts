import {
  announceRecording,
  STUB_ANNOUNCEMENT_STATUS,
} from "../adapters/announce/index.ts";
import { maybeAutoSendTracker } from "../adapters/tracker/index.ts";
import { deliverReadyWebhook } from "../adapters/webhook/index.ts";
import {
  createLlmAdapter,
  type LlmAdapter,
  type SummarizeResult,
} from "../adapters/llm/index.ts";
import { isLlmRateLimitError } from "../adapters/llm/live.ts";
import {
  liveAudioPendingSummary,
  summaryFromTranscriptOnly,
} from "../adapters/llm/pending.ts";
import {
  createJoinAdapter,
  type JoinAdapter,
  type JoinHooks,
  type JoinResult,
} from "../adapters/platform/index.ts";
import {
  createSttAdapter,
  detectSttEngine,
  type SttEngine,
  type Transcript,
} from "../adapters/stt/index.ts";
import {
  isLivePendingTranscript,
  liveAudioPendingTranscript,
} from "../adapters/stt/pending.ts";
import { normalizeMeetingAudio } from "../adapters/stt/trim-silence.ts";
import { isAbortError } from "../shared/http-timeout.ts";
import type { Db } from "../db/index.ts";
import type { Job, Meeting, MeetingStatus } from "../shared/types.ts";
import { meetingHasAudio, recoverStuckMeetings } from "./recover.ts";
import { assertStatusTransition } from "./status.ts";

export type ProcessJobDeps = {
  join?: JoinAdapter["join"];
  detectSttEngine?: () => SttEngine | null;
  resolveLlmKey?: () => string;
  transcribe?: (
    audioPath: string,
    detect: () => SttEngine | null,
  ) => Promise<Transcript>;
  reviseTranscript?: (transcript: Transcript) => Promise<Transcript>;
  summarize?: (transcript: Transcript) => Promise<SummarizeResult>;
};

function setStatus(
  db: Db,
  meeting: Meeting,
  status: MeetingStatus,
  extra: Parameters<Db["updateMeetingStatus"]>[2] = {},
): Meeting {
  assertStatusTransition(meeting.status, status);
  return db.updateMeetingStatus(meeting.id, status, extra);
}

function resolveLlm(resolveKey?: () => string): LlmAdapter {
  return resolveKey !== undefined
    ? createLlmAdapter({ apiKey: resolveKey() })
    : createLlmAdapter();
}

async function transcribeLive(
  join: JoinResult,
  detect: () => SttEngine | null,
): Promise<Transcript> {
  const engine = detect();
  if (!join.audioPath || !engine) {
    return liveAudioPendingTranscript(join.audioPath);
  }
  return createSttAdapter({ detectEngine: () => engine }).transcribe(
    join.audioPath,
    { languageHint: "ru" },
  );
}

async function summarizeLive(
  transcript: Transcript,
  audioPath: string | null,
  resolveKey?: () => string,
): Promise<SummarizeResult> {
  if (isLivePendingTranscript(transcript)) {
    return liveAudioPendingSummary(audioPath);
  }
  const llm = resolveLlm(resolveKey);
  if (llm.mode === "live") {
    return llm.summarize(transcript);
  }
  return summaryFromTranscriptOnly(transcript);
}

async function summarizeOrFallback(
  transcript: Transcript,
  audioPath: string | null,
  resolveKey?: () => string,
  summarizeFn?: (transcript: Transcript) => Promise<SummarizeResult>,
): Promise<SummarizeResult> {
  try {
    if (summarizeFn) {
      return await summarizeFn(transcript);
    }
    return await summarizeLive(transcript, audioPath, resolveKey);
  } catch (err) {
    if (isLivePendingTranscript(transcript) || isAbortError(err)) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    const reason = isLlmRateLimitError(err) ? "rate-limit" : "failed";
    console.error(`llm: ${message}, сохраняю резюме из текста`);
    return summaryFromTranscriptOnly(transcript, { reason });
  }
}

function llmTimeoutMs(): number {
  const raw = Number(process.env.PM_ASSISTANT_LLM_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  return 120_000;
}

async function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  const ms = llmTimeoutMs();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          const err = new Error(`${label} превысила время ожидания`);
          err.name = "TimeoutError";
          reject(err);
        }, ms);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function reviseViaAdapter(
  transcript: Transcript,
  resolveKey?: () => string,
): Promise<Transcript> {
  const llm = resolveLlm(resolveKey);
  if (llm.mode !== "live") {
    return transcript;
  }
  return llm.reviseTranscript(transcript);
}

async function reviseThenSummarize(
  db: Db,
  current: Meeting,
  transcript: Transcript,
  audioPath: string | null,
  deps: ProcessJobDeps,
  opts: { stubLlm: boolean },
): Promise<Meeting> {
  let working = transcript;
  let reviewSkipped = false;
  let reviewReason: "rate-limit" | "failed" | undefined;
  const canRevise = !opts.stubLlm && !isLivePendingTranscript(transcript);

  if (canRevise) {
    try {
      working = await withTimeout(
        deps.reviseTranscript
          ? deps.reviseTranscript(transcript)
          : reviseViaAdapter(transcript, deps.resolveLlmKey),
        "языковая модель",
      );
    } catch (err) {
      if (isAbortError(err)) {
        throw err;
      }
      reviewSkipped = true;
      reviewReason = isLlmRateLimitError(err) ? "rate-limit" : "failed";
      const why =
        reviewReason === "rate-limit" ? "лимит 429" : "ошибка модели";
      console.error(
        `llm: ревью расшифровки не применилось (${why}), сохраняю сырой текст`,
      );
      working = transcript;
    }
  }

  db.saveTranscript(current.id, working.segments);
  current = setStatus(db, current, "summarizing");

  let summarized: SummarizeResult;
  if (isLivePendingTranscript(working)) {
    summarized = liveAudioPendingSummary(audioPath);
  } else if (reviewSkipped) {
    summarized = summaryFromTranscriptOnly(working, {
      reason: reviewReason,
      reviewSkipped: true,
    });
  } else if (opts.stubLlm) {
    summarized = deps.summarize
      ? await deps.summarize(working)
      : await createLlmAdapter({ apiKey: "" }).summarize(working);
  } else {
    summarized = await withTimeout(
      summarizeOrFallback(
        working,
        audioPath,
        deps.resolveLlmKey,
        deps.summarize,
      ),
      "языковая модель",
    );
  }

  db.saveSummary(current.id, summarized.summary);
  db.saveActionItems(
    current.id,
    summarized.actionItems.map((item) => ({
      assignee: item.assignee,
      title: item.title,
      dueAt: item.dueAt,
      timecodeMs: item.timecodeMs,
      segmentId: null,
    })),
  );
  return setStatus(db, current, "ready", {
    endedAt: new Date().toISOString(),
    error: null,
  });
}

/**
 * Срезает ожидание встречи по краям записи и выравнивает громкость.
 * Исходник заменяется результатом, чтобы плеер и таймкоды расшифровки
 * считали время от одного нуля: от первого слова, а не от входа бота.
 */
async function prepareMeetingAudio(
  db: Db,
  meeting: Meeting,
  audioPath: string,
): Promise<string> {
  const prepared = await normalizeMeetingAudio(audioPath);
  if (!prepared) {
    throw new Error("звук не записался: бот не поймал аудио звонка");
  }
  if (prepared !== audioPath) {
    db.updateMeetingStatus(meeting.id, meeting.status, {
      audioPath: prepared,
    });
  }
  return prepared;
}

function moveToTranscribing(db: Db, meeting: Meeting): Meeting {
  if (meeting.status === "transcribing") {
    return db.updateMeetingStatus(meeting.id, meeting.status, { error: null });
  }
  if (
    meeting.status === "ready" ||
    meeting.status === "error" ||
    meeting.status === "queued" ||
    meeting.status === "joining" ||
    meeting.status === "recording" ||
    meeting.status === "summarizing"
  ) {
    return setStatus(db, meeting, "transcribing", { error: null });
  }
  throw new Error(
    `расшифровку нельзя запустить из статуса ${meeting.status}`,
  );
}

async function processTranscribeJob(
  db: Db,
  job: Job,
  meeting: Meeting,
  deps: ProcessJobDeps,
): Promise<void> {
  const audioPath = meeting.audioPath;
  if (!audioPath) {
    throw new Error("нет файла звука для расшифровки");
  }
  const detect = deps.detectSttEngine ?? detectSttEngine;
  const engine = detect();
  if (!engine && !deps.transcribe) {
    throw new Error(
      "нет whisper: задайте WHISPER_BIN=/usr/local/bin/whisper и WHISPER_MODEL",
    );
  }
  let current = moveToTranscribing(db, meeting);
  const preparedPath = await prepareMeetingAudio(db, current, audioPath);
  const transcript = deps.transcribe
    ? await deps.transcribe(preparedPath, detect)
    : await createSttAdapter({
        detectEngine: () => engine,
      }).transcribe(preparedPath, { languageHint: "ru" });
  if (isLivePendingTranscript(transcript)) {
    throw new Error("whisper не вернул текст сегментов");
  }
  await reviseThenSummarize(db, current, transcript, audioPath, deps, {
    stubLlm: false,
  });
  db.finishJob(job.id);
}

export async function processJob(
  db: Db,
  job: Job,
  deps: ProcessJobDeps = {},
): Promise<void> {
  const meeting = db.getMeeting(job.meetingId);
  if (!meeting) {
    throw new Error("встреча не найдена");
  }
  if (job.type === "transcribe" || meetingHasAudio(meeting)) {
    try {
      await processTranscribeJob(db, job, meeting, deps);
    } catch (err) {
      const latest = db.getMeeting(job.meetingId);
      const message = err instanceof Error ? err.message : String(err);
      db.failJob(job.id, message);
      if (latest && latest.status !== "error") {
        try {
          assertStatusTransition(latest.status, "error");
          db.updateMeetingStatus(job.meetingId, "error", { error: message });
        } catch {
          db.updateMeetingStatus(job.meetingId, "error", { error: message });
        }
      }
      throw err;
    }
    return;
  }
  try {
    let current = setStatus(db, meeting, "joining", {
      startedAt: new Date().toISOString(),
      error: null,
    });
    const joinFn =
      deps.join ??
      ((item: Meeting, hooks?: JoinHooks) =>
        createJoinAdapter().join(item, hooks));
    const join = await joinFn(current, {
      onJoined: async ({ mode }) => {
        const latest = db.getMeeting(current.id) ?? current;
        if (latest.status !== "joining") {
          return;
        }
        announceRecording({
          meeting: latest,
          join: { mode, audioPath: null },
        });
        const withMeta = db.updateMeetingStatus(latest.id, latest.status, {
          announcementStatus:
            mode === "stub" ? STUB_ANNOUNCEMENT_STATUS : "объявление отправлено",
          source: mode,
        });
        current = setStatus(db, withMeta, "recording");
      },
    });
    current = db.getMeeting(current.id) ?? current;
    if (current.status === "joining") {
      announceRecording({ meeting: current, join });
      current = db.updateMeetingStatus(current.id, current.status, {
        announcementStatus:
          join.mode === "stub" ? STUB_ANNOUNCEMENT_STATUS : "объявление отправлено",
        source: join.mode,
        audioPath: join.audioPath,
      });
      current = setStatus(db, current, "recording");
    } else {
      current = db.updateMeetingStatus(current.id, current.status, {
        source: join.mode,
        audioPath: join.audioPath,
      });
    }
    const audioPath = join.audioPath
      ? await prepareMeetingAudio(db, current, join.audioPath)
      : null;
    let transcript: Transcript;
    if (deps.transcribe && audioPath) {
      transcript = await deps.transcribe(
        audioPath,
        deps.detectSttEngine ?? detectSttEngine,
      );
    } else if (join.mode === "stub") {
      throw new Error(
        "платформа не реализована: демо-расшифровку в базу не записываем",
      );
    } else {
      transcript = await transcribeLive(
        { ...join, audioPath },
        deps.detectSttEngine ?? detectSttEngine,
      );
    }
    if (current.status === "recording") {
      current = setStatus(db, current, "transcribing");
    }
    const ready = await reviseThenSummarize(
      db,
      current,
      transcript,
      audioPath,
      deps,
      { stubLlm: join.mode === "stub" },
    );
    await deliverReadyWebhook(db, ready);
    await maybeAutoSendTracker(db, current.id);
    db.finishJob(job.id);
  } catch (err) {
    const latest = db.getMeeting(job.meetingId);
    const message = err instanceof Error ? err.message : String(err);
    db.failJob(job.id, message);
    if (latest && latest.status !== "error") {
      try {
        assertStatusTransition(latest.status, "error");
        db.updateMeetingStatus(job.meetingId, "error", { error: message });
      } catch {
        if (latest.status !== "ready") {
          db.updateMeetingStatus(job.meetingId, "error", { error: message });
        }
      }
    }
    throw err;
  }
}

export async function runOnce(
  db: Db,
  deps: ProcessJobDeps = {},
): Promise<boolean> {
  recoverStuckMeetings(db);
  const job = db.claimNextJob();
  if (!job) {
    return false;
  }
  await processJob(db, job, deps);
  return true;
}
