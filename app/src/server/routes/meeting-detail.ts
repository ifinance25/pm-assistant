import { createReadStream, existsSync, statSync } from "node:fs";
import { extname } from "node:path";
import { Readable } from "node:stream";
import { Hono } from "hono";
import { dispatchActionItems } from "../../adapters/asana/index.ts";
import { dispatchTrackerActionItems } from "../../adapters/tracker/index.ts";
import { getDb } from "../../db/index.ts";
import { realtimeCaption, type MeetingDetail } from "../../shared/types.ts";
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

export const meetingDetailRouter = new Hono<AppEnv>();

meetingDetailRouter.get("/:id", (c) => {
  const db = getDb();
  const id = c.req.param("id");
  const meeting = db.getMeetingForUser(id, c.get("userId"));
  if (!meeting) {
    return c.json({ error: "встреча не найдена" }, 404);
  }
  const body: MeetingDetail = {
    meeting,
    transcript: db.listTranscript(id),
    summary: db.getSummary(id),
    actionItems: db.listActionItems(id),
    realtime: {
      mode: meeting.source,
      caption: realtimeCaption(meeting.source),
    },
  };
  return c.json(body);
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
    const job = db.enqueueJob({ meetingId: id, type: "transcribe" });
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
  const job = db.enqueueJob({ meetingId: id, type: "transcribe" });
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

function stubAskAnswer(question: string, epicKey: string | null): string {
  const lower = question.toLowerCase();
  if (lower.includes("epic") || lower.includes("эпик")) {
    return epicKey
      ? `Epic этой встречи: ${epicKey}. Подробности в карточке проекта.`
      : "Epic для проекта встречи не задан. Укажите родительский ref в Настройках.";
  }
  if (lower.includes("решен")) {
    return "Краткие решения смотрите в блоке «Решения» справа.";
  }
  if (lower.includes("задач")) {
    return "Список задач из встречи в блоке «Задачи из встречи» справа.";
  }
  return "Скоро: ответ по контексту встречи. Пока смотрите резюме и транскрипт.";
}

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
  let epicKey: string | null = null;
  if (meeting.projectId) {
    const project = db.getProject(meeting.projectId);
    epicKey = project?.trackerParentRef || null;
  }
  return c.json({
    question,
    answer: stubAskAnswer(question, epicKey),
  });
});
