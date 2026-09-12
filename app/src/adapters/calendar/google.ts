import { fetchWithTimeout } from "../../shared/http-timeout.ts";
import { detectPlatform } from "../platform/detect.ts";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const EVENTS_ENDPOINT =
  "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_TOKEN_TTL_SEC = 3600;

export type GoogleCalendarEvent = {
  id: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  conferenceData?: {
    entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
  };
  hangoutLink?: string;
  location?: string;
  description?: string;
};

export type RefreshedToken = {
  accessToken: string;
  expiresAt: string;
};

function findUrlsInText(text: string): string[] {
  const matches = text.match(/https?:\/\/\S+/g) ?? [];
  return matches.map((match) => match.replace(/[),.;>\]]+$/, ""));
}

/**
 * Ищет ссылку на видеозвонок в событии по фиксированному порядку источников:
 * conferenceData -> hangoutLink -> location -> description. Возвращает первую
 * ссылку, распознанную detectPlatform (zoom / meet / telemost).
 */
export function extractConferenceUrl(event: GoogleCalendarEvent): string | null {
  const candidates: string[] = [];
  for (const entryPoint of event.conferenceData?.entryPoints ?? []) {
    if (entryPoint.uri) {
      candidates.push(entryPoint.uri);
    }
  }
  if (event.hangoutLink) {
    candidates.push(event.hangoutLink);
  }
  if (event.location) {
    candidates.push(...findUrlsInText(event.location));
  }
  if (event.description) {
    candidates.push(...findUrlsInText(event.description));
  }
  for (const url of candidates) {
    if (detectPlatform(url)) {
      return url;
    }
  }
  return null;
}

/**
 * Обновляет access-токен по refresh-токену. Возвращает null при сетевой
 * ошибке или отказе Google (истёкший/отозванный refresh-токен) — вызывающий
 * код в этом случае удаляет токен и помечает подключение истёкшим.
 */
export async function refreshAccessToken(
  refreshToken: string,
  config: { clientId: string; clientSecret: string },
): Promise<RefreshedToken | null> {
  try {
    const res = await fetchWithTimeout(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) {
      return null;
    }
    const body = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!body.access_token) {
      return null;
    }
    const ttlSec =
      typeof body.expires_in === "number" ? body.expires_in : DEFAULT_TOKEN_TTL_SEC;
    return {
      accessToken: body.access_token,
      expiresAt: new Date(Date.now() + ttlSec * 1000).toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Возвращает события из основного календаря пользователя за заданный
 * диапазон (по умолчанию — ближайшие 7 дней от сейчас), отсортированные по
 * времени начала (singleEvents=true разворачивает повторяющиеся встречи в
 * отдельные события). Бросает исключение при сбое запроса — вызывающий код
 * логирует и отдаёт пустой список.
 */
export async function listUpcomingEvents(
  accessToken: string,
  range: { timeMin?: Date; timeMax?: Date } = {},
): Promise<GoogleCalendarEvent[]> {
  const timeMin = range.timeMin ?? new Date();
  const timeMax = range.timeMax ?? new Date(timeMin.getTime() + WEEK_MS);
  const params = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
  });
  const res = await fetchWithTimeout(`${EVENTS_ENDPOINT}?${params}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Google Calendar API ответил ${res.status}`);
  }
  const body = (await res.json()) as { items?: GoogleCalendarEvent[] };
  return body.items ?? [];
}
