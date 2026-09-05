import { existsSync as fsExistsSync } from "node:fs";
import {
  runCommand as defaultRunCommand,
  whichDocker as defaultWhichDocker,
  ZOOM_BOT_IMAGE_DEFAULT,
  ZOOM_BOT_ROLE_LABEL,
} from "../adapters/platform/zoom-bot.ts";
import { getDb } from "../db/index.ts";
import type { MeetingStatus } from "../shared/types.ts";
import { assertStatusTransition } from "../worker/status.ts";

const STUCK_MEETING_STATUSES: MeetingStatus[] = [
  "queued",
  "joining",
  "waiting_room",
  "recording",
  "transcribing",
  "summarizing",
];
const STUCK_JOB_STATUSES = new Set(["pending", "running"]);
export const MANUAL_RESTART_ERROR = "бот перезапущен вручную";
const WORKER_UNIT = "/etc/systemd/system/pm-assistant-worker.service";
const JOIN_PROCESS_PATTERN = "bot/zoom-web/join.mjs";
const WORKER_PROCESS_PATTERN = "src/worker/index.ts";

export type RunCommandFn = (
  command: string,
  args: string[],
  opts?: { timeoutMs?: number },
) => Promise<{ ok: boolean; stdout: string; stderr: string }>;

export type BotRestartDeps = {
  runCommand?: RunCommandFn;
  whichDocker?: () => string | null;
  existsSync?: (path: string) => boolean;
  zoomBotImage?: string;
};

export type BotRestartResult = {
  ok: true;
  meetingsCleared: number;
  jobsFailed: number;
  containersRemoved: number;
  leftoverProcessesKilled: boolean;
  workerRestarted: boolean;
  workerRestartMethod: "systemctl" | "pkill" | "skipped";
  details: string[];
};

let injected: BotRestartDeps = {};

export function setBotRestartDeps(deps: BotRestartDeps): void {
  injected = deps;
}

export function resetBotRestartDeps(): void {
  injected = {};
}

function resolvedDeps(override: BotRestartDeps = {}) {
  const merged = { ...injected, ...override };
  return {
    runCommand: merged.runCommand ?? defaultRunCommand,
    whichDocker: merged.whichDocker ?? defaultWhichDocker,
    existsSync: merged.existsSync ?? fsExistsSync,
    zoomBotImage:
      merged.zoomBotImage ||
      process.env.ZOOM_BOT_IMAGE?.trim() ||
      ZOOM_BOT_IMAGE_DEFAULT,
  };
}

function parseIds(stdout: string): string[] {
  return stdout
    .split(/\s+/)
    .map((id) => id.trim())
    .filter(Boolean);
}

async function removeZoomBotContainers(
  run: RunCommandFn,
  dockerBin: string,
  image: string,
  details: string[],
): Promise<number> {
  const filters = [`label=${ZOOM_BOT_ROLE_LABEL}`, `ancestor=${image}`];
  if (image !== ZOOM_BOT_IMAGE_DEFAULT) {
    filters.push(`ancestor=${ZOOM_BOT_IMAGE_DEFAULT}`);
  }
  const ids = new Set<string>();
  for (const filter of filters) {
    const listed = await run(dockerBin, ["ps", "-aq", "--filter", filter], {
      timeoutMs: 10_000,
    });
    if (!listed.ok && !listed.stdout.trim()) {
      details.push(
        `docker ps (${filter}): ${listed.stderr.trim() || "ошибка"}`,
      );
      continue;
    }
    for (const id of parseIds(listed.stdout)) {
      ids.add(id);
    }
  }
  if (ids.size === 0) {
    details.push("контейнеры Zoom-бота не найдены");
    return 0;
  }
  let removed = 0;
  for (const id of ids) {
    const rm = await run(dockerBin, ["rm", "-f", id], { timeoutMs: 20_000 });
    if (rm.ok) {
      removed += 1;
    } else {
      details.push(`docker rm ${id}: ${rm.stderr.trim() || "ошибка"}`);
    }
  }
  details.push(`снято контейнеров: ${removed}`);
  return removed;
}

