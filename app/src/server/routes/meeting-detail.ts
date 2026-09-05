import { createReadStream, existsSync, rmSync, statSync } from "node:fs";
import { extname } from "node:path";
import { Readable } from "node:stream";
import { Hono } from "hono";
import { dispatchActionItems } from "../../adapters/asana/index.ts";
import { dispatchTrackerActionItems } from "../../adapters/tracker/index.ts";
import { askMeetingQuestion } from "../../adapters/llm/index.ts";
import { isLlmRateLimitError } from "../../adapters/llm/live.ts";
import { speechAudioPath } from "../../adapters/stt/trim-silence.ts";
import { buildTranscribeProgress } from "../../adapters/stt/whisper-progress.ts";
import { getDb } from "../../db/index.ts";
import { realtimeCaption, type MeetingDetail } from "../../shared/types.ts";
import { assertStatusTransition } from "../../worker/status.ts";
import type { AppEnv } from "../app-env.ts";

const AUDIO_TYPES: Record<string, string> = {
  ".wav": "audio/wav",
  ".webm": "audio/webm",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
};

function audioContentType(path: string): string {
  return AUDIO_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

function removeMeetingAudio(audioPath: string | null): void {
  if (!audioPath) {
    return;
  }
  const paths = new Set([audioPath, speechAudioPath(audioPath)]);
  for (const filePath of paths) {
    try {
      if (existsSync(filePath)) {
        rmSync(filePath, { force: true });
      }
    } catch {
      // файл мог исчезнуть между проверкой и удалением
    }
  }
}

export const meetingDetailRouter = new Hono<AppEnv>();

meetingDetailRouter.get("/:id", (c) => {
  const db = getDb();
  const id = c.req.param("id");
  const meeting = db.getMeetingForUser(id, c.get("userId"));
  if (!meeting) {
    return c.json({ error: "встреча не найдена" }, 404);
  }
  const transcript = db.listTranscript(id);
  const runningTranscribe = db
    .listJobsForMeeting(id)
    .find((job) => job.type === "transcribe" && job.status === "running");
  const body: MeetingDetail = {
    meeting,
    transcript,
    summary: db.getSummary(id),
    actionItems: db.listActionItems(id),
    realtime: {
      mode: meeting.source,
      caption: realtimeCaption(meeting.source),
    },
    transcribeProgress:
      meeting.status === "transcribing"
        ? buildTranscribeProgress({
            startedAt: runningTranscribe?.claimedAt ?? null,
            audioPath: meeting.audioPath,
            segments: transcript,
          })
        : null,
  };
  return c.json(body);
});

meetingDetailRouter.delete("/:id", (c) => {
  const db = getDb();
  const id = c.req.param("id");
  const meeting = db.getMeetingForUser(id, c.get("userId"));
  if (!meeting) {
    return c.json({ error: "встреча не найдена" }, 404);
  }
  removeMeetingAudio(meeting.audioPath);
  const deleted = db.deleteMeeting(id);
  if (!deleted) {
    return c.json({ error: "встреча не найдена" }, 404);
  }
  return c.json({ ok: true, id });
});

meetingDetailRouter.patch("/:id", async (c) => {
  const db = getDb();
  const id = c.req.param("id");
  const meeting = db.getMeetingForUser(id, c.get("userId"));
  if (!meeting) {
    return c.json({ error: "встреча не найдена" }, 404);
  }
  let body: { title?: unknown; projectId?: unknown };
  try {
    body = (await c.req.json()) as { title?: unknown; projectId?: unknown };
  } catch {
    return c.json({ error: "нужен JSON" }, 400);
  }
  const hasTitle = typeof body.title === "string";
  const hasProjectId = typeof body.projectId === "string";
  if (!hasTitle && !hasProjectId) {
    return c.json({ error: "нужен title или projectId" }, 400);
  }

  let updated = meeting;
  if (hasTitle) {
    const next = db.updateMeetingTitle(id, body.title as string);
    if (!next) {
      return c.json({ error: "встреча не найдена" }, 404);
    }
    updated = next;
  }
  if (hasProjectId) {
    const next = db.updateMeetingProject(id, (body.projectId as string).trim());
    if (!next) {
      return c.json({ error: "проект не найден" }, 400);
    }
    updated = next;
  }
  return c.json({ meeting: updated });
});

meetingDetailRouter.patch("/:id/transcript", async (c) => {
  const db = getDb();
  const id = c.req.param("id");
  const meeting = db.getMeetingForUser(id, c.get("userId"));
  if (!meeting) {
    return c.json({ error: "встреча не найдена" }, 404);
  }
  let body: { segmentId?: unknown; text?: unknown; dropSegmentIds?: unknown };
  try {
    body = (await c.req.json()) as {
      segmentId?: unknown;
      text?: unknown;
      dropSegmentIds?: unknown;
    };
  } catch {
    return c.json({ error: "нужен JSON" }, 400);
  }
  const segmentId = typeof body.segmentId === "string" ? body.segmentId.trim() : "";
  if (!segmentId) {
    return c.json({ error: "нужен segmentId" }, 400);
  }
  if (typeof body.text !== "string") {
    return c.json({ error: "нужен text" }, 400);
  }
  const segment = db.updateTranscriptSegment(id, segmentId, body.text);
  if (!segment) {
    return c.json({ error: "фрагмент не найден" }, 404);
  }
  const dropSegmentIds = Array.isArray(body.dropSegmentIds)
    ? body.dropSegmentIds.filter(
        (value): value is string =>
          typeof value === "string" &&
          value.trim() !== "" &&
          value !== segmentId,
      )
    : [];
  if (dropSegmentIds.length > 0) {
    db.removeTranscriptSegments(id, dropSegmentIds);
  }
  return c.json({ segment, transcript: db.listTranscript(id) });
});

meetingDetailRouter.post("/:id/summarize", (c) => {
  const db = getDb();
  const id = c.req.param("id");
  const meeting = db.getMeetingForUser(id, c.get("userId"));
  if (!meeting) {
    return c.json({ error: "встреча не найдена" }, 404);
  }
  if (db.listTranscript(id).length === 0) {
    return c.json({ error: "нет расшифровки для саммари" }, 409);
  }
  const allowed = new Set(["ready", "error", "summarizing"]);
  if (!allowed.has(meeting.status)) {
    return c.json(
      { error: `саммари нельзя запустить из статуса ${meeting.status}` },
      409,
    );
  }
  if (db.hasActiveJob(id, "summarize") || db.hasActiveJob(id, "transcribe")) {
    return c.json({ error: "уже идёт обработка" }, 409);
  }
  let current = meeting;
  if (meeting.status !== "summarizing") {
    assertStatusTransition(meeting.status, "summarizing");
    current = db.updateMeetingStatus(id, "summarizing", { error: null });
  }
  const job = db.enqueueJob({ meetingId: id, type: "summarize" });
  return c.json({ meeting: current, job }, 202);
});

meetingDetailRouter.get("/:id/audio", (c) => {
  const db = getDb();
  const id = c.req.param("id");
  const meeting = db.getMeetingForUser(id, c.get("userId"));
  if (!meeting?.audioPath || !existsSync(meeting.audioPath)) {
    return c.json({ error: "нет файла звука" }, 404);
  }
  const filePath = meeting.audioPath;
  const stat = statSync(filePath);
  const total = stat.size;
  const type = audioContentType(filePath);
  const range = c.req.header("range");
  if (range) {
    const match = /^bytes=(\d+)-(\d+)?$/.exec(range);
    if (match) {
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : total - 1;
      const chunkSize = end - start + 1;
      const stream = createReadStream(filePath, { start, end });
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 206,
        headers: {
          "Content-Type": type,
          "Content-Range": `bytes ${start}-${end}/${total}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(chunkSize),
        },
      });
    }
  }
  const stream = createReadStream(filePath);
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": type,
      "Content-Length": String(total),
      "Accept-Ranges": "bytes",
    },
  });
});

meetingDetailRouter.post("/:id/retry", (c) => {
  const db = getDb();
  const id = c.req.param("id");
  const meeting = db.getMeetingForUser(id, c.get("userId"));
  if (!meeting) {
    return c.json({ error: "встреча не найдена" }, 404);
  }
  if (meeting.status !== "error") {
    return c.json({ error: "повторить можно после ошибки" }, 409);
  }
  if (meeting.audioPath) {
    for (const job of db.listJobsForMeeting(id)) {
      if (
        job.meetingId === id &&
        job.type === "join" &&
        (job.status === "pending" || job.status === "running")
      ) {
        db.failJob(job.id, "есть файл звука: повторный вход не нужен");
      }
    }
    const existing = db
      .listJobsForMeeting(id)
      .find(
        (job) =>
          job.type === "transcribe" &&
          (job.status === "pending" || job.status === "running"),
      );
    const job =
      existing ?? db.enqueueJob({ meetingId: id, type: "transcribe" });
    return c.json({ meeting, job }, 202);
  }
  const updated = db.updateMeetingStatus(id, "queued", { error: null });
  db.enqueueJob({ meetingId: id, type: "join" });
  return c.json({ meeting: updated });
});

meetingDetailRouter.post("/:id/transcribe", (c) => {
  const db = getDb();
  const id = c.req.param("id");
  const meeting = db.getMeetingForUser(id, c.get("userId"));
  if (!meeting) {
    return c.json({ error: "встреча не найдена" }, 404);
  }
  if (!meeting.audioPath) {
    return c.json({ error: "нет файла звука" }, 409);
  }
  const allowed = new Set([
    "ready",
    "error",
    "recording",
    "joining",
    "waiting_room",
    "queued",
    "summarizing",
    "transcribing",
  ]);
  if (!allowed.has(meeting.status)) {
    return c.json(
      { error: `расшифровку нельзя запустить из статуса ${meeting.status}` },
      409,
    );
  }
  for (const job of db.listJobsForMeeting(id)) {
    if (
      job.meetingId === id &&
      job.type === "join" &&
      (job.status === "pending" || job.status === "running")
    ) {
      db.failJob(job.id, "есть файл звука: повторный вход не нужен");
    }
  }
  const existing = db
    .listJobsForMeeting(id)
    .find(
      (job) =>
        job.type === "transcribe" &&
        (job.status === "pending" || job.status === "running"),
    );
  const job =
    existing ?? db.enqueueJob({ meetingId: id, type: "transcribe" });
  return c.json({ meeting, job }, 202);
});

meetingDetailRouter.post("/:id/asana-queue", async (c) => {
  const db = getDb();
  const id = c.req.param("id");
  const meeting = db.getMeetingForUser(id, c.get("userId"));
  if (!meeting) {
    return c.json({ error: "встреча не найдена" }, 404);
  }

  let ids: string[] | undefined;
  const contentType = c.req.header("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await c.req.json()) as { ids?: string[] };
    if (Array.isArray(body.ids)) {
      ids = body.ids;
    }
  }

  const items = db.listActionItems(id);
  const toQueue = ids
    ? items.filter((item) => ids.includes(item.id))
    : items.filter((item) => item.asanaState === "none");
  const asana = await dispatchActionItems(db, toQueue);

  return c.json({ actionItems: db.listActionItems(id), asana });
});

meetingDetailRouter.post("/:id/tracker-create-tasks", async (c) => {
  const db = getDb();
  const id = c.req.param("id");
  const meeting = db.getMeetingForUser(id, c.get("userId"));
  if (!meeting) {
    return c.json({ error: "встреча не найдена" }, 404);
  }

  let ids: string[] | undefined;
  const contentType = c.req.header("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await c.req.json()) as { ids?: string[] };
    if (Array.isArray(body.ids)) {
      ids = body.ids;
    }
  }

  const settings = db.getSettings();
  const items = db.listActionItems(id);
  const toQueue = ids
    ? items.filter((item) => ids.includes(item.id))
    : items.filter((item) => item.trackerState === "none");
  const tracker = await dispatchTrackerActionItems(
    db,
    toQueue,
    settings.trackerType,
  );

  return c.json({ actionItems: db.listActionItems(id), tracker });
});

meetingDetailRouter.post("/:id/ask", async (c) => {
  const db = getDb();
  const id = c.req.param("id");
  const meeting = db.getMeetingForUser(id, c.get("userId"));
  if (!meeting) {
    return c.json({ error: "встреча не найдена" }, 404);
  }
  const body = (await c.req.json()) as { question?: string };
  const question = body.question?.trim() ?? "";
  if (!question) {
    return c.json({ error: "нужен question" }, 400);
  }

  const transcript = db.listTranscript(id);
  if (transcript.length === 0) {
    return c.json(
      { error: "расшифровка ещё не готова, задайте вопрос после готовности встречи" },
      409,
    );
  }

  let epicKey: string | null = null;
  if (meeting.projectId) {
    const project = db.getProject(meeting.projectId);
    epicKey = project?.trackerParentRef || null;
  }

  try {
    const answer = await askMeetingQuestion({
      meetingTitle: meeting.title,
      transcript,
      summary: db.getSummary(id),
      actionItems: db.listActionItems(id).map((item) => ({
        title: item.title,
        assignee: item.assignee,
      })),
      epicKey,
      question,
    });
    return c.json({ question, answer });
  } catch (err) {
    if (isLlmRateLimitError(err)) {
      return c.json({
        question,
        answer: "Сейчас превышен лимит LLM. Попробуйте позже.",
      });
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`ask: ${message}`);
    return c.json({
      question,
      answer: "Не удалось получить ответ. Попробуйте позже.",
    });
  }
});
