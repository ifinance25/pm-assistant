import { Hono } from "hono";
import { getDb } from "../../db/index.ts";
import type { RecordingMode, Settings } from "../../shared/types.ts";
import { isTrackerType } from "../../shared/types.ts";
import { assertPublicWebhookUrl } from "../../shared/webhook-url.ts";
import type { AppEnv } from "../app-env.ts";

const RECORDING_MODES: RecordingMode[] = ["text", "local_audio", "full"];

function isRecordingMode(value: unknown): value is RecordingMode {
  return typeof value === "string" && RECORDING_MODES.includes(value as RecordingMode);
}

export const settingsRouter = new Hono<AppEnv>();

settingsRouter.get("/settings", (c) => {
  return c.json(getDb().getSettings());
});

settingsRouter.put("/settings", async (c) => {
  if (c.get("userRole") !== "admin") {
    return c.json({ error: "нужны права администратора" }, 403);
  }
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: "нужен JSON" }, 400);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return c.json({ error: "нужен объект настроек" }, 400);
  }
  const body = raw as Record<string, unknown>;
  const patch: Partial<Settings> = {};
  if ("recordingModeDefault" in body) {
    if (!isRecordingMode(body.recordingModeDefault)) {
      return c.json({ error: "неизвестный режим записи" }, 400);
    }
    patch.recordingModeDefault = body.recordingModeDefault;
  }
  if ("trackerType" in body) {
    if (typeof body.trackerType !== "string" || !isTrackerType(body.trackerType)) {
      return c.json({ error: "неизвестный трекер" }, 400);
    }
    patch.trackerType = body.trackerType;
  }
  if ("asanaProjectLabel" in body) {
    if (typeof body.asanaProjectLabel !== "string") {
      return c.json({ error: "некорректная метка проекта" }, 400);
    }
    patch.asanaProjectLabel = body.asanaProjectLabel;
  }
  if ("asanaAutoSend" in body) {
    if (typeof body.asanaAutoSend !== "boolean") {
      return c.json({ error: "asanaAutoSend должен быть boolean" }, 400);
    }
    patch.asanaAutoSend = body.asanaAutoSend;
  }
  if ("webhookUrl" in body) {
    if (typeof body.webhookUrl !== "string") {
      return c.json({ error: "некорректный URL вебхука" }, 400);
    }
    try {
      patch.webhookUrl = assertPublicWebhookUrl(body.webhookUrl);
    } catch (err) {
      const message = err instanceof Error ? err.message : "некорректный URL вебхука";
      return c.json({ error: message }, 400);
    }
  }
  return c.json(getDb().putSettings(patch));
});
