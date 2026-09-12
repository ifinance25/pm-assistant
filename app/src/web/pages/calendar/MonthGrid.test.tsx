import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MonthGrid } from "./MonthGrid.tsx";

const today = new Date(2026, 8, 8);
const initialMonth = new Date(2026, 8, 1);

describe("MonthGrid", () => {
  it("показывает заголовок месяца и все дни недели", () => {
    const html = renderToString(
      <MonthGrid today={today} initialMonth={initialMonth} />,
    );
    expect(html).toContain("Сентябрь 2026");
    for (const label of ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]) {
      expect(html).toContain(label);
    }
  });

  it("рисует все 30 дней сентября 2026 без пропусков", () => {
    const html = renderToString(
      <MonthGrid today={today} initialMonth={initialMonth} />,
    );
    for (let day = 1; day <= 30; day += 1) {
      expect(html).toContain(`>${day}<`);
    }
  });

  it("выделяет сегодняшний день кружком", () => {
    const html = renderToString(
      <MonthGrid today={today} initialMonth={initialMonth} />,
    );
    expect(html).toContain("month-grid__day--today");
  });

  it("другой месяц: сегодняшнего дня нет, кружка нет", () => {
    const html = renderToString(
      <MonthGrid today={today} initialMonth={new Date(2026, 9, 1)} />,
    );
    expect(html).not.toContain("month-grid__day--today");
    expect(html).toContain("Октябрь 2026");
  });

  it("стрелки навигации присутствуют и подписаны для доступности", () => {
    const html = renderToString(
      <MonthGrid today={today} initialMonth={initialMonth} />,
    );
    expect(html).toContain('aria-label="Предыдущий месяц"');
    expect(html).toContain('aria-label="Следующий месяц"');
  });
});
