import type { Db } from "../db/index.ts";
import type { Meeting, MeetingStatus } from "../shared/types.ts";
import { assertStatusTransition } from "./status.ts";

export const ORPHAN_JOB_ERROR = "задание снято: воркер перезапущен";
export const AUDIO_EXISTS_SKIP_JOIN = "есть файл звука: повторный вход не нужен";
export const JOIN_STUCK_NO_AUDIO =
  "вход в звонок завис, файла звука нет";

const IN_FLIGHT: MeetingStatus[] = [
  "queued",
  "joining",
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

export function recoverStuckMeetings(db: Db): {
  transcribeQueued: number;
  meetingsErrored: number;
  joinJobsFailed: number;
} {
  let transcribeQueued = 0;
  let meetingsErrored = 0;
  let joinJobsFailed = 0;

  for (const job of db.listJobs()) {
    if (job.type !== "join") {
      continue;
    }
    if (job.status !== "pending" && job.status !== "running") {
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

  return { transcribeQueued, meetingsErrored, joinJobsFailed };
}

export function recoverOrphanedWork(db: Db): {
  jobsFailed: number;
  transcribeQueued: number;
  meetingsErrored: number;
  joinJobsFailed: number;
} {
  const orphans = db.failAllRunningJobs(ORPHAN_JOB_ERROR);
  const rest = recoverStuckMeetings(db);
  return {
    jobsFailed: orphans.length,
    ...rest,
  };
}
