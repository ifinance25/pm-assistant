import { afterEach, describe, expect, it } from "vitest";
import { createDb } from "../db/index.ts";
import {
  AUDIO_EXISTS_SKIP_JOIN,
  JOIN_STUCK_NO_AUDIO,
  recoverOrphanedWork,
  recoverStuckMeetings,
} from "./recover.ts";

describe("восстановление очереди", () => {
  let db: ReturnType<typeof createDb>;

  afterEach(() => {
    db?.close();
  });

  it("joining с wav снимает join и ставит transcribe", () => {
    db = createDb(":memory:");
    const meeting = db.createMeeting({ url: "https://zoom.us/j/1" });
    db.updateMeetingStatus(meeting.id, "joining", {
      audioPath: "/tmp/a.wav",
      source: "live",
    });
    db.enqueueJob({ meetingId: meeting.id, type: "join" });
    const result = recoverStuckMeetings(db);
    expect(result.joinJobsFailed).toBe(1);
    expect(result.transcribeQueued).toBe(1);
    expect(
      db.listJobs().some(
        (job) => job.type === "join" && job.lastError === AUDIO_EXISTS_SKIP_JOIN,
      ),
    ).toBe(true);
    expect(
      db.listJobs().some((job) => job.type === "transcribe" && job.status === "pending"),
    ).toBe(true);
  });

  it("joining без звука и без задания ставит error", () => {
    db = createDb(":memory:");
    const meeting = db.createMeeting({ url: "https://zoom.us/j/1" });
    db.updateMeetingStatus(meeting.id, "joining");
    const result = recoverStuckMeetings(db);
    expect(result.meetingsErrored).toBe(1);
    expect(db.getMeeting(meeting.id)?.status).toBe("error");
    expect(db.getMeeting(meeting.id)?.error).toBe(JOIN_STUCK_NO_AUDIO);
  });

  it("при старте воркера снимает running", () => {
    db = createDb(":memory:");
    const meeting = db.createMeeting({ url: "https://zoom.us/j/1" });
    db.enqueueJob({ meetingId: meeting.id, type: "join" });
    expect(db.claimNextJob()?.status).toBe("running");
    const recovered = recoverOrphanedWork(db);
    expect(recovered.jobsFailed).toBe(1);
    expect(db.listJobs().every((job) => job.status !== "running")).toBe(true);
  });
});
