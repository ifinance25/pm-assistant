import { afterEach, describe, expect, it } from "vitest";
import { createDb, setDb } from "../db/index.ts";
import { app } from "./app.ts";

describe("GET /api/health", () => {
  let db: ReturnType<typeof createDb>;

  afterEach(() => {
    db?.close();
  });

  it("возвращает ok", async () => {
    db = createDb(":memory:");
    setDb(db);
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      workerAlive: false,
      workerHeartbeatAt: null,
    });
  });
});
