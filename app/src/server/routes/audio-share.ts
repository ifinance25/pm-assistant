import { createReadStream, existsSync, statSync } from "node:fs";
import { Readable } from "node:stream";
import { Hono } from "hono";
import { getDb } from "../../db/index.ts";
import { verifyAudioShareToken } from "../../shared/audio-share-token.ts";

const CONTENT_TYPES: Record<string, string> = {
  ".wav": "audio/wav",
  ".webm": "audio/webm",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
};

function contentType(path: string): string {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/**
 * Отдаёт запись встречи по одноразовой подписанной ссылке (фаза 6, Supadata):
 * без сессии и без Bearer APP_API_TOKEN — сам токен несёт meetingId, срок
 * действия и подпись (см. shared/audio-share-token.ts). Смонтирован вне
 * /api/public, у которого свой контракт (Bearer на всё).
 */
export const audioShareRouter = new Hono();

audioShareRouter.get("/:token", (c) => {
  const verified = verifyAudioShareToken(c.req.param("token"));
  if (!verified) {
    return c.json({ error: "ссылка недействительна или истекла" }, 401);
  }
  const meeting = getDb().getMeeting(verified.meetingId);
  if (!meeting?.audioPath || !existsSync(meeting.audioPath)) {
    return c.json({ error: "нет файла звука" }, 404);
  }
  const filePath = meeting.audioPath;
  const stat = statSync(filePath);
  const stream = createReadStream(filePath);
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": contentType(filePath),
      "Content-Length": String(stat.size),
      "Cache-Control": "no-store",
    },
  });
});
