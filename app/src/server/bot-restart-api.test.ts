import { afterEach, describe, expect, it } from "vitest";
import { app } from "./app.ts";
import { resetBotRestartDeps, setBotRestartDeps } from "./bot-restart.ts";
import { authHeaders, setupAuthedDb } from "./test-auth.ts";

describe("POST /api/bot/restart", () => {
  let db: ReturnType<typeof setupAuthedDb>["db"];
  let auth: ReturnType<typeof setupAuthedDb>["auth"];

  afterEach(() => {
    resetBotRestartDeps();
    db?.close();
  });

  it("снимает queued встречу и running job, повтор той же ссылки даёт 201", async () => {
    ({ db, auth } = setupAuthedDb());
    setBotRestartDeps({
      runCommand: async () => ({ ok: true, stdout: "", stderr: "" }),
      whichDocker: () => "/usr/bin/docker",
      existsSync: () => false,
    });

    const url = "https://zoom.us/j/555111222";
    const created = await app.request("/api/meetings", {
      method: "POST",
      headers: authHeaders(auth, { "content-type": "application/json" }),
      body: JSON.stringify({ url, projectId: db.getDefaultProject().id }),
    });
    expect(created.status).toBe(201);
    const running = db.claimNextJob();
    expect(running?.status).toBe("running");

    const restart = await app.request("/api/bot/restart", {
      method: "POST",
      headers: authHeaders(auth, { "content-type": "application/json" }),
      body: JSON.stringify({ confirm: true }),
    });
    expect(restart.status).toBe(200);
    const body = await restart.json();
    expect(body.ok).toBe(true);
    expect(body.meetingsCleared).toBe(1);
    expect(body.jobsFailed).toBe(1);
    expect(body.workerRestarted).toBe(false);
    expect(body.workerRestartMethod).toBe("skipped");
    expect(db.listMeetings()[0]?.status).toBe("error");
    expect(db.listJobs()[0]?.status).toBe("failed");

    const again = await app.request("/api/meetings", {
      method: "POST",
      headers: authHeaders(auth, { "content-type": "application/json" }),
      body: JSON.stringify({ url, projectId: db.getDefaultProject().id }),
    });
    expect(again.status).toBe(201);
    const againBody = await again.json();
    expect(againBody.alreadyRunning).toBe(false);
    expect(againBody.meeting.status).toBe("queued");
    expect(db.listMeetings()).toHaveLength(2);
  });
});
