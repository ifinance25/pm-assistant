import { describe, expect, it, vi } from "vitest";
import { createLlmAdapter } from "./index.ts";
import { createSttAdapter } from "../stt/index.ts";

describe("llm", () => {
  it("summarize возвращает headline, decisions, risks, nextStep и задачи кто/что/когда", async () => {
    const stt = createSttAdapter({ detectEngine: () => null });
    const transcript = await stt.transcribe("fixtures/demo.wav", {
      languageHint: "ru",
    });
    const llm = createLlmAdapter({ apiKey: "" });
    const result = await llm.summarize(transcript);

    expect(result.mode).toBe("stub");
    expect(result.summary.headline).toMatch(/hotfix/);
    expect(result.summary.decisions).toMatch(/changelog/);
    expect(result.summary.risks).toMatch(/deadline/);
    expect(result.summary.nextStep).toMatch(/понедельник/);
    expect(result.actionItems).toEqual([
      {
        assignee: "Иван Смирнов",
        title: "Подготовить hotfix для API gateway",
        dueAt: "2026-09-05",
        timecodeMs: 8500,
      },
      {
        assignee: "Мария Козлова",
        title: "Написать changelog и проверить feature flag на staging",
        dueAt: "2026-09-08",
        timecodeMs: 18000,
      },
    ]);
  });

  it("пустой OPENAI_API_KEY даёт stub и не падает, непустой ключ даёт live", async () => {
    const stub = createLlmAdapter({ apiKey: "" });
    expect(stub.mode).toBe("stub");
    const transcript = {
      mode: "stub" as const,
      segments: [
        {
          speaker: "Анна Петрова",
          startedAtMs: 0,
          endedAtMs: 1000,
          text: "standup",
        },
      ],
    };
    await expect(stub.summarize(transcript)).resolves.toMatchObject({
      mode: "stub",
    });

    expect(createLlmAdapter({ apiKey: "sk-test" }).mode).toBe("live");
  });

  it("непустой CLAUDE_CODE_OAUTH_TOKEN без явного apiKey даёт live", () => {
    const prev = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "oauth-test-token";
    try {
      expect(createLlmAdapter().mode).toBe("live");
    } finally {
      if (prev === undefined) {
        delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
      } else {
        process.env.CLAUDE_CODE_OAUTH_TOKEN = prev;
      }
    }
  });

  it("при 429 повторяет запрос и затем возвращает JSON", async () => {
    const { liveSummarize, LlmHttpError } = await import("./live.ts");
    const okBody = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              summary: {
                headline: "Итог",
                decisions: "Решили",
                risks: "",
                nextStep: "Дальше",
              },
              actionItems: [],
            }),
          },
        },
      ],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("limit", { status: 429 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(okBody), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const result = await liveSummarize(
        {
          mode: "live",
          segments: [
            {
              speaker: "Анна",
              startedAtMs: 0,
              endedAtMs: 1000,
              text: "standup",
            },
          ],
        },
        "sk-test",
      );
      expect(result.summary.headline).toBe("Итог");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(new LlmHttpError(429).status).toBe(429);
  });

  const STT_MISHEARS = {
    mode: "live" as const,
    segments: [
      {
        speaker: "Спикер 1",
        startedAtMs: 0,
        endedAtMs: 2000,
        text: "Запускаем бута на сервер.",
      },
      {
        speaker: "Спикер 1",
        startedAtMs: 2000,
        endedAtMs: 4000,
        text: "Проверь лаланки в кабинете.",
      },
      {
        speaker: "Спикер 2",
        startedAtMs: 4000,
        endedAtMs: 6000,
        text: "Есть блогеры по деплою.",
      },
      {
        speaker: "Спикер 2",
        startedAtMs: 6000,
        endedAtMs: 8000,
        text: "субтитры создавал DimaTorzok",
      },
    ],
  };

  function openaiReviseResponse(payload: unknown): Response {
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(payload) } }],
      }),
      { status: 200 },
    );
  }

  it("ревью правит явные ослышки в фикстуре", async () => {
    const { liveRevise } = await import("./revise.ts");
    const fetchMock = vi.fn().mockResolvedValue(
      openaiReviseResponse({
        unchanged: false,
        segments: [
          {
            speaker: "Спикер 1",
            startedAtMs: 0,
            endedAtMs: 2000,
            text: "Запускаем бота на сервер.",
          },
          {
            speaker: "Спикер 1",
            startedAtMs: 2000,
            endedAtMs: 4000,
            text: "Проверь колонки в кабинете.",
          },
          {
            speaker: "Спикер 2",
            startedAtMs: 4000,
            endedAtMs: 6000,
            text: "Есть блокеры по деплою.",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const result = await liveRevise(STT_MISHEARS, "sk-test");
      expect(result.changed).toBe(true);
      const text = result.transcript.segments.map((row) => row.text).join(" ");
      expect(text).toMatch(/бота/);
      expect(text).toMatch(/колонки/);
      expect(text).toMatch(/блокеры/);
      expect(text).not.toMatch(/бута|лаланки|блогеры|DimaTorzok/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("цикл ревью останавливается, когда правок нет", async () => {
    const { reviseTranscriptLoop, TRANSCRIPT_REVISE_MAX_PASSES } = await import(
      "./revise.ts"
    );
    let calls = 0;
    const revised = await reviseTranscriptLoop(async (current) => {
      calls += 1;
      if (calls === 1) {
        return {
          changed: true,
          transcript: {
            mode: current.mode,
            segments: [
              {
                speaker: "Спикер 1",
                startedAtMs: 0,
                endedAtMs: 2000,
                text: "Запускаем бота на сервер.",
              },
            ],
          },
        };
      }
      return { changed: false, transcript: current };
    }, STT_MISHEARS);
    expect(calls).toBe(2);
    expect(calls).toBeLessThanOrEqual(TRANSCRIPT_REVISE_MAX_PASSES);
    expect(revised.segments[0]?.text).toMatch(/бота/);
  });

  it("цикл ревью не бесконечный: стоп после трёх проходов", async () => {
    const { reviseTranscriptLoop, TRANSCRIPT_REVISE_MAX_PASSES } = await import(
      "./revise.ts"
    );
    let calls = 0;
    await reviseTranscriptLoop(async (current) => {
      calls += 1;
      return {
        changed: true,
        transcript: {
          mode: current.mode,
          segments: [
            {
              speaker: "Спикер 1",
              startedAtMs: 0,
              endedAtMs: 1000,
              text: `правка ${calls}`,
            },
          ],
        },
      };
    }, STT_MISHEARS);
    expect(calls).toBe(TRANSCRIPT_REVISE_MAX_PASSES);
  });

  it("при 429 на revise повторяет запрос и затем отдаёт правку", async () => {
    const { liveRevise } = await import("./revise.ts");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("limit", { status: 429 }))
      .mockResolvedValueOnce(
        openaiReviseResponse({
          unchanged: true,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const result = await liveRevise(STT_MISHEARS, "sk-test");
      expect(result.changed).toBe(false);
      expect(result.transcript).toEqual(STT_MISHEARS);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
