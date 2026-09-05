import { afterEach, describe, expect, it, vi } from "vitest";
import { createAsanaAdapter, maybeAutoSendAsana } from "./index.ts";
import { createDb } from "../../db/index.ts";
import { runOnce, type ProcessJobDeps } from "../../worker/pipeline.ts";

const item = {
  id: "task-1",
  title: "Подключить тестовый Asana workspace",
  assignee: "Илья",
  dueAt: "2026-09-04",
};

describe("asana adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ASANA_PAT;
  });

  it("без ключа не ходит в сеть и не падает", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const adapter = createAsanaAdapter({ token: "" });
    const result = await adapter.dispatch([item]);
    expect(result.mode).toBe("queued");
    expect(result.notice).toMatch(/нет ключа ASANA_PAT/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("с токеном делает POST в Asana API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { gid: "1" } }), { status: 201 }),
    );
    const adapter = createAsanaAdapter({
      token: "test-pat",
      projectGid: "1200",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const result = await adapter.dispatch([item]);
    expect(result.mode).toBe("sent");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://app.asana.com/api/1.0/tasks");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-pat",
    );
    const body = JSON.parse(String(init.body)) as {
      data: { name: string; projects: string[] };
    };
    expect(body.data.name).toBe(item.title);
    expect(body.data.projects).toEqual(["1200"]);
  });
});

describe("автоотправка Asana после ready", () => {
  let db: ReturnType<typeof createDb>;

  afterEach(() => {
    db?.close();
    vi.unstubAllGlobals();
    delete process.env.ASANA_PAT;
  });

  it("без токена после ready ставит queued_for_asana", async () => {
    db = createDb(":memory:");
    db.putSettings({ asanaAutoSend: true, trackerType: "asana" });
    const meeting = db.createMeeting({
      url: "https://zoom.us/j/1",
      platform: "zoom",
    });
    db.enqueueJob({ meetingId: meeting.id, type: "join" });
    const deps: ProcessJobDeps = {
      join: async (_item, hooks) => {
        await hooks?.onJoined?.({ mode: "live" });
        return { mode: "live" as const, audioPath: "/tmp/pm-asana.wav" };
      },
      transcribe: async () => ({
        mode: "live" as const,
        segments: [
          {
            speaker: "Спикер 1",
            startedAtMs: 0,
            endedAtMs: 1000,
            text: "Нужно закрыть протокол",
          },
        ],
      }),
      reviseTranscript: async (transcript) => transcript,
      summarize: async () => ({
        mode: "live" as const,
        summary: {
          headline: "Итог",
          decisions: "Решили",
          risks: "",
          nextStep: "Дальше",
          decisionSegmentIds: [],
        },
        actionItems: [
          {
            assignee: "Илья",
            title: "Закрыть протокол",
            dueAt: null,
            timecodeMs: null,
            segmentId: null,
          },
        ],
      }),
      resolveLlmKey: () => "sk-test",
    };
    await runOnce(db, deps);
    await runOnce(db, deps);
    await runOnce(db, deps);
    expect(db.getMeeting(meeting.id)?.status).toBe("ready");
    const items = db.listActionItems(meeting.id);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => item.asanaState === "queued_for_asana")).toBe(
      true,
    );
  });

  it("с моком fetch делает POST", async () => {
    db = createDb(":memory:");
    const meeting = db.createMeeting({ url: "https://zoom.us/j/2" });
    const items = db.saveActionItems(meeting.id, [
      {
        assignee: "Илья",
        title: "Закрыть протокол",
        dueAt: null,
        timecodeMs: null,
        segmentId: null,
      },
    ]);
    db.putSettings({ asanaAutoSend: true, asanaProjectLabel: "1200" });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { gid: "2" } }), { status: 201 }),
    );
    const result = await maybeAutoSendAsana(db, meeting.id, {
      token: "test-pat",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(result?.mode).toBe("sent");
    expect(fetchMock).toHaveBeenCalled();
    expect(db.listActionItems(meeting.id)[0].asanaState).toBe("sent");
    expect(items[0].title).toBe("Закрыть протокол");
  });
});
