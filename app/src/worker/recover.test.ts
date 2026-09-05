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

  it("не снимает running join, даже если wav уже есть", () => {
    db = createDb(":memory:");
    const meeting = db.createMeeting({ url: "https://zoom.us/j/1" });
    db.enqueueJob({ meetingId: meeting.id, type: "join" });
    expect(db.claimNextJob()?.type).toBe("join");
    db.updateMeetingStatus(meeting.id, "joining");
    db.updateMeetingStatus(meeting.id, "recording", {
      audioPath: "/tmp/a.wav",
      source: "live",
    });
    const result = recoverStuckMeetings(db);
    expect(result.joinJobsFailed).toBe(0);
    expect(result.transcribeQueued).toBe(0);
    expect(
      db.listJobs().some((job) => job.type === "join" && job.status === "running"),
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

  it("снимает лишние pending transcribe, оставляет одно задание", () => {
    db = createDb(":memory:");
    const meeting = db.createMeeting({ url: "https://zoom.us/j/1" });
    db.updateMeetingStatus(meeting.id, "transcribing", {
      audioPath: "/tmp/a.wav",
    });
    db.enqueueJob({ meetingId: meeting.id, type: "transcribe" });
    db.enqueueJob({ meetingId: meeting.id, type: "transcribe" });
    db.enqueueJob({ meetingId: meeting.id, type: "transcribe" });
    const claimed = db.claimNextJob();
    expect(claimed?.type).toBe("transcribe");
    const result = recoverStuckMeetings(db);
    expect(result.extraJobsFailed).toBe(2);
    const transcribe = db
      .listJobs()
      .filter((job) => job.type === "transcribe");
    expect(transcribe.filter((job) => job.status === "running")).toHaveLength(1);
    expect(transcribe.filter((job) => job.status === "pending")).toHaveLength(0);
    expect(transcribe.filter((job) => job.status === "failed")).toHaveLength(2);
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

  it("summarizing с текстом без задания ставит summarize, не transcribe", () => {
    db = createDb(":memory:");
    const meeting = db.createMeeting({ url: "https://zoom.us/j/1" });
    db.updateMeetingStatus(meeting.id, "joining");
    db.updateMeetingStatus(meeting.id, "recording", {
      audioPath: "/tmp/a.wav",
      source: "live",
    });
    db.updateMeetingStatus(meeting.id, "transcribing");
    db.saveTranscript(meeting.id, [
      {
        speaker: "Илья",
        startedAtMs: 0,
        endedAtMs: 1000,
        text: "Готовый текст",
      },
    ]);
    db.updateMeetingStatus(meeting.id, "summarizing");
    const result = recoverStuckMeetings(db);
    expect(result.transcribeQueued).toBe(0);
    expect(
      db.listJobs().some((job) => job.type === "summarize" && job.status === "pending"),
    ).toBe(true);
    expect(db.listJobs().some((job) => job.type === "transcribe")).toBe(false);
  });
});
