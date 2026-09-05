import { Hono } from "hono";
import { restartBot } from "../bot-restart.ts";
import type { AppEnv } from "../app-env.ts";

export const botRouter = new Hono<AppEnv>();

botRouter.post("/bot/restart", async (c) => {
  if (c.get("userRole") !== "admin") {
    return c.json({ error: "нужны права администратора" }, 403);
  }
  let confirm = false;
  try {
    const body = (await c.req.json()) as { confirm?: unknown };
    confirm = body.confirm === true;
  } catch {
    confirm = false;
  }
  if (!confirm) {
    return c.json({ error: "нужно подтверждение" }, 400);
  }
  try {
    return c.json(await restartBot());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Не удалось перезапустить бота: ${message}` }, 500);
  }
});
