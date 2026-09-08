import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { CalendarEvent, CalendarFeed, Meeting } from "../../../shared/types.ts";
import { CalendarView } from "./CalendarView.tsx";

const meeting: Meeting = {
  id: "m-cal-1",
  url: "https://zoom.us/j/555111222",
  platform: "zoom",
  title: "Стендап",
  status: "queued",
  recordingMode: "text",
  startedAt: "2026-09-04T08:00:00.000Z",
  endedAt: null,
  error: null,
  announcementStatus: null,
  source: "stub",
  audioPath: null,
};

const zoomEvent: CalendarEvent = {
  id: "evt-1",
  title: "Стендап",
  startsAt: "2026-09-08T08:00:00.000Z",
  endsAt: "2026-09-08T08:30:00.000Z",
  url: "https://zoom.us/j/555111222",
  platform: "zoom",
  supported: true,
  meetingId: null,
  meetingStatus: null,
};

function disconnectedFeed(): CalendarFeed {
  return { connected: false, account: null, expired: false, events: [] };
}

function connectedFeed(events: CalendarEvent[]): CalendarFeed {
  return { connected: true, account: "user@example.com", expired: false, events };
}

function renderView(props: {
  feed: CalendarFeed;
  meetings?: Meeting[];
  onSendBot?: (event: CalendarEvent) => void;
  sendingEventId?: string | null;
}) {
  return renderToString(
    <MemoryRouter>
      <CalendarView
        feed={props.feed}
        meetings={props.meetings ?? []}
        onSendBot={props.onSendBot ?? vi.fn()}
        sendingEventId={props.sendingEventId ?? null}
      />
    </MemoryRouter>,
  );
}

describe("CalendarView", () => {
  it("не подключён: приглашение вставить ссылку на Главной и ссылка в Настройки", () => {
    const html = renderView({ feed: disconnectedFeed() });
    expect(html).toContain("Календарь");
    expect(html).toContain("Выключен. Бот идёт только по ссылке.");
    expect(html).toContain("Вставьте ссылку на встречу на Главной");
    expect(html).toContain('href="/settings#integrations"');
    expect(html).not.toContain("—");
  });

  it("не подключён: сохранённые встречи из базы показаны, не пустой список", () => {
    const html = renderView({ feed: disconnectedFeed(), meetings: [meeting] });
    expect(html).toContain("Стендап");
    expect(html).not.toContain("Вставьте ссылку на встречу на Главной");
  });

  it("подключение истекло: сообщение и ссылка в Настройки", () => {
    const feed: CalendarFeed = {
      connected: false,
      account: "user@example.com",
      expired: true,
      events: [],
    };
    const html = renderView({ feed });
    expect(html).toContain(
      "Подключение к Google истекло, подключите календарь заново",
    );
    expect(html).toContain('href="/settings#integrations"');
  });

  it("подключён, событий нет: понятная пустая строка", () => {
    const html = renderView({ feed: connectedFeed([]) });
    expect(html).toContain("На ближайшие 7 дней звонков не найдено");
  });

  it("подключён: событие показывает название, время, платформу, ссылку", () => {
    const html = renderView({ feed: connectedFeed([zoomEvent]) });
    expect(html).toContain("Стендап");
    expect(html).toContain("Zoom");
    expect(html).toContain("https://zoom.us/j/555111222");
    expect(html).toMatch(/\d{2}:\d{2}/);
  });

  it("событие без meetingId для Zoom: кнопка Отправить бота", () => {
    const html = renderView({ feed: connectedFeed([zoomEvent]) });
    expect(html).toContain("Отправить бота");
    expect(html).not.toContain("disabled");
  });

  it("событие с meetingId: кнопка Открыть ведёт на встречу", () => {
    const withMeeting: CalendarEvent = {
      ...zoomEvent,
      meetingId: "m-ready",
      meetingStatus: "ready",
    };
    const html = renderView({ feed: connectedFeed([withMeeting]) });
    expect(html).toContain("Открыть");
    expect(html).toContain('href="/meetings/m-ready"');
    expect(html).not.toContain("Отправить бота");
  });

  it("событие meet/telemost: кнопка неактивна с подсказкой", () => {
    const meetEvent: CalendarEvent = {
      ...zoomEvent,
      id: "evt-meet",
      url: "https://meet.google.com/abc-defg-hij",
      platform: "meet",
      supported: false,
    };
    const html = renderView({ feed: connectedFeed([meetEvent]) });
    expect(html).toContain("Отправить бота");
    expect(html).toContain('title="Живой вход пока только для Zoom"');
    expect(html).toContain("disabled");
  });
});
