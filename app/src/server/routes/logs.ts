import { existsSync as fsExistsSync } from "node:fs";
import { Hono } from "hono";
import { runCommand as defaultRunCommand } from "../../adapters/platform/zoom-bot.ts";
import type { AppEnv } from "../app-env.ts";

const WORKER_UNIT = "/etc/systemd/system/pm-assistant-worker.service";
const LOG_LINES = 500;

export type LogsRunCommandFn = (
  command: string,
  args: string[],
  opts?: { timeoutMs?: number },
) => Promise<{ ok: boolean; stdout: string; stderr: string }>;

export type LogsDeps = {
  runCommand?: LogsRunCommandFn;
  existsSync?: (path: string) => boolean;
};

let injected: LogsDeps = {};

export function setLogsDeps(deps: LogsDeps): void {
  injected = deps;
}

export function resetLogsDeps(): void {
  injected = {};
}

export const logsRouter = new Hono<AppEnv>();

logsRouter.get("/logs", async (c) => {
  if (c.get("userRole") !== "admin") {
    return c.json({ error: "нужны права администратора" }, 403);
  }
  const runCommand = injected.runCommand ?? defaultRunCommand;
  const existsSync = injected.existsSync ?? fsExistsSync;

  if (!existsSync(WORKER_UNIT)) {
    return c.json({ ok: false, reason: "no-systemd" });
  }

  const result = await runCommand(
    "journalctl",
    [
      "-u",
      "pm-assistant-api",
      "-u",
      "pm-assistant-worker",
      "-n",
      String(LOG_LINES),
      "--no-pager",
    ],
    { timeoutMs: 10_000 },
  );
  if (!result.ok) {
    return c.json({
      ok: false,
      reason: "command-failed",
      detail: result.stderr.trim() || "journalctl завершился с ошибкой",
    });
  }
  return c.json({ ok: true, text: result.stdout });
});
