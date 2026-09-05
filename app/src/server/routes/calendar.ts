import { Hono } from "hono";
import { getDb } from "../../db/index.ts";
import {
  extractConferenceUrl,
  listUpcomingEvents,
  refreshAccessToken,
} from "../../adapters/calendar/google.ts";
import { detectPlatform } from "../../adapters/platform/detect.ts";
import type { CalendarEvent, CalendarFeed } from "../../shared/types.ts";
import type { AppEnv } from "../app-env.ts";

const PROVIDER = "google_calendar";
const REFRESH_MARGIN_MS = 60_000;

function readGoogleCalendarConfig() {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID?.trim() ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim() ?? "",
  };
}

function disconnectedFeed(): CalendarFeed {
  return { connected: false, account: null, expired: false, events: [] };
}

function expiredFeed(account: string | null): CalendarFeed {
  return { connected: false, account, expired: true, events: [] };
}

export const calendarRouter = new Hono<AppEnv>();

calendarRouter.get("/events", async (c) => {
  const db = getDb();
  const token = db.getIntegrationToken(PROVIDER);
  if (!token || !db.isIntegrationConnected(PROVIDER)) {
    return c.json(disconnectedFeed());
  }
  const account = typeof token.meta.email === "string" ? token.meta.email : null;

  let accessToken = token.accessToken;
  const expiresAtMs = token.expiresAt ? Date.parse(token.expiresAt) : Number.NaN;
  const needsRefresh =
    !Number.isFinite(expiresAtMs) || expiresAtMs - Date.now() < REFRESH_MARGIN_MS;

  if (needsRefresh) {
    const { clientId, clientSecret } = readGoogleCalendarConfig();
    const refreshed = token.refreshToken && clientId && clientSecret
      ? await refreshAccessToken(token.refreshToken, { clientId, clientSecret })
      : null;
    if (!refreshed) {
      db.deleteIntegrationToken(PROVIDER);
      return c.json(expiredFeed(account));
    }
    accessToken = refreshed.accessToken;
    db.upsertIntegrationToken(PROVIDER, {
      accessToken: refreshed.accessToken,
      refreshToken: token.refreshToken,
      expiresAt: refreshed.expiresAt,
      meta: token.meta,
    });
  }

  let rawEvents: Awaited<ReturnType<typeof listUpcomingEvents>>;
  try {
    rawEvents = await listUpcomingEvents(accessToken);
  } catch (err) {
    console.error("не удалось получить события Google Календаря:", err);
    return c.json({ connected: true, account, expired: false, events: [] } satisfies CalendarFeed);
  }

  const meetings = db.listMeetings();
  const events: CalendarEvent[] = [];
  for (const raw of rawEvents) {
    const url = extractConferenceUrl(raw);
    if (!url) {
      continue;
    }
    const platform = detectPlatform(url);
    if (!platform) {
      continue;
    }
    const startsAt = raw.start?.dateTime ?? raw.start?.date;
    if (!startsAt) {
      continue;
    }
    const matched = meetings.find((meeting) => meeting.url === url) ?? null;
    events.push({
      id: raw.id,
      title: raw.summary?.trim() || "Без названия",
      startsAt,
      endsAt: raw.end?.dateTime ?? raw.end?.date ?? null,
      url,
      platform,
      supported: platform === "zoom",
      meetingId: matched?.id ?? null,
      meetingStatus: matched?.status ?? null,
    });
  }
  events.sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  return c.json({ connected: true, account, expired: false, events } satisfies CalendarFeed);
});
