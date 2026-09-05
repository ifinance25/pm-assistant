import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { CalendarView } from "./CalendarView.tsx";

describe("CalendarPlaceholder", () => {
  it("показывает заголовок и приглашение вставить ссылку без событий", () => {
    const html = renderToString(
      <MemoryRouter>
        <CalendarView meetings={[]} />
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
