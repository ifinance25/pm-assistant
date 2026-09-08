import { existsSync, statSync } from "node:fs";
import { Hono } from "hono";
import { detectPlatform } from "../../adapters/platform/index.ts";
import {
  MEET_NOT_IMPLEMENTED,
  TELEMOST_NOT_IMPLEMENTED,
} from "../../adapters/platform/join.ts";
import { getDb } from "../../db/index.ts";
import type { Meeting, MeetingStatus } from "../../shared/types.ts";
import type { AppEnv } from "../app-env.ts";

const IN_PROGRESS: MeetingStatus[] = [
  "queued",
  "joining",
  "waiting_room",
  "recording",
];

export const meetingsRouter = new Hono<AppEnv>();

export { detectPlatform };

function storageStats(meetings: Meeting[]) {
  let usedBytes = 0;
  for (const meeting of meetings) {
    if (!meeting.audioPath) {
      continue;
    }
    try {
      if (existsSync(meeting.audioPath)) {
        usedBytes += statSync(meeting.audioPath).size;
      }
    } catch {
      // файл мог исчезнуть между проверкой и stat
    }
  }
  return { meetingCount: meetings.length, usedBytes };
}

meetingsRouter.get("/", (c) => {
  const db = getDb();
  const meetings = db.listMeetingsForUser(c.get("userId"));
  const headlines = db.listHeadlines();
  return c.json({
    meetings: meetings.map((meeting) => ({
      ...meeting,
      headline: headlines[meeting.id] ?? null,
    })),
    storage: storageStats(meetings),
  });
});

meetingsRouter.post("/", async (c) => {
  let body: { url?: unknown; projectId?: unknown; title?: unknown };
  try {
    body = (await c.req.json()) as {
      url?: unknown;
      projectId?: unknown;
      title?: unknown;
    };
  } catch {
    return c.json({ error: "Вставьте ссылку на встречу" }, 400);
  }
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim() || null : null;
  if (!url) {
    return c.json({ error: "Вставьте ссылку на встречу" }, 400);
  }
  const projectId =
    typeof body.projectId === "string" ? body.projectId.trim() : "";
  if (!projectId) {
    return c.json({ error: "выберите проект" }, 400);
  }
  const platform = detectPlatform(url);
  if (!platform) {
    return c.json(
      { error: "Ссылка не похожа на Zoom, Google Meet или Телемост" },
      400,
    );
  }
  if (platform === "meet") {
    return c.json({ error: MEET_NOT_IMPLEMENTED }, 503);
  }
  if (platform === "telemost") {
    return c.json({ error: TELEMOST_NOT_IMPLEMENTED }, 503);
  }
  const db = getDb();
  if (!db.getProject(projectId)) {
    return c.json({ error: "проект не найден" }, 400);
  }
  const ownerUserId = c.get("userId");
  const existing = db.listMeetingsForUser(ownerUserId).find(
    (meeting) => meeting.url === url && IN_PROGRESS.includes(meeting.status),
  );
  if (existing) {
    return c.json({ meeting: existing, alreadyRunning: true }, 200);
  }
  const settings = db.getSettings();
  const meeting = db.createMeeting({
    url,
    title,
    platform,
    recordingMode: settings.recordingModeDefault,
    source: "stub",
    projectId,
    ownerUserId,
  });
  db.enqueueJob({ meetingId: meeting.id, type: "join" });
  return c.json({ meeting, alreadyRunning: false }, 201);
});
