import { Hono } from "hono";
import { getDb } from "../../db/index.ts";
import { isTrackerType } from "../../shared/types.ts";
import type { AppEnv } from "../app-env.ts";

export const integrationsRouter = new Hono<AppEnv>();

function trackerProvider(type: string): string {
  return `tracker:${type}`;
}

const STUB_NOTICE = "заглушка: OAuth не настроен";

integrationsRouter.get("/tracker/:type/start", (c) => {
  const type = c.req.param("type");
  if (!isTrackerType(type)) {
    return c.json({ error: "неизвестный трекер" }, 400);
  }
  return c.json({
    ok: true,
    provider: trackerProvider(type),
    connected: false,
    stub: true,
    notice: STUB_NOTICE,
  });
});

integrationsRouter.get("/tracker/:type/callback", (c) => {
  const type = c.req.param("type");
  if (!isTrackerType(type)) {
    return c.json({ error: "неизвестный трекер" }, 400);
  }
  return c.redirect("/settings#integrations");
});

integrationsRouter.delete("/tracker/:type", (c) => {
  const type = c.req.param("type");
  if (!isTrackerType(type)) {
    return c.json({ error: "неизвестный трекер" }, 400);
  }
  getDb().deleteIntegrationToken(trackerProvider(type));
  return c.json({ ok: true, connected: false });
});

integrationsRouter.get("/google-calendar/start", (c) => {
  return c.json({
    ok: true,
    provider: "google_calendar",
    connected: false,
    stub: true,
    notice: "заглушка: Google Календарь не подключён",
  });
});

integrationsRouter.delete("/google-calendar", (c) => {
  getDb().deleteIntegrationToken("google_calendar");
  return c.json({ ok: true, connected: false });
});
