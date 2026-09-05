import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import {
  ArchiveView,
  hitsFromSearch,
  type ArchiveContext,
  type ArchiveHit,
  type ArchiveViewProps,
} from "./ArchiveView.tsx";

const emptyFilters = { platform: "", period: "", status: "", projectId: "" };
const sampleProjects = [
  { id: "p1", name: "Свои" },
  { id: "p2", name: "Roadmap Q4" },
];

function renderView(overrides: Partial<ArchiveViewProps> = {}) {
  return renderToString(
    <MemoryRouter>
      <ArchiveView
        query=""
        filters={emptyFilters}
        projects={sampleProjects}
        results={[]}
        selectedId={null}
        selected={null}
        meetingCount={24}
        projectCount={4}
        {...overrides}
      />
    </MemoryRouter>,
  );
}

describe("ArchiveView", () => {
  it("показывает заголовок Транскрибации, сводку и поиск в шапке", () => {
    const html = renderView();
    expect(html).toContain("Транскрибации");
    expect(html).toContain("24 расшифровки в 4 проектах");
    expect(html).toContain("Найти встречу или фразу");
    expect(html).not.toContain("Поиск по встречам");
    expect(html).not.toContain("Уведомления");
    expect(html).not.toContain("Поиск по транскриптам, резюме и задачам");
  });

  it("показывает чипы проектов и статусов без боковой колонки источник/период", () => {
    const html = renderView({
      filters: {
        platform: "",
        period: "",
        status: "ready",
        projectId: "",
      },
    });
    expect(html).toContain("Все проекты");
    expect(html).toContain("Свои");
    expect(html).toContain("Roadmap Q4");
    expect(html).toContain("Готово");
    expect(html).toContain("Запись");
    expect(html).toContain("Очередь");
    expect(html).toContain("Расшифровка");
    expect(html).toContain("archive__chip--active");
    expect(html).not.toContain("Источник");
    expect(html).not.toContain("Яндекс.Телемост");
    expect(html).not.toContain("7 дней");
    expect(html).not.toContain("Этот месяц");
    expect(html).not.toContain("В обработке");
  });

  it("показывает карточки со статусом, метой и сниппетом", () => {
    const hit: ArchiveHit = {
      id: "m1",
      title: "Синк по roadmap Q4",
      platform: "zoom",
      status: "ready",
      startedAt: "2026-08-14T10:00:00.000Z",
      endedAt: "2026-08-14T10:42:00.000Z",
      snippet: "Интеграции переносим в настройки, релиз 3 сентября не двигаем.",
      href: "/meetings/m1",
      projectName: "Roadmap Q4",
      matchCount: 4,
      decisionCount: 2,
      taskCount: 4,
    };
    const html = renderView({ results: [hit], selectedId: "m1" });
    expect(html).toContain("Синк по roadmap Q4");
    expect(html).toContain("Готово");
    expect(html).toContain("Zoom");
    expect(html).toContain("42 мин");
    expect(html).toContain("Roadmap Q4");
    expect(html).toContain("Интеграции переносим в настройки");
    expect(html).toContain("archive__card--active");
    expect(html).toContain('data-meeting-href="/meetings/m1"');
    expect(html).not.toContain("совпадения");
  });

  it("в правой колонке показывает Epic, счётчики и Открыть встречу", () => {
    const selected: ArchiveContext = {
      id: "m1",
      title: "Синк по roadmap Q4",
      platform: "zoom",
      startedAt: "2026-08-14T10:00:00.000Z",
      durationLabel: "42 мин",
      snippet: "Интеграции переносим в настройки, релиз 3 сентября оставляем.",
      href: "/meetings/m1",
      projectName: "Roadmap Q4",
      epicKey: "ROAD-100",
      fragmentCount: 4,
      decisionCount: 2,
      taskCount: 4,
    };
    const html = renderView({ selectedId: "m1", selected });
    expect(html).toContain("проект Roadmap Q4");
    expect(html).toContain("Epic ROAD-100");
    expect(html).toContain("4");
    expect(html).toContain("фрагмента");
    expect(html).toContain("2");
    expect(html).toContain("решения");
    expect(html).toContain("4");
    expect(html).toContain("задачи");
    expect(html).toContain("Открыть встречу");
    expect(html).toContain('href="/meetings/m1"');
    expect(html).not.toContain("Лучшее совпадение");
    expect(html).not.toContain("риск");
  });

  it("пустой запрос показывает список встреч из выдачи", () => {
    const planted: ArchiveHit = {
      id: "keep",
      title: "Планирование roadmap Q3",
      platform: "zoom",
      status: "ready",
      startedAt: "2026-09-04T07:00:00.000Z",
      endedAt: null,
      snippet: "фрагмент из резюме",
      href: "/meetings/keep",
      projectName: null,
      epicKey: null,
      matchCount: 0,
      decisionCount: 0,
      taskCount: 0,
    };
    expect(hitsFromSearch([planted])).toEqual([planted]);
    const html = renderView({ query: "", results: hitsFromSearch([planted]) });
    expect(html).toContain("Планирование roadmap Q3");
    expect(html).toContain("фрагмент из резюме");
    expect(html).not.toContain("Ничего не найдено");
  });

  it("верстка на токенах T14 без старого синего", () => {
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "archive.css"),
      "utf8",
    );
    expect(css).not.toMatch(/#0062[Ff]{2}/);
    expect(css).toContain("var(--accent)");
    expect(css).toContain("var(--radius-card)");
    expect(css).toContain("archive__context");
    expect(css).toContain("archive__chip--active");
  });
});
