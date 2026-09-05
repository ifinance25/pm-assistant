import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { Meeting } from "../../../shared/types.ts";
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

describe("CalendarView", () => {
  it("пустое состояние приглашает вставить ссылку на Главной", () => {
    const html = renderToString(
      <MemoryRouter>
        <CalendarView meetings={[]} />
      </MemoryRouter>,
    );
    expect(html).toContain("Календарь");
    expect(html).toContain("Выключен. Бот идёт только по ссылке.");
    expect(html).toContain("не подключён");
    expect(html).toContain("Вставьте ссылку на встречу на Главной");
    expect(html).toContain('href="/"');
    expect(html).not.toContain("будет позже");
    expect(html).not.toContain("не подключено в этой версии");
    expect(html).not.toContain("\u2014");
  });

  it("для queued показывает Отправить бота, для ready Открыть", () => {
    const queued = { ...meeting, status: "queued" as const };
    const ready = { ...meeting, id: "m-ready", status: "ready" as const };
    const htmlQueued = renderToString(
      <MemoryRouter>
        <CalendarView meetings={[queued]} />
      </MemoryRouter>,
    );
    expect(htmlQueued).toContain("Отправить бота");
    expect(htmlQueued).toContain('href="/?url=');

    const htmlReady = renderToString(
      <MemoryRouter>
        <CalendarView meetings={[ready]} />
      </MemoryRouter>,
    );
    expect(htmlReady).toContain("Открыть");
    expect(htmlReady).toContain('href="/meetings/m-ready"');
  });

  it("показывает строку: название, время, платформа, URL", () => {
    const html = renderToString(
      <MemoryRouter>
        <CalendarView meetings={[meeting]} />
      </MemoryRouter>,
    );
    expect(html).toContain("Стендап");
    expect(html).toContain("Zoom");
    expect(html).toContain("https://zoom.us/j/555111222");
    expect(html).toMatch(/\d{2}:\d{2}/);
    expect(html).not.toContain("будет позже");
    expect(html).not.toContain("не подключено в этой версии");
    expect(html).not.toContain("\u2014");
    expect(html).not.toContain("#0062FF");
  });
});
