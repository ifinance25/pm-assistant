import { afterEach, describe, expect, it } from "vitest";
import { createDb } from "../../db/index.ts";
import { deliverReadyWebhook } from "./index.ts";

describe("вебхук ready", () => {
  let db: ReturnType<typeof createDb>;

  afterEach(() => {
    db?.close();
  });

  it("без URL пишет локальный лог и не ходит в сеть", async () => {
    db = createDb(":memory:");
    const meeting = db.createMeeting({
      url: "https://zoom.us/j/1",
      platform: "zoom",
    });
    const ready = db.updateMeetingStatus(meeting.id, "ready");
    const calls: unknown[] = [];
    const result = await deliverReadyWebhook(db, ready, {
      fetchImpl: async (...args) => {
        calls.push(args);
        return new Response("ok");
      },
    });
    expect(calls).toEqual([]);
    expect(result.status).toBe("skipped");
    expect(result.detail).toBe("вебхук не настроен");
    expect(db.listWebhookDeliveries()).toEqual([
      expect.objectContaining({
        meetingId: meeting.id,
        url: "",
        status: "skipped",
        detail: "вебхук не настроен",
      }),
    ]);
  });

  it("с URL шлёт POST JSON через переданный fetch, без внешней сети", async () => {
    db = createDb(":memory:");
    db.putSettings({ webhookUrl: "https://hooks.local/ready" });
    const meeting = db.createMeeting({
      url: "https://zoom.us/j/2",
      platform: "zoom",
    });
    const ready = db.updateMeetingStatus(meeting.id, "ready");
    const calls: { url: string; init: RequestInit }[] = [];
    const result = await deliverReadyWebhook(db, ready, {
      fetchImpl: async (input, init) => {
        calls.push({ url: String(input), init: init ?? {} });
        return new Response("ok", { status: 200 });
      },
    });
    expect(result.status).toBe("delivered");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://hooks.local/ready");
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      event: "meeting.ready",
      meeting: ready,
    });
    expect(db.listWebhookDeliveries()).toEqual([
      expect.objectContaining({
        meetingId: meeting.id,
        url: "https://hooks.local/ready",
        status: "delivered",
      }),
    ]);
  });
});
