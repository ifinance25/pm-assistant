import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { CalendarFeed } from "../../../shared/types.ts";
import { CalendarView } from "./CalendarView.tsx";

describe("CalendarPlaceholder", () => {
  it("показывает заголовок и приглашение вставить ссылку без событий", () => {
    const feed: CalendarFeed = {
      connected: false,
      account: null,
      expired: false,
      events: [],
    };
    const html = renderToString(
      <MemoryRouter>
        <CalendarView
          feed={feed}
          meetings={[]}
          onSendBot={vi.fn()}
          sendingEventId={null}
        />
      </MemoryRouter>,
    );
    expect(html).toContain("Календарь");
    expect(html).toContain("Выключен. Бот идёт только по ссылке.");
    expect(html).toContain("не подключён");
    expect(html).toContain("Вставьте ссылку на встречу на Главной");
    expect(html).not.toContain("Команда");
    expect(html).not.toContain("Биллинг");
  });
});
