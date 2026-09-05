import { afterEach, describe, expect, it } from "vitest";
import {
  ZOOM_BOT_IMAGE_DEFAULT,
  ZOOM_BOT_ROLE_LABEL,
} from "../adapters/platform/zoom-bot.ts";
import { createDb, setDb } from "../db/index.ts";
import {
  MANUAL_RESTART_ERROR,
  resetBotRestartDeps,
  restartBot,
  type RunCommandFn,
} from "./bot-restart.ts";

const WORKER_UNIT = "/etc/systemd/system/pm-assistant-worker.service";

describe("restartBot", () => {
  let db: ReturnType<typeof createDb>;
  const calls: { command: string; args: string[] }[] = [];

  afterEach(() => {
    resetBotRestartDeps();
    db?.close();
    calls.length = 0;
  });

  function mockRun(options?: {
    dockerIds?: string;
    sudoOk?: boolean;
    pkillJoinOk?: boolean;
    pkillWorkerOk?: boolean;
  }): RunCommandFn {
    return async (command, args) => {
      calls.push({ command, args });
      if (args[0] === "ps") {
        return { ok: true, stdout: options?.dockerIds ?? "", stderr: "" };
      }
      if (args[0] === "rm") {
        return { ok: true, stdout: "", stderr: "" };
      }
      if (command === "sudo") {
        return {
          ok: options?.sudoOk ?? false,
          stdout: "",
          stderr: options?.sudoOk ? "" : "sudo: a password is required",
        };
      }
      if (command === "pkill" && args.includes("bot/zoom-web/join.mjs")) {
        return {
          ok: options?.pkillJoinOk ?? false,
          stdout: "",
          stderr: "",
        };
      }
      if (command === "pkill" && args.includes("src/worker/index.ts")) {
        return {
          ok: options?.pkillWorkerOk ?? false,
          stdout: "",
          stderr: options?.pkillWorkerOk ? "" : "процесс не найден",
        };
      }
      return { ok: true, stdout: "", stderr: "" };
    };
  }

  it("снимает контейнеры по label и ancestor, не трогает воркер без systemd", async () => {
    db = createDb(":memory:");
    setDb(db);
    const meeting = db.createMeeting({ url: "https://zoom.us/j/111" });
    db.enqueueJob({ meetingId: meeting.id, type: "join" });
    db.claimNextJob();

    const result = await restartBot({
      runCommand: mockRun({ dockerIds: "cid-a\ncid-a\n", pkillJoinOk: true }),
      whichDocker: () => "/usr/bin/docker",
      existsSync: () => false,
    });

    expect(result.ok).toBe(true);
    expect(result.containersRemoved).toBe(1);
    expect(result.meetingsCleared).toBe(1);
    expect(result.jobsFailed).toBe(1);
    expect(result.leftoverProcessesKilled).toBe(true);
    expect(result.workerRestarted).toBe(false);
    expect(result.workerRestartMethod).toBe("skipped");
    expect(db.getMeeting(meeting.id)?.status).toBe("error");
    expect(db.getMeeting(meeting.id)?.error).toBe(MANUAL_RESTART_ERROR);
    expect(db.listJobs()[0]?.status).toBe("failed");

    const filters = calls
      .filter((call) => call.args[0] === "ps")
      .map((call) => call.args[call.args.indexOf("--filter") + 1]);
    expect(filters).toContain(`label=${ZOOM_BOT_ROLE_LABEL}`);
    expect(filters).toContain(`ancestor=${ZOOM_BOT_IMAGE_DEFAULT}`);
    expect(
      calls.some((call) => call.args[0] === "rm" && call.args.includes("cid-a")),
    ).toBe(true);
    expect(
      calls.some(
        (call) =>
          call.command === "pkill" && call.args.includes("src/worker/index.ts"),
      ),
    ).toBe(false);
  });

  it("на сервере пробует systemctl, иначе pkill воркера", async () => {
    db = createDb(":memory:");
    setDb(db);

    const viaSudo = await restartBot({
      runCommand: mockRun({ sudoOk: true }),
      whichDocker: () => null,
      existsSync: (path) => path === WORKER_UNIT,
    });
    expect(viaSudo.workerRestarted).toBe(true);
    expect(viaSudo.workerRestartMethod).toBe("systemctl");
    expect(
      calls.some(
        (call) =>
          call.command === "sudo" &&
          call.args.includes("systemctl") &&
          call.args.includes("restart"),
      ),
    ).toBe(true);

    calls.length = 0;
    const viaPkill = await restartBot({
      runCommand: mockRun({ sudoOk: false, pkillWorkerOk: true }),
      whichDocker: () => null,
      existsSync: (path) => path === WORKER_UNIT,
    });
    expect(viaPkill.workerRestarted).toBe(true);
    expect(viaPkill.workerRestartMethod).toBe("pkill");
    expect(
      calls.some(
        (call) =>
          call.command === "pkill" && call.args.includes("src/worker/index.ts"),
      ),
    ).toBe(true);
  });
});
