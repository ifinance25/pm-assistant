import { Hono } from "hono";
import { getDb } from "../../db/index.ts";
import type { RecordingMode, Settings, SettingsResponse } from "../../shared/types.ts";
import { isLlmProvider, isTrackerType } from "../../shared/types.ts";
import { assertPublicWebhookUrl } from "../../shared/webhook-url.ts";
import { upsertEnvVariable } from "../env-file.ts";
import type { AppEnv } from "../app-env.ts";

const RECORDING_MODES: RecordingMode[] = ["text", "local_audio", "full"];

function isRecordingMode(value: unknown): value is RecordingMode {
  return typeof value === "string" && RECORDING_MODES.includes(value as RecordingMode);
}

function withGoogleConfig(settings: Settings): SettingsResponse {
  return {
    ...settings,
    googleClientId: process.env.GOOGLE_CLIENT_ID?.trim() ?? "",
    googleClientSecretSet: Boolean(process.env.GOOGLE_CLIENT_SECRET?.trim()),
  };
}

/**
 * Google Client ID/Secret живут в .env, не в базе. Правила одни для обоих:
 * непустое новое значение пишем, совпадающее с текущим не трогаем, пустое при
 * пустом текущем считаем «не менять» (иначе ответ GET /api/settings нельзя
 * отправить обратно в PUT: там googleClientId пустой, пока ключ не задан),
 * а пустым значением стирать уже заданный ключ нельзя.
 */
function applyGoogleCredentials(body: Record<string, unknown>): string | null {
  const fields: Array<{ key: string; env: string; error: string }> = [
    {
      key: "googleClientId",
      env: "GOOGLE_CLIENT_ID",
      error: "нужен Google Client ID",
    },
    {
      key: "googleClientSecret",
      env: "GOOGLE_CLIENT_SECRET",
      error: "нужен Google Client Secret",
    },
  ];
  for (const field of fields) {
    if (!(field.key in body)) {
      continue;
    }
    const raw = body[field.key];
    if (typeof raw !== "string") {
      return field.error;
    }
    const next = raw.trim();
    const current = process.env[field.env]?.trim() ?? "";
    if (!next) {
      if (current) {
        return field.error;
      }
      continue;
    }
    if (next !== current) {
      upsertEnvVariable(field.env, next);
    }
  }
  return null;
}

export const settingsRouter = new Hono<AppEnv>();

settingsRouter.get("/settings", (c) => {
  return c.json(withGoogleConfig(getDb().getSettings()));
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
  if ("llmProvider" in body) {
    if (typeof body.llmProvider !== "string" || !isLlmProvider(body.llmProvider)) {
      return c.json({ error: "неизвестный провайдер LLM" }, 400);
    }
    patch.llmProvider = body.llmProvider;
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
  const googleCredentialError = applyGoogleCredentials(body);
  if (googleCredentialError) {
    return c.json({ error: googleCredentialError }, 400);
  }
  return c.json(withGoogleConfig(getDb().putSettings(patch)));
});
