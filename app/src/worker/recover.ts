import type { Db } from "../db/index.ts";
import type { Meeting, MeetingStatus } from "../shared/types.ts";
import { assertStatusTransition } from "./status.ts";

export const ORPHAN_JOB_ERROR = "задание снято: воркер перезапущен";
export const AUDIO_EXISTS_SKIP_JOIN = "есть файл звука: повторный вход не нужен";
export const JOIN_STUCK_NO_AUDIO =
  "вход в звонок завис, файла звука нет";
export const DUPLICATE_JOB_ERROR = "дубликат задания снят";

const IN_FLIGHT: MeetingStatus[] = [
  "queued",
  "joining",
  "waiting_room",
  "recording",
  "transcribing",
  "summarizing",
];

export function meetingHasAudio(meeting: Meeting | null | undefined): boolean {
  return Boolean(meeting?.audioPath?.trim());
}

export function hasActiveJob(
  db: Db,
  meetingId: string,
  type?: string,
): boolean {
  return db.hasActiveJob(meetingId, type);
}

export function failExtraTranscribeJobs(db: Db): number {
  const activeByMeeting = new Map<string, { id: string; status: string }[]>();
  for (const job of db.listJobs()) {
    if (job.type !== "transcribe") {
      continue;
    }
    if (job.status !== "pending" && job.status !== "running") {
      continue;
    }
    const list = activeByMeeting.get(job.meetingId) ?? [];
    list.push({ id: job.id, status: job.status });
    activeByMeeting.set(job.meetingId, list);
  }
  let failed = 0;
  for (const jobs of activeByMeeting.values()) {
    if (jobs.length <= 1) {
      continue;
    }
    const running = jobs.find((job) => job.status === "running");
    const keepId = running?.id ?? jobs[0]?.id;
    for (const job of jobs) {
      if (job.id === keepId) {
        continue;
      }
      db.failJob(job.id, DUPLICATE_JOB_ERROR);
      failed += 1;
    }
  }
  return failed;
}

export function recoverStuckMeetings(db: Db): {
  transcribeQueued: number;
  meetingsErrored: number;
  joinJobsFailed: number;
  extraJobsFailed: number;
} {
  let transcribeQueued = 0;
  let meetingsErrored = 0;
  let joinJobsFailed = 0;
  const extraJobsFailed = failExtraTranscribeJobs(db);

  for (const job of db.listJobs()) {
    if (job.type !== "join") {
      continue;
    }
    if (job.status !== "pending") {
      continue;
    }
    const meeting = db.getMeeting(job.meetingId);
    if (!meetingHasAudio(meeting) || !meeting) {
      continue;
    }
    db.failJob(job.id, AUDIO_EXISTS_SKIP_JOIN);
    joinJobsFailed += 1;
    if (!hasActiveJob(db, meeting.id, "transcribe")) {
      db.enqueueJob({ meetingId: meeting.id, type: "transcribe" });
      transcribeQueued += 1;
    }
  }

  for (const meeting of db.listMeetings()) {
    if (!IN_FLIGHT.includes(meeting.status)) {
      continue;
    }
    if (hasActiveJob(db, meeting.id)) {
      continue;
    }
    if (
      meeting.status === "summarizing" &&
      db.listTranscript(meeting.id).length > 0
    ) {
      if (!hasActiveJob(db, meeting.id, "summarize")) {
        db.enqueueJob({ meetingId: meeting.id, type: "summarize" });
      }
      continue;
    }
    if (meetingHasAudio(meeting)) {
      if (!hasActiveJob(db, meeting.id, "transcribe")) {
        db.enqueueJob({ meetingId: meeting.id, type: "transcribe" });
        transcribeQueued += 1;
      }
      continue;
    }
    if (meeting.status === "joining" || meeting.status === "recording") {
      try {
        assertStatusTransition(meeting.status, "error");
      } catch {
        // запись всё равно ставим: встреча без звука и без задания
      }
      db.updateMeetingStatus(meeting.id, "error", {
        error: JOIN_STUCK_NO_AUDIO,
      });
      meetingsErrored += 1;
    }
  }

  return { transcribeQueued, meetingsErrored, joinJobsFailed, extraJobsFailed };
}

export function recoverOrphanedWork(db: Db): {
  jobsFailed: number;
  transcribeQueued: number;
  meetingsErrored: number;
  joinJobsFailed: number;
  extraJobsFailed: number;
} {
  const orphans = db.failAllRunningJobs(ORPHAN_JOB_ERROR);
  const rest = recoverStuckMeetings(db);
  return {
    jobsFailed: orphans.length,
    ...rest,
  };
}
