import { Hono } from "hono";
import { getDb } from "../../db/index.ts";

export function resolveAppApiToken(explicit?: string | null): string {
  const raw = explicit !== undefined ? explicit : process.env.APP_API_TOKEN;
  return raw?.trim() ?? "";
}

function readRequestToken(header: string | undefined): string {
  if (!header) {
    return "";
  }
  const trimmed = header.trim();
  if (trimmed.toLowerCase().startsWith("bearer ")) {
    return trimmed.slice(7).trim();
  }
  return trimmed;
}

export const publicApiRouter = new Hono();

publicApiRouter.use("*", async (c, next) => {
  const expected = resolveAppApiToken();
  const given = readRequestToken(c.req.header("authorization"));
  if (!expected || given !== expected) {
    return c.json({ error: "нужен токен приложения" }, 401);
  }
  await next();
});

publicApiRouter.get("/meetings", (c) => {
  const meetings = getDb().listMeetings();
  return c.json({ meetings });
});

publicApiRouter.get("/meetings/:id", (c) => {
  const meeting = getDb().getMeeting(c.req.param("id"));
  if (!meeting) {
    return c.json({ error: "встреча не найдена" }, 404);
  }
  return c.json({ meeting });
});
