import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "../../../shared/types.ts";
import { HomeView, type HomeMeeting, type HomeProject } from "./HomeView.tsx";

const projects: HomeProject[] = [
  {
    id: "svoi",
    name: "Свои",
    trackerProjectRef: "",
    trackerParentRef: "",
    meetingCount: 2,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    lastMeeting: null,
  },
  {
    id: "road",
    name: "Roadmap Q4",
    trackerProjectRef: "https://app.clickup.com/q4",
    trackerParentRef: "ROAD-100",
    meetingCount: 1,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    lastMeeting: {
      id: "m-ready",
      title: "Встреча по onboarding",
      status: "ready",
      startedAt: "2026-09-03T10:00:00.000Z",
    },
  },
];

const liveMeeting: HomeMeeting = {
  id: "m-live",
  url: "https://meet.google.com/aaa-bbbb-ccc",
  platform: "meet",
  title: "Синк по roadmap Q4",
  status: "recording",
  recordingMode: "text",
  startedAt: "2026-09-04T07:30:00.000Z",
  endedAt: null,
  error: null,
  announcementStatus: null,
  source: "stub",
  audioPath: null,
  projectId: "road",
};

const queuedMeeting: HomeMeeting = {
  id: "m-queue",
  url: "https://zoom.us/j/333",
  platform: "zoom",
  title: "1:1 с дизайнером",
  status: "queued",
  recordingMode: "text",
  startedAt: "2026-09-05T15:30:00.000Z",
  endedAt: null,
  error: null,
  announcementStatus: null,
  source: "stub",
  audioPath: null,
  projectId: "svoi",
};

const readyMeeting: HomeMeeting = {
  id: "m-ready",
  url: "https://zoom.us/j/222",
  platform: "zoom",
  title: "Встреча по onboarding",
  status: "ready",
  recordingMode: "text",
  startedAt: "2026-09-03T10:00:00.000Z",
  endedAt: "2026-09-03T10:47:00.000Z",
  error: null,
  announcementStatus: null,
  source: "stub",
  audioPath: null,
  projectId: "svoi",
  headline: "Первый экран сокращаем до одного поля.",
};

function renderHome(meetings: HomeMeeting[], extra: Partial<Parameters<typeof HomeView>[0]> = {}) {
  return renderToString(
    <MemoryRouter>
      <HomeView
        meetings={meetings}
        storage={{ meetingCount: meetings.length, usedBytes: 0 }}
        projects={projects}
        projectCount={2}
        meetingCount={3}
        selectedProjectId="svoi"
        url="https://meet.google.com/abc-defg-hij"
        error={null}
        notice={null}
        busy={false}
        onUrlChange={() => undefined}
        onProjectChange={() => undefined}
        onSubmit={() => undefined}
        onSendBot={() => undefined}
        {...extra}
      />
    </MemoryRouter>,
  );
}

describe("HomeView", () => {
  it("рендерит v2 макет: захват, проекты, степпер, колонки", () => {
    const html = renderHome([liveMeeting, queuedMeeting, readyMeeting]);
    expect(html).toContain("Главная");
    expect(html).toContain("3 расшифровки в 2 проектах");
    expect(html).toContain("Найти встречу или фразу");
    expect(html).toContain("home__search-icon");
    expect(html).toContain("Отправить бота на звонок");
    expect(html).toContain("Ссылка и проект: запись ляжет в выбранный проект");
    expect(html).toContain("ссылка на встречу");
    expect(html).toContain("Отправить бота");
    expect(html).toContain("Google Meet");
    expect(html).toContain("Яндекс Телемост");
    expect(html).toContain("Распознан Google Meet");
    expect(html).toContain("Проекты");
    expect(html).toContain("home__project-row");
    expect(html).toContain("Roadmap Q4");
    expect(html).toContain("Epic ROAD-100");
    expect(html).toContain("Синк по roadmap Q4");
    expect(html).toContain("home__stepper");
    expect(html).toContain("home__live-rec");
    expect(html).toContain("home__step-dot");
    expect(html).toContain("home__step-connector");
    expect(html).toContain("Запись");
    expect(html).toContain("Запись: идёт звук");
    expect(html).toContain("Следующие по ссылке");
    expect(html).toContain("ссылки уже сохранены");
    expect(html).toContain("home__queue");
    expect(html).toContain("home__queue-pill");
    expect(html).toContain("home__btn--send");
    expect(html).toContain("1:1 с дизайнером");
    expect(html).toMatch(/Ссылка готова|Через \d+ мин/);
    expect(html).toContain("Последние расшифровки");
    expect(html).toContain("Встреча по onboarding");
    expect(html).toContain("Первый экран сокращаем до одного поля.");
    expect(html).not.toContain("весь календарь");
    expect(html).not.toContain("home__project-grid");
    expect(html).not.toContain("Бот свободен");
    expect(html).not.toContain("Запустить запись вручную");
    expect(html).not.toContain("\u2014");
    expect(html).not.toContain("#0062FF");
  });

  it("показывает чип выбранного проекта", () => {
    const html = renderHome([]);
    expect(html).toContain("home__picker-chip");
    expect(html).toContain("Свои");
  });

  it("пустые колонки оставляют белую карточку с текстом внутри", () => {
    const html = renderHome([]);
    expect(html).toContain("home__queue--empty");
    expect(html).toContain("Пока нет следующих звонков");
    expect(html).toContain("Пока нет расшифровок");
  });

  it("показывает ближайшие звонки календаря под блоком отправки бота", () => {
    const events: CalendarEvent[] = [
      {
        id: "ev-1",
        title: "Синк по продукту",
        startsAt: "2026-09-06T09:00:00.000Z",
        endsAt: "2026-09-06T09:30:00.000Z",
        url: "https://zoom.us/j/999",
        platform: "zoom",
        supported: true,
        meetingId: null,
        meetingStatus: null,
      },
    ];
    const html = renderHome([], { upcomingCalendarEvents: events });
    const capturedIndex = html.indexOf("home__capture-submit");
    const calendarIndex = html.indexOf("Ближайшие звонки");
    expect(capturedIndex).toBeGreaterThan(-1);
    expect(calendarIndex).toBeGreaterThan(capturedIndex);
    expect(html).toContain("Синк по продукту");
  });

  it("не показывает секцию ближайших звонков, когда календарь пуст", () => {
    const html = renderHome([]);
    expect(html).not.toContain("Ближайшие звонки");
  });
});
