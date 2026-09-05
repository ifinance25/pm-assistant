import { describe, expect, it, vi } from "vitest";
import {
  buildMeetingAskUserContent,
  liveAskMeetingOpenAi,
  parseAskAnswer,
  stubAskMeeting,
  type MeetingAskContext,
} from "./ask.ts";

const baseContext: MeetingAskContext = {
  meetingTitle: "Standup",
  transcript: [
    {
      id: "s1",
      meetingId: "m1",
      speaker: "Анна",
      startedAtMs: 0,
      endedAtMs: 1000,
      text: "Релиз переносим на следующую неделю.",
    },
  ],
  summary: {
    meetingId: "m1",
    headline: "Перенос релиза",
    decisions: "Релиз на следующей неделе.",
    risks: "",
    nextStep: "Обновить roadmap.",
    decisionSegmentIds: [],
  },
  actionItems: [{ title: "Обновить roadmap", assignee: "Пётр" }],
  epicKey: "ROAD-100",
  question: "Когда релиз?",
};

describe("askMeeting", () => {
  it("собирает контекст встречи для промпта", () => {
    const user = buildMeetingAskUserContent(baseContext);
    expect(user).toContain("Epic проекта: ROAD-100");
    expect(user).toContain("Релиз переносим");
    expect(user).toContain("Когда релиз?");
  });

  it("parseAskAnswer возвращает out-of-scope ответ", () => {
    const answer = parseAskAnswer(
      JSON.stringify({
        inScope: false,
        answer: "В данной встрече эта тема не обсуждалась.",
      }),
    );
    expect(answer).toContain("не обсуждалась");
  });

  it("stub отвечает по epic из контекста", () => {
    const answer = stubAskMeeting({
      ...baseContext,
      question: "Что в Epic?",
    });
    expect(answer).toContain("ROAD-100");
  });

  it("stub отвечает out-of-scope без совпадений", () => {
    const answer = stubAskMeeting({
      ...baseContext,
      question: "Курс биткоина?",
    });
    expect(answer).toContain("не обсуждалась");
  });

  it("live OpenAI возвращает ответ из JSON", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                inScope: true,
                answer: "Релиз на следующей неделе.",
              }),
            },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const answer = await liveAskMeetingOpenAi(baseContext, "sk-test");
      expect(answer).toBe("Релиз на следующей неделе.");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
