import { Hono } from "hono";
import { buildTranscribeProgress } from "../../adapters/stt/whisper-progress.ts";
import { getDb } from "../../db/index.ts";
import type { Job, Meeting, TranscriptionQueueItem } from "../../shared/types.ts";
import type { AppEnv } from "../app-env.ts";

function resolveQueuedAt(job: Job, meeting: Meeting): string {
  return (
    job.createdAt ??
    job.claimedAt ??
    meeting.startedAt ??
    new Date(0).toISOString()
  );
}

function processingMs(job: Job, nowMs: number): number | null {
  if (job.status !== "running" || !job.claimedAt) {
    return null;
  }
  const claimedMs = Date.parse(job.claimedAt);
  if (!Number.isFinite(claimedMs)) {
    return null;
  }
  return Math.max(0, nowMs - claimedMs);
}

function sortQueueJobs(jobs: Job[]): Job[] {
  return [...jobs].sort((left, right) => {
    if (left.status !== right.status) {
      return left.status === "running" ? -1 : 1;
    }
    return left.id.localeCompare(right.id);
  });
}

export const transcriptionQueueRouter = new Hono<AppEnv>();

transcriptionQueueRouter.get("/transcription-queue", (c) => {
  if (c.get("userRole") !== "admin") {
    return c.json({ error: "нужны права администратора" }, 403);
  }

  const db = getDb();
  const now = new Date().toISOString();
  const nowMs = Date.parse(now);
  const activeJobs = sortQueueJobs(
    db.listJobs().filter((job) => job.status === "pending" || job.status === "running"),
  );

  const items: TranscriptionQueueItem[] = [];
  for (const job of activeJobs) {
    const meeting = db.getMeeting(job.meetingId);
    if (!meeting) {
      continue;
    }
    const transcribeProgress =
      job.type === "transcribe" && job.status === "running"
        ? buildTranscribeProgress({
            startedAt: job.claimedAt,
            now,
            audioPath: meeting.audioPath,
            segments: db.listTranscript(meeting.id),
          })
        : null;
    items.push({
      job,
      meeting: {
        id: meeting.id,
        title: meeting.title,
        url: meeting.url,
        status: meeting.status,
      },
      queuedAt: resolveQueuedAt(job, meeting),
      processingMs: processingMs(job, nowMs),
      transcribeProgress,
    });
  }

  return c.json({ items });
});
