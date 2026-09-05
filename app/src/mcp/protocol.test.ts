import { afterEach, describe, expect, it } from "vitest";
import { createDb } from "../db/index.ts";
import { handleJsonRpc, parseJsonRpc } from "./protocol.ts";

describe("MCP JSON-RPC", () => {
  let db: ReturnType<typeof createDb>;

  afterEach(() => {
    db?.close();
  });

  it("разбирает tools/call list_meetings без живого Claude", () => {
    db = createDb(":memory:");
    const meeting = db.createMeeting({
      url: "https://zoom.us/j/42",
      title: "Стендап",
    });

    const request = parseJsonRpc(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "list_meetings", arguments: {} },
      }),
    );
    const response = handleJsonRpc(request, db);
    expect(response).not.toBeNull();
    if (!response) {
      throw new Error("нет ответа MCP");
    }
    expect(response.id).toBe(1);
    const text = JSON.parse(
      (response.result as { content: { text: string }[] }).content[0].text,
    ) as { meetings: { id: string; url: string; title: string | null }[] };
    expect(text.meetings).toHaveLength(1);
    expect(text.meetings[0].id).toBe(meeting.id);
    expect(text.meetings[0].url).toBe("https://zoom.us/j/42");
    expect(text.meetings[0].title).toBe("Стендап");
  });

  it("разбирает tools/call get_meeting: транскрипт, резюме, задачи", () => {
    db = createDb(":memory:");
    const meeting = db.createMeeting({
      url: "https://meet.google.com/abc-defg-hij",
      title: "Ретро",
    });
    db.saveTranscript(meeting.id, [
      {
        speaker: "Спикер 1",
        startedAtMs: 0,
        endedAtMs: 4000,
        text: "Фиксируем срок демо на пятницу",
      },
    ]);
    db.saveSummary(meeting.id, {
      headline: "Демо в пятницу",
      decisions: "Показываем заглушку STT",
      risks: "Нет ключа LLM",
      nextStep: "Прогнать воркер",
    });
    db.saveActionItems(meeting.id, [
      {
        assignee: "Илья",
        title: "Прогнать воркер по фикстуре",
        dueAt: "2026-09-05",
        timecodeMs: 0,
        segmentId: null,
      },
    ]);

    const request = parseJsonRpc(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "get_meeting", arguments: { id: meeting.id } },
      }),
    );
    const response = handleJsonRpc(request, db);

    expect(response?.id).toBe(7);
    const text = JSON.parse(
      (response?.result as { content: { text: string }[] }).content[0].text,
    ) as {
      meeting: { title: string | null };
      transcript: { text: string }[];
      summary: { headline: string } | null;
      actionItems: { title: string }[];
    };
    expect(text.meeting.title).toBe("Ретро");
    expect(text.transcript[0].text).toBe("Фиксируем срок демо на пятницу");
    expect(text.summary?.headline).toBe("Демо в пятницу");
    expect(text.actionItems[0].title).toBe("Прогнать воркер по фикстуре");
  });
});
