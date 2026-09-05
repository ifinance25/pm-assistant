import { Hono } from "hono";
import { getDb } from "../../db/index.ts";
import type { HealthResponse } from "../../shared/types.ts";

const WORKER_ALIVE_MS = 15_000;

export const healthRouter = new Hono();

healthRouter.get("/health", (c) => {
  const settings = getDb().getSettings();
  const heartbeat = settings.workerHeartbeatAt;
  const ts = heartbeat ? Date.parse(heartbeat) : NaN;
  const workerAlive = Number.isFinite(ts) && Date.now() - ts < WORKER_ALIVE_MS;
  const body: HealthResponse = {
    ok: true,
    workerAlive,
    workerHeartbeatAt: heartbeat || null,
  };
  return c.json(body);
});