function failStuckState(details: string[]): {
  meetingsCleared: number;
  jobsFailed: number;
} {
  const db = getDb();
  let meetingsCleared = 0;
  for (const meeting of db.listMeetings()) {
    if (!STUCK_MEETING_STATUSES.includes(meeting.status)) {
      continue;
    }
    assertStatusTransition(meeting.status, "error");
    db.updateMeetingStatus(meeting.id, "error", {
      error: MANUAL_RESTART_ERROR,
    });
    meetingsCleared += 1;
  }
  let jobsFailed = 0;
  for (const job of db.listJobs()) {
    if (!STUCK_JOB_STATUSES.has(job.status)) {
      continue;
    }
    db.failJob(job.id, MANUAL_RESTART_ERROR);
    jobsFailed += 1;
  }
  details.push(
    `встреч снято: ${meetingsCleared}, заданий: ${jobsFailed}`,
  );
  return { meetingsCleared, jobsFailed };
}

async function restartWorkerIfPresent(
  run: RunCommandFn,
  exists: (path: string) => boolean,
  details: string[],
): Promise<{
  workerRestarted: boolean;
  workerRestartMethod: BotRestartResult["workerRestartMethod"];
}> {
  if (!exists(WORKER_UNIT)) {
    details.push("воркер не перезапускали: нет юнита systemd");
    return { workerRestarted: false, workerRestartMethod: "skipped" };
  }
  const viaSystemctl = await run(
    "sudo",
    ["-n", "systemctl", "restart", "pm-assistant-worker"],
    { timeoutMs: 20_000 },
  );
  if (viaSystemctl.ok) {
    details.push("воркер перезапущен через systemctl");
    return { workerRestarted: true, workerRestartMethod: "systemctl" };
  }
  const viaPkill = await run(
    "pkill",
    ["-TERM", "-f", WORKER_PROCESS_PATTERN],
    { timeoutMs: 5_000 },
  );
  if (viaPkill.ok) {
    details.push(
      "воркеру отправлен SIGTERM, systemd Restart=always поднимет снова",
    );
    return { workerRestarted: true, workerRestartMethod: "pkill" };
  }
  details.push(
    `pkill воркера: ${viaPkill.stderr.trim() || "процесс не найден"}`,
  );
  return { workerRestarted: false, workerRestartMethod: "pkill" };
}

export async function restartBot(
  override: BotRestartDeps = {},
): Promise<BotRestartResult> {
  const details: string[] = [];
  const { runCommand, whichDocker, existsSync, zoomBotImage } =
    resolvedDeps(override);
  let containersRemoved = 0;
  const dockerBin = whichDocker();
  if (dockerBin) {
    try {
      containersRemoved = await removeZoomBotContainers(
        runCommand,
        dockerBin,
        zoomBotImage,
        details,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      details.push(`контейнеры: ${message}`);
    }
  } else {
    details.push("docker не найден, контейнеры пропущены");
  }

  const leftover = await runCommand(
    "pkill",
    ["-TERM", "-f", JOIN_PROCESS_PATTERN],
    { timeoutMs: 5_000 },
  );
  const leftoverProcessesKilled = leftover.ok;
  details.push(
    leftover.ok ? "сняты процессы join.mjs" : "процессы join.mjs не найдены",
  );

  const { meetingsCleared, jobsFailed } = failStuckState(details);
  const worker = await restartWorkerIfPresent(runCommand, existsSync, details);

  return {
    ok: true,
    meetingsCleared,
    jobsFailed,
    containersRemoved,
    leftoverProcessesKilled,
    workerRestarted: worker.workerRestarted,
    workerRestartMethod: worker.workerRestartMethod,
    details,
  };
}
