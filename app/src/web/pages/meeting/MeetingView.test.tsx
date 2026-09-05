import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { Meeting } from "../../../shared/types.ts";
import { MeetingView, type MeetingViewProps } from "./MeetingView.tsx";

const meeting: Meeting = {
  id: "m1",
  url: "https://zoom.us/j/1",
  platform: "zoom",
  title: "Пилот",
  status: "ready",
  recordingMode: "text",
  startedAt: "2026-09-03T10:00:00.000Z",
  endedAt: "2026-09-03T10:47:00.000Z",
  error: null,
  announcementStatus: null,
  source: "stub",
  projectId: null,
  audioPath: null,
};

function renderMeeting(overrides: Partial<MeetingViewProps> & Pick<MeetingViewProps, "detail">) {
  return renderToString(
    <MemoryRouter>
      <MeetingView trackerLabel="ClickUp" {...overrides} />
    </MemoryRouter>,
  );
}

describe("MeetingView", () => {
  it("не падает на пустом транскрипте", () => {
    const html = renderMeeting({
      detail: {
        meeting,
        transcript: [],
        summary: null,
        actionItems: [],
      },
    });
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain("демо-данные");
    expect(html).toContain("Транскрипт встречи");
    expect(html).not.toContain("Слайды");
  });

  it("ставит заголовок с названием встречи, подпись и бейдж", () => {
    const html = renderMeeting({
      detail: {
        meeting,
        transcript: [],
        summary: null,
        actionItems: [],
      },
      projectName: "Roadmap Q4",
      epicKey: "ROAD-100",
    });
    expect(html).toMatch(/<h1[^>]*>Пилот<\/h1>/);
    expect(html).toContain("Roadmap Q4");
    expect(html).toContain("47 мин");
    expect(html).toContain("Epic ROAD-100");
    expect(html).toContain("Готово");
    expect(html).not.toContain("Готово к отправке");
  });

  it("рисует макет 60/40: транскрипт, резюме и задачи с CTA трекера", () => {
    const html = renderMeeting({
      detail: {
        meeting,
        transcript: [
          {
            id: "s1",
            meetingId: "m1",
            speaker: "Анна",
            startedAtMs: 0,
            endedAtMs: 4000,
            text: "Берём прототип к четвергу",
          },
        ],
        summary: {
          meetingId: "m1",
          headline: "Согласовали MVP",
          decisions: "UI как в макете\nотправка в трекер",
          risks: "STT без ключа",
          nextStep: "Собрать прототип",
        },
        actionItems: [
          {
            id: "a1",
            meetingId: "m1",
            assignee: "Илья",
            title: "Поле ссылки на Главной",
            dueAt: "2026-09-04",
            timecodeMs: 0,
            segmentId: "s1",
            asanaState: "none",
            trackerType: null,
            trackerState: "none",
            trackerExternalId: null,
          },
        ],
      },
    });
    expect(html).toContain("meeting__layout");
    expect(html).toContain("Поиск по словам и спикерам");
    expect(html).toContain("Краткое резюме");
    expect(html).toContain("Основной результат");
    expect(html).toContain("Решения");
    expect(html).toContain("Риски");
    expect(html).toContain("Следующий шаг");
    expect(html).toContain("фрагментов");
    expect(html).toContain("Задачи из встречи");
    expect(html).toContain("Создать 1 задачу в ClickUp");
    expect(html).toContain('href="#segment-s1"');
    expect(html).not.toContain("Отправить");
    expect(html).not.toContain("Asana");
  });

  it("в transcribing показывает сегмент и заглушку realtime", () => {
    const html = renderMeeting({
      detail: {
        meeting: { ...meeting, status: "transcribing", source: "stub" },
        transcript: [
          {
            id: "s1",
            meetingId: "m1",
            speaker: "Анна Петрова",
            startedAtMs: 0,
            endedAtMs: 4000,
            text: "Начинаем standup по пилоту",
          },
        ],
        summary: null,
        actionItems: [],
        realtime: { mode: "stub", caption: "заглушка realtime" },
      },
    });
    expect(html).toContain("Начинаем standup по пилоту");
    expect(html).toContain("заглушка realtime");
    expect(html).not.toContain(
      "Транскрипт и задачи появятся, когда обработка закончится",
    );
  });

  it("в recording с live показывает подпись живой", () => {
    const html = renderMeeting({
      detail: {
        meeting: { ...meeting, status: "recording", source: "live" },
        transcript: [
          {
            id: "s1",
            meetingId: "m1",
            speaker: "Спикер 1",
            startedAtMs: 1000,
            endedAtMs: 3000,
            text: "Черновик реплики",
          },
        ],
        summary: null,
        actionItems: [],
        realtime: { mode: "live", caption: "живой" },
      },
    });
    expect(html).toContain("Черновик реплики");
    expect(html).toContain("живой");
  });

  it("без ключа показывает к отправке и не содержит секретов", () => {
    const html = renderMeeting({
      detail: {
        meeting,
        transcript: [],
        summary: null,
        actionItems: [
          {
            id: "a1",
            meetingId: "m1",
            assignee: "Илья",
            title: "Проверить протокол",
            dueAt: "2026-09-04",
            timecodeMs: null,
            segmentId: null,
            asanaState: "queued_for_asana",
            trackerType: "clickup",
            trackerState: "queued",
            trackerExternalId: null,
          },
        ],
      },
      trackerNotice: "Подключите ClickUp в Настройках. Задачи помечены к созданию.",
    });
    expect(html).toContain("к созданию");
    expect(html).toContain("Подключите ClickUp");
    expect(html).not.toContain("Bearer");
    expect(html).not.toMatch(/[0-9]\/[0-9]{10,}/);
    expect(html).not.toContain("test-pat");
  });

  it("показывает плеер при audio_path", () => {
    const html = renderMeeting({
      detail: {
        meeting: { ...meeting, audioPath: "/tmp/a.wav" },
        transcript: [],
        summary: null,
        actionItems: [],
      },
    });
    expect(html).toContain("meeting__player");
    expect(html).toContain('/api/meetings/m1/audio');
  });

  it("не показывает заглушку голосового отпечатка", () => {
    const html = renderMeeting({
      detail: {
        meeting,
        transcript: [
          {
            id: "s1",
            meetingId: "m1",
            speaker: "Спикер 1",
            startedAtMs: 0,
            endedAtMs: 4000,
            text: "Начинаем standup по пилоту",
            voiceprintLabel: "отпечаток не рассчитан",
          },
        ],
        summary: null,
        actionItems: [],
      },
    });
    expect(html).toContain("Спикер 1");
    expect(html).toContain("Начинаем standup по пилоту");
    expect(html).not.toContain("отпечаток не рассчитан");
    expect(html).not.toContain("meeting__voiceprint");
  });

  it("при ошибке и audio_path показывает Повторить транскрибацию", () => {
    const html = renderMeeting({
      detail: {
        meeting: {
          ...meeting,
          status: "error",
          error: "llm ответил статусом 429",
          audioPath: "/tmp/a.wav",
        },
        transcript: [],
        summary: null,
        actionItems: [],
      },
      onRetry: () => undefined,
    });
    expect(html).toContain("Повторить транскрибацию");
    expect(html).not.toContain(">Повторить<");
  });

  it("при ready показывает, что ревью расшифровки не применилось", () => {
    const html = renderMeeting({
      detail: {
        meeting: {
          ...meeting,
          status: "ready",
          source: "live",
          error: null,
        },
        transcript: [],
        summary: {
          meetingId: "m1",
          headline: "Сырой текст",
          decisions: "429",
          risks: "Ревью расшифровки не применилось, показан сырой текст.",
          nextStep: "Позже",
        },
        actionItems: [],
      },
    });
    expect(html).toContain("Ревью расшифровки не применилось, показан сырой текст.");
    expect(html).not.toContain("Повторить транскрибацию");
  });

  it("показывает форму «Спросить по встрече»", () => {
    const html = renderMeeting({
      detail: {
        meeting,
        transcript: [],
        summary: null,
        actionItems: [],
      },
    });
    expect(html).toContain("Спросить по этой встрече");
    expect(html).toContain("Какие решения по бюджету?");
  });
});
