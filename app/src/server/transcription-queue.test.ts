import { afterEach, describe, expect, it } from "vitest";
import { app } from "./app.ts";
import { authHeaders, seedTestAuth, setupAuthedDb } from "./test-auth.ts";

describe("GET /api/transcription-queue", () => {
  let db: ReturnType<typeof setupAuthedDb>["db"];
  let auth: ReturnType<typeof setupAuthedDb>["auth"];

  afterEach(() => {
    db?.close();
  });

  it("отказывает без прав администратора", async () => {
    ({ db } = setupAuthedDb());
    const user = seedTestAuth(db, { email: "user@example.com", role: "user" });

    const res = await app.request("/api/transcription-queue", {
      headers: authHeaders(user),
    });
    expect(res.status).toBe(403);
  });

  it("возвращает pending и running задания с полями очереди", async () => {
    ({ db, auth } = setupAuthedDb());
    const runningMeeting = db.createMeeting({
      url: "https://zoom.us/j/running",
      title: "Идёт расшифровка",
    });
    db.updateMeetingStatus(runningMeeting.id, "transcribing");
    const runningJob = db.enqueueJob({
      meetingId: runningMeeting.id,
      type: "transcribe",
    });
    const claimed = db.claimNextJob();
    expect(claimed?.id).toBe(runningJob.id);
    expect(claimed?.status).toBe("running");

    const meeting = db.createMeeting({
      url: "https://zoom.us/j/queue",
      title: "Созвон по очереди",
    });
    db.updateMeetingStatus(meeting.id, "summarizing");
    const pending = db.enqueueJob({ meetingId: meeting.id, type: "summarize" });

    const res = await app.request("/api/transcription-queue", {
      headers: authHeaders(auth),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{
        job: { id: string; type: string; status: string; createdAt: string | null };
        meeting: { title: string | null; status: string };
        queuedAt: string;
        processingMs: number | null;
        transcribeProgress: { percent: number } | null;
      }>;
    };

    expect(body.items).toHaveLength(2);
    expect(body.items[0].job.status).toBe("running");
    expect(body.items[0].job.type).toBe("transcribe");
    expect(body.items[0].meeting.title).toBe("Идёт расшифровка");
    expect(body.items[0].processingMs).not.toBeNull();
    expect(body.items[0].transcribeProgress).not.toBeNull();

    expect(body.items[1].job.id).toBe(pending.id);
    expect(body.items[1].job.status).toBe("pending");
    expect(body.items[1].job.type).toBe("summarize");
    expect(body.items[1].job.createdAt).toBeTruthy();
    expect(body.items[1].queuedAt).toBe(body.items[1].job.createdAt);
    expect(body.items[1].processingMs).toBeNull();
    expect(body.items[1].transcribeProgress).toBeNull();
  });
});
