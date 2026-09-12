import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Временная подписанная ссылка на wav встречи — для внешнего движка STT
 * (Supadata, фаза 6 плана качества), которому нужен публично доступный URL.
 * Ключ подписи — APP_API_TOKEN (единственный секрет приложения); без него
 * ссылки не выпускаются, как и /api/public с пустым APP_API_TOKEN.
 * 15 минут — выбор из спеки (artifacts/2026-09-06-remaining-quality-phases.md,
 * фаза 6), не общий срок, а именно узкое окно на один внешний запрос.
 */
export const AUDIO_SHARE_TOKEN_TTL_MS = 15 * 60 * 1000;

function secret(): string {
  return (process.env.APP_API_TOKEN ?? "").trim();
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("hex");
}

export function createAudioShareToken(
  meetingId: string,
  now = Date.now(),
  ttlMs = AUDIO_SHARE_TOKEN_TTL_MS,
): string | null {
  const key = secret();
  if (!key || !meetingId) {
    return null;
  }
  const expiresAt = now + ttlMs;
  const payload = `${meetingId}.${expiresAt}`;
  return Buffer.from(`${payload}.${sign(payload, key)}`, "utf8").toString(
    "base64url",
  );
}

export function verifyAudioShareToken(
  token: string,
  now = Date.now(),
): { meetingId: string } | null {
  const key = secret();
  if (!key || !token) {
    return null;
  }
  let decoded: string;
  try {
    decoded = Buffer.from(token, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const parts = decoded.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const [meetingId, expiresAtRaw, signature] = parts;
  const expiresAt = Number(expiresAtRaw);
  if (!meetingId || !Number.isFinite(expiresAt)) {
    return null;
  }
  const expected = sign(`${meetingId}.${expiresAtRaw}`, key);
  const given = Buffer.from(signature, "utf8");
  const wanted = Buffer.from(expected, "utf8");
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
    return null;
  }
  if (now > expiresAt) {
    return null;
  }
  return { meetingId };
}
