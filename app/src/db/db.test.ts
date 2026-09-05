import { afterEach, describe, expect, it } from "vitest";
import { createDb } from "./index.ts";

describe("db v2 migration", () => {
  let db: ReturnType<typeof createDb>;

  afterEach(() => {
    db?.close();
  });

  it("создаёт базу с пустым списком встреч", () => {
    db = createDb(":memory:");
    expect(db.listMeetings()).toEqual([]);
  });

  it("сидирует проект «Свои» и привязывает новые встречи", () => {
    db = createDb(":memory:");
    const projects = db.listProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe("Свои");

    const meeting = db.createMeeting({ url: "https://zoom.us/j/123" });
    expect(meeting.projectId).toBe(projects[0].id);
    expect(db.getMeeting(meeting.id)?.projectId).toBe(projects[0].id);
  });

  it("пишет и читает настройки, включая trackerType", () => {
    db = createDb(":memory:");
    expect(db.getSettings().trackerType).toBe("clickup");
    db.putSettings({ recordingModeDefault: "full", trackerType: "asana" });
    expect(db.getSettings().recordingModeDefault).toBe("full");
    expect(db.getSettings().trackerType).toBe("asana");
  });

  it("мигрирует asana_state в tracker_state", () => {
    db = createDb(":memory:");
    const meeting = db.createMeeting({ url: "https://zoom.us/j/1" });
    db.saveActionItems(meeting.id, [{ title: "Задача", assignee: null, dueAt: null, timecodeMs: null, segmentId: null }]);
    const [item] = db.listActionItems(meeting.id);
    expect(item.trackerState).toBe("none");
    expect(item.asanaState).toBe("none");

    db.markActionItemsQueuedForAsana([item.id]);
    const queued = db.listActionItems(meeting.id)[0];
    expect(queued.trackerState).toBe("queued");
    expect(queued.trackerType).toBe("asana");
    expect(queued.asanaState).toBe("queued_for_asana");
  });

  it("создаёт пользователя и сессию", () => {
    db = createDb(":memory:");
    const user = db.createUser({
      email: "user@example.com",
      displayName: "Иван",
      passwordHash: "salt:hash",
    });
    const session = db.createSession(user.id, 60_000);
    const loaded = db.getSession(session.id);
    expect(loaded?.user.email).toBe("user@example.com");
    expect(loaded?.user.displayName).toBe("Иван");
  });

  it("копирует headline в title, если название встречи пустое", () => {
    db = createDb(":memory:");
    const meeting = db.createMeeting({ url: "https://zoom.us/j/123" });
    expect(meeting.title).toBeNull();

    db.saveSummary(meeting.id, {
      headline: "Синк по релизу v0.2.1",
      decisions: "",
      risks: "",
      nextStep: "",
    });

    expect(db.getMeeting(meeting.id)?.title).toBe("Синк по релизу v0.2.1");
  });

  it("не перезаписывает title и не копирует системный headline", () => {
    db = createDb(":memory:");
    const withTitle = db.createMeeting({
      url: "https://zoom.us/j/1",
      title: "Уже задано",
    });
    db.saveSummary(withTitle.id, {
      headline: "Другое название",
      decisions: "",
      risks: "",
      nextStep: "",
    });
    expect(db.getMeeting(withTitle.id)?.title).toBe("Уже задано");

    const pending = db.createMeeting({ url: "https://zoom.us/j/2" });
    db.saveSummary(pending.id, {
      headline: "Звук сохранён, расшифровка ещё не подключена",
      decisions: "",
      risks: "",
      nextStep: "",
    });
    expect(db.getMeeting(pending.id)?.title).toBeNull();
  });

  it("updateMeetingTitle меняет название встречи", () => {
    db = createDb(":memory:");
    const meeting = db.createMeeting({ url: "https://zoom.us/j/9" });
    const updated = db.updateMeetingTitle(meeting.id, "Новое имя");
    expect(updated?.title).toBe("Новое имя");
    expect(db.getMeeting(meeting.id)?.title).toBe("Новое имя");
  });

  it("updateMeetingProject меняет проект встречи", () => {
    db = createDb(":memory:");
    const project = db.createProject({
      name: "Новый проект",
      trackerProjectRef: "",
      trackerParentRef: "",
    });
    const meeting = db.createMeeting({
      url: "https://zoom.us/j/10",
      projectId: db.listProjects()[0]?.id,
    });
    const updated = db.updateMeetingProject(meeting.id, project.id);
    expect(updated?.projectId).toBe(project.id);
    expect(db.getMeeting(meeting.id)?.projectId).toBe(project.id);
  });

  it("не берёт следующее задание, пока running жив, и снимает stale running", () => {
    db = createDb(":memory:");
    const first = db.createMeeting({ url: "https://zoom.us/j/1" });
    const second = db.createMeeting({ url: "https://zoom.us/j/2" });
    db.enqueueJob({ meetingId: first.id, type: "join" });
    db.enqueueJob({ meetingId: second.id, type: "join" });
    const claimed = db.claimNextJob();
    expect(claimed?.status).toBe("running");
    expect(db.claimNextJob()).toBeNull();
    const stale = db.failStaleRunningJobs(0);
    expect(stale).toHaveLength(1);
    const next = db.claimNextJob();
    expect(next).toBeTruthy();
    expect(next?.id).not.toBe(claimed?.id);
    expect(next?.meetingId).not.toBe(claimed?.meetingId);
  });

  it("берёт расшифровку, пока другой созвон ещё в join", () => {
    db = createDb(":memory:");
    const live = db.createMeeting({ url: "https://zoom.us/j/live" });
    const recorded = db.createMeeting({ url: "https://zoom.us/j/done" });
    db.enqueueJob({ meetingId: live.id, type: "join" });
    db.enqueueJob({ meetingId: recorded.id, type: "transcribe" });
    const join = db.claimNextJob();
    expect(join?.type).toBe("join");
    expect(join?.meetingId).toBe(live.id);
    const transcribe = db.claimNextJob();
    expect(transcribe?.type).toBe("transcribe");
    expect(transcribe?.meetingId).toBe(recorded.id);
    expect(db.claimNextJob()).toBeNull();
  });

  it("берёт саммари, пока идут join и расшифровка", () => {
    db = createDb(":memory:");
    const live = db.createMeeting({ url: "https://zoom.us/j/live" });
    const recorded = db.createMeeting({ url: "https://zoom.us/j/stt" });
    const done = db.createMeeting({ url: "https://zoom.us/j/llm" });
    db.enqueueJob({ meetingId: live.id, type: "join" });
    db.enqueueJob({ meetingId: recorded.id, type: "transcribe" });
    db.enqueueJob({ meetingId: done.id, type: "summarize" });
    expect(db.claimNextJob()?.type).toBe("join");
    expect(db.claimNextJob()?.type).toBe("transcribe");
    expect(db.claimNextJob()?.type).toBe("summarize");
    expect(db.claimNextJob()).toBeNull();
  });

  it("записывает created_at при постановке задания в очередь", () => {
    db = createDb(":memory:");
    const meeting = db.createMeeting({ url: "https://zoom.us/j/created" });
    const before = Date.now();
    const job = db.enqueueJob({ meetingId: meeting.id, type: "join" });
    const after = Date.now();
    expect(job.createdAt).toBeTruthy();
    const createdMs = Date.parse(job.createdAt!);
    expect(createdMs).toBeGreaterThanOrEqual(before);
    expect(createdMs).toBeLessThanOrEqual(after);
    expect(db.listJobs()[0].createdAt).toBe(job.createdAt);
  });

  it("удаляет встречу вместе с сегментами и правит текст фрагмента", () => {
    db = createDb(":memory:");
    const meeting = db.createMeeting({ url: "https://zoom.us/j/del" });
    db.saveTranscript(meeting.id, [
      {
        speaker: "Илья",
        startedAtMs: 0,
        endedAtMs: 1000,
        text: "черновик",
      },
    ]);
    db.saveSummary(meeting.id, {
      headline: "заголовок",
      decisions: "",
      risks: "",
      nextStep: "",
    });
    const [seg] = db.listTranscript(meeting.id);
    const updated = db.updateTranscriptSegment(meeting.id, seg.id, "исправлено");
    expect(updated?.text).toBe("исправлено");
    expect(db.listTranscript(meeting.id)[0].text).toBe("исправлено");
    db.saveTranscript(meeting.id, [
      {
        speaker: "Илья",
        startedAtMs: 0,
        endedAtMs: 1000,
        text: "первая",
      },
      {
        speaker: "Илья",
        startedAtMs: 1000,
        endedAtMs: 2000,
        text: "вторая",
      },
    ]);
    const [keep, drop] = db.listTranscript(meeting.id);
    db.updateTranscriptSegment(meeting.id, keep.id, "склеено");
    db.removeTranscriptSegments(meeting.id, [drop.id]);
    expect(db.listTranscript(meeting.id).map((row) => row.text)).toEqual([
      "склеено",
    ]);
    expect(db.deleteMeeting(meeting.id)?.id).toBe(meeting.id);
    expect(db.getMeeting(meeting.id)).toBeNull();
    expect(db.listTranscript(meeting.id)).toEqual([]);
    expect(db.getSummary(meeting.id)).toBeNull();
  });
});
