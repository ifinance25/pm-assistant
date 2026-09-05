import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "./app.ts";
import { authHeaders, setupAuthedDb } from "./test-auth.ts";

describe("POST /api/meetings/:id/retry и /transcribe", () => {
  let db: ReturnType<typeof setupAuthedDb>["db"];
  let auth: ReturnType<typeof setupAuthedDb>["auth"];

  afterEach(() => {
    db?.close();
  });

  it("retry ставит queued и кладёт задание join", async () => {
    ({ db, auth } = setupAuthedDb());
    const meeting = db.createMeeting({ url: "https://zoom.us/j/1" });
    db.updateMeetingStatus(meeting.id, "joining");
    db.updateMeetingStatus(meeting.id, "error", { error: "бот упал" });
    const res = await app.request(`/api/meetings/${meeting.id}/retry`, {
      method: "POST",
      headers: authHeaders(auth),
    });
    expect(res.status).toBe(200);
    expect(db.getMeeting(meeting.id)?.status).toBe("queued");
    expect(db.listJobs().some((job) => job.type === "join")).toBe(true);
  });

  it("retry при audio_path ставит задание transcribe, не join", async () => {
    ({ db, auth } = setupAuthedDb());
    const meeting = db.createMeeting({ url: "https://zoom.us/j/1" });
    db.updateMeetingStatus(meeting.id, "joining");
    db.updateMeetingStatus(meeting.id, "recording", {
      audioPath: "/tmp/a.wav",
      source: "live",
    });
    db.updateMeetingStatus(meeting.id, "error", { error: "llm ответил статусом 429" });
    db.enqueueJob({ meetingId: meeting.id, type: "join" });
    const res = await app.request(`/api/meetings/${meeting.id}/retry`, {
      method: "POST",
      headers: authHeaders(auth),
    });
    expect(res.status).toBe(202);
    expect(db.getMeeting(meeting.id)?.status).toBe("error");
    const jobs = db.listJobs();
    expect(jobs.some((job) => job.type === "transcribe" && job.status === "pending")).toBe(
      true,
    );
    expect(
      jobs.some(
        (job) =>
          job.type === "join" &&
          (job.status === "pending" || job.status === "running"),
      ),
    ).toBe(false);
  });

  it("transcribe без звука отвечает 409", async () => {
    ({ db, auth } = setupAuthedDb());
    const meeting = db.createMeeting({ url: "https://zoom.us/j/1" });
    const res = await app.request(`/api/meetings/${meeting.id}/transcribe`, {
      method: "POST",
      headers: authHeaders(auth),
    });
    expect(res.status).toBe(409);
  });

  it("transcribe не дублирует задание, если расшифровка уже в очереди", async () => {
    ({ db, auth } = setupAuthedDb());
    const meeting = db.createMeeting({ url: "https://zoom.us/j/1" });
    db.updateMeetingStatus(meeting.id, "joining");
    db.updateMeetingStatus(meeting.id, "recording", {
      audioPath: "/tmp/a.wav",
      source: "live",
    });
    db.updateMeetingStatus(meeting.id, "transcribing");
    const first = await app.request(`/api/meetings/${meeting.id}/transcribe`, {
      method: "POST",
      headers: authHeaders(auth),
    });
    const second = await app.request(`/api/meetings/${meeting.id}/transcribe`, {
      method: "POST",
      headers: authHeaders(auth),
    });
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(
      db.listJobs().filter((job) => job.type === "transcribe").length,
    ).toBe(1);
  });

  it("GET transcribing отдаёт прогноз окончания", async () => {
    ({ db, auth } = setupAuthedDb());
    const meeting = db.createMeeting({ url: "https://zoom.us/j/1" });
    db.updateMeetingStatus(meeting.id, "transcribing", {
      audioPath: "/tmp/a.wav",
      source: "live",
    });
    db.enqueueJob({ meetingId: meeting.id, type: "transcribe" });
    db.claimNextJob();
    db.saveTranscript(meeting.id, [
      {
        speaker: "Спикер 1",
        startedAtMs: 0,
        endedAtMs: 30_000,
        text: "Первый фрагмент",
      },
    ]);
    const res = await app.request(`/api/meetings/${meeting.id}`, {
      headers: authHeaders(auth),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      transcribeProgress?: { percent: number; startedAt: string | null };
    };
    expect(body.transcribeProgress?.startedAt).toBeTruthy();
  });

  it("transcribe с audio_path ставит задание", async () => {
    ({ db, auth } = setupAuthedDb());
    const meeting = db.createMeeting({ url: "https://zoom.us/j/1" });
    db.updateMeetingStatus(meeting.id, "joining");
    db.updateMeetingStatus(meeting.id, "recording", {
      audioPath: "/tmp/a.wav",
      source: "live",
    });
    db.updateMeetingStatus(meeting.id, "transcribing");
    db.updateMeetingStatus(meeting.id, "summarizing");
    db.updateMeetingStatus(meeting.id, "ready");
    const res = await app.request(`/api/meetings/${meeting.id}/transcribe`, {
      method: "POST",
      headers: authHeaders(auth),
    });
    expect(res.status).toBe(202);
    expect(db.listJobs().some((job) => job.type === "transcribe")).toBe(true);
  });

  it("transcribe из joining с wav отвечает 202", async () => {
    ({ db, auth } = setupAuthedDb());
    const meeting = db.createMeeting({ url: "https://zoom.us/j/1" });
    db.updateMeetingStatus(meeting.id, "joining", {
      audioPath: "/tmp/a.wav",
      source: "live",
    });
    const res = await app.request(`/api/meetings/${meeting.id}/transcribe`, {
      method: "POST",
      headers: authHeaders(auth),
    });
    expect(res.status).toBe(202);
    expect(db.listJobs().some((job) => job.type === "transcribe")).toBe(true);
  });
});


describe("POST /api/meetings/:id/asana-queue", () => {
  let db: ReturnType<typeof setupAuthedDb>["db"];
  let auth: ReturnType<typeof setupAuthedDb>["auth"];

  afterEach(() => {
    db?.close();
    vi.unstubAllGlobals();
    delete process.env.ASANA_PAT;
  });

  it("помечает задачи queued_for_asana в базе", async () => {
    ({ db, auth } = setupAuthedDb());
    const meeting = db.createMeeting({ url: "https://zoom.us/j/1" });
    const items = db.saveActionItems(meeting.id, [
      {
        assignee: "Илья",
        title: "Подключить тестовый Asana workspace",
        dueAt: "2026-09-04",
        timecodeMs: 258_000,
        segmentId: null,
      },
    ]);
    expect(items[0].asanaState).toBe("none");

    const res = await app.request(`/api/meetings/${meeting.id}/asana-queue`, {
      method: "POST",
      headers: authHeaders(auth),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { actionItems: { asanaState: string }[] };
    expect(body.actionItems[0].asanaState).toBe("queued_for_asana");
    expect(db.listActionItems(meeting.id)[0].asanaState).toBe(
      "queued_for_asana",
    );
    expect(
      (body as { asana?: { notice?: string } }).asana?.notice,
    ).toMatch(/нет ключа ASANA_PAT/i);
  });

  it("при токене делает POST и ставит sent", async () => {
    const prev = process.env.ASANA_PAT;
    process.env.ASANA_PAT = "test-pat";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { gid: "99" } }), { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    ({ db, auth } = setupAuthedDb());
    const meeting = db.createMeeting({ url: "https://zoom.us/j/1" });
    db.saveActionItems(meeting.id, [
      {
        assignee: "Илья",
        title: "Подключить тестовый Asana workspace",
        dueAt: "2026-09-04",
        timecodeMs: 258_000,
        segmentId: null,
      },
    ]);

    try {
      const res = await app.request(`/api/meetings/${meeting.id}/asana-queue`, {
        method: "POST",
        headers: authHeaders(auth),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        actionItems: { asanaState: string }[];
      };
      expect(body.actionItems[0].asanaState).toBe("sent");
      expect(fetchMock).toHaveBeenCalled();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://app.asana.com/api/1.0/tasks");
      expect(init.method).toBe("POST");
    } finally {
      vi.unstubAllGlobals();
      if (prev === undefined) {
        delete process.env.ASANA_PAT;
      } else {
        process.env.ASANA_PAT = prev;
      }
    }
  });
});

describe("GET /api/meetings/:id/audio", () => {
  let db: ReturnType<typeof setupAuthedDb>["db"];
  let auth: ReturnType<typeof setupAuthedDb>["auth"];

  afterEach(() => {
    db?.close();
  });

  it("отдаёт файл звука с Accept-Ranges", async () => {
    ({ db, auth } = setupAuthedDb());
    const dir = mkdtempSync(join(tmpdir(), "pm-audio-"));
    const audioPath = join(dir, "sample.wav");
    writeFileSync(audioPath, "hello-audio");
    const meeting = db.createMeeting({ url: "https://zoom.us/j/1" });
    db.updateMeetingStatus(meeting.id, "recording", { audioPath });

    const res = await app.request(`/api/meetings/${meeting.id}/audio`, {
      headers: authHeaders(auth),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(await res.text()).toBe("hello-audio");
  });

  it("возвращает 404 без audio_path", async () => {
    ({ db, auth } = setupAuthedDb());
    const meeting = db.createMeeting({ url: "https://zoom.us/j/1" });
    const res = await app.request(`/api/meetings/${meeting.id}/audio`, {
      headers: authHeaders(auth),
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/meetings/:id/tracker-create-tasks", () => {
  let db: ReturnType<typeof setupAuthedDb>["db"];
  let auth: ReturnType<typeof setupAuthedDb>["auth"];

  afterEach(() => {
    db?.close();
  });

  it("помечает задачи queued без подключённого трекера", async () => {
    ({ db, auth } = setupAuthedDb());
    const meeting = db.createMeeting({ url: "https://zoom.us/j/1" });
    db.saveActionItems(meeting.id, [
      {
        assignee: "Илья",
        title: "Проверить протокол",
        dueAt: "2026-09-04",
        timecodeMs: null,
        segmentId: null,
      },
    ]);

    const res = await app.request(
      `/api/meetings/${meeting.id}/tracker-create-tasks`,
      { method: "POST", headers: authHeaders(auth) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      actionItems: { trackerState: string }[];
      tracker?: { notice?: string };
    };
    expect(body.actionItems[0].trackerState).toBe("queued");
    expect(body.tracker?.notice).toMatch(/ClickUp/i);
  });
});

describe("POST /api/meetings/:id/ask", () => {
  let db: ReturnType<typeof setupAuthedDb>["db"];
  let auth: ReturnType<typeof setupAuthedDb>["auth"];

  afterEach(() => {
    db?.close();
  });

  it("отдаёт ответ по epic из контекста (stub LLM)", async () => {
    ({ db, auth } = setupAuthedDb());
    const project = db.createProject({
      name: "Roadmap Q4",
      trackerParentRef: "ROAD-100",
    });
    const meeting = db.createMeeting({
      url: "https://zoom.us/j/1",
      projectId: project.id,
    });
    db.saveTranscript(meeting.id, [
      {
        speaker: "Анна",
        startedAtMs: 0,
        endedAtMs: 1000,
        text: "Обсудили roadmap.",
      },
    ]);

    const res = await app.request(`/api/meetings/${meeting.id}/ask`, {
      method: "POST",
      headers: {
        ...authHeaders(auth),
        "content-type": "application/json",
      },
      body: JSON.stringify({ question: "Что в Epic?" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { answer: string };
    expect(body.answer).toContain("ROAD-100");
  });

  it("возвращает 409 без расшифровки", async () => {
    ({ db, auth } = setupAuthedDb());
    const meeting = db.createMeeting({ url: "https://zoom.us/j/1" });
    const res = await app.request(`/api/meetings/${meeting.id}/ask`, {
      method: "POST",
      headers: {
        ...authHeaders(auth),
        "content-type": "application/json",
      },
      body: JSON.stringify({ question: "Какие решения?" }),
    });
    expect(res.status).toBe(409);
  });

  it("возвращает 400 без question", async () => {
    ({ db, auth } = setupAuthedDb());
    const meeting = db.createMeeting({ url: "https://zoom.us/j/1" });
    const res = await app.request(`/api/meetings/${meeting.id}/ask`, {
      method: "POST",
      headers: {
        ...authHeaders(auth),
        "content-type": "application/json",
      },
      body: JSON.stringify({ question: "  " }),
    });
    expect(res.status).toBe(400);
  });
});

describe("удаление встречи, правка расшифровки и повтор саммари", () => {
  let db: ReturnType<typeof setupAuthedDb>["db"];
  let auth: ReturnType<typeof setupAuthedDb>["auth"];

  afterEach(() => {
    db?.close();
  });

  function readyMeeting(audioPath?: string) {
    const meeting = db.createMeeting({ url: "https://zoom.us/j/edit" });
    db.updateMeetingStatus(meeting.id, "joining");
    db.updateMeetingStatus(meeting.id, "recording", {
      audioPath: audioPath ?? null,
      source: "live",
    });
    db.updateMeetingStatus(meeting.id, "transcribing");
    db.updateMeetingStatus(meeting.id, "summarizing");
    return db.updateMeetingStatus(meeting.id, "ready");
  }

  it("DELETE снимает встречу и файл звука", async () => {
    ({ db, auth } = setupAuthedDb());
    const dir = mkdtempSync(join(tmpdir(), "pm-del-"));
    const audioPath = join(dir, "sample.wav");
    writeFileSync(audioPath, "hello-audio");
    const meeting = readyMeeting(audioPath);
    const res = await app.request(`/api/meetings/${meeting.id}`, {
      method: "DELETE",
      headers: authHeaders(auth),
    });
    expect(res.status).toBe(200);
    expect(db.getMeeting(meeting.id)).toBeNull();
    expect(existsSync(audioPath)).toBe(false);
  });

  it("PATCH меняет название встречи", async () => {
    ({ db, auth } = setupAuthedDb());
    const meeting = readyMeeting();
    const res = await app.request(`/api/meetings/${meeting.id}`, {
      method: "PATCH",
      headers: {
        ...authHeaders(auth),
        "content-type": "application/json",
      },
      body: JSON.stringify({ title: "Ручное название" }),
    });
    expect(res.status).toBe(200);
    expect(db.getMeeting(meeting.id)?.title).toBe("Ручное название");
  });

  it("PATCH меняет проект встречи", async () => {
    ({ db, auth } = setupAuthedDb());
    const meeting = readyMeeting();
    const project = db.createProject({
      name: "Другой проект",
      trackerProjectRef: "",
      trackerParentRef: "EPIC-2",
    });
    const res = await app.request(`/api/meetings/${meeting.id}`, {
      method: "PATCH",
      headers: {
        ...authHeaders(auth),
        "content-type": "application/json",
      },
      body: JSON.stringify({ projectId: project.id }),
    });
    expect(res.status).toBe(200);
    expect(db.getMeeting(meeting.id)?.projectId).toBe(project.id);
  });

  it("PATCH правит текст сегмента", async () => {
    ({ db, auth } = setupAuthedDb());
    const meeting = readyMeeting();
    db.saveTranscript(meeting.id, [
      {
        speaker: "Илья",
        startedAtMs: 0,
        endedAtMs: 1000,
        text: "черновик",
      },
    ]);
    const [seg] = db.listTranscript(meeting.id);
    const res = await app.request(`/api/meetings/${meeting.id}/transcript`, {
      method: "PATCH",
      headers: {
        ...authHeaders(auth),
        "content-type": "application/json",
      },
      body: JSON.stringify({ segmentId: seg.id, text: "исправлено" }),
    });
    expect(res.status).toBe(200);
    expect(db.listTranscript(meeting.id)[0].text).toBe("исправлено");
  });

  it("PATCH склеивает группу и удаляет лишние фрагменты", async () => {
    ({ db, auth } = setupAuthedDb());
    const meeting = readyMeeting();
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
    const res = await app.request(`/api/meetings/${meeting.id}/transcript`, {
      method: "PATCH",
      headers: {
        ...authHeaders(auth),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        segmentId: keep.id,
        text: "первая вторая",
        dropSegmentIds: [drop.id],
      }),
    });
    expect(res.status).toBe(200);
    expect(db.listTranscript(meeting.id).map((row) => row.text)).toEqual([
      "первая вторая",
    ]);
  });

  it("POST summarize ставит задание без повторного join", async () => {
    ({ db, auth } = setupAuthedDb());
    const meeting = readyMeeting("/tmp/a.wav");
    db.saveTranscript(meeting.id, [
      {
        speaker: "Илья",
        startedAtMs: 0,
        endedAtMs: 1000,
        text: "Берём прототип",
      },
    ]);
    const res = await app.request(`/api/meetings/${meeting.id}/summarize`, {
      method: "POST",
      headers: authHeaders(auth),
    });
    expect(res.status).toBe(202);
    expect(db.getMeeting(meeting.id)?.status).toBe("summarizing");
    expect(
      db.listJobs().some((job) => job.type === "summarize" && job.status === "pending"),
    ).toBe(true);
  });

  it("summarize без расшифровки отвечает 409", async () => {
    ({ db, auth } = setupAuthedDb());
    const meeting = readyMeeting();
    const res = await app.request(`/api/meetings/${meeting.id}/summarize`, {
      method: "POST",
      headers: authHeaders(auth),
    });
    expect(res.status).toBe(409);
  });
});

