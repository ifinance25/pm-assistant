import { renderToString } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { SidebarView, TabBar } from "./Sidebar.tsx";
import { Shell } from "./Shell.tsx";

function renderShell(path: string, collapsed = false) {
  return renderToString(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          element={
            <div className={collapsed ? "shell shell--sidebar-collapsed" : "shell"}>
              <SidebarView
                collapsed={collapsed}
                onToggleCollapsed={() => undefined}
                displayName="Илья"
                initials="ИВ"
                meetingCount={3}
                usedBytes={184 * 1024 * 1024}
              />
              <div className="workspace">
                <main className="workspace__main">
                  <p>контент</p>
                </main>
              </div>
            </div>
          }
        >
          <Route path="*" element={null} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("Shell / Sidebar v2", () => {
  it("на Календаре показывает nav без Интеграций и липкий подвал", () => {
    const html = renderShell("/calendar");
    expect(html).toContain("Главная");
    expect(html).toContain("Календарь");
    expect(html).toContain("Транскрибации");
    expect(html).toContain("Настройки");
    expect(html).not.toContain("Интеграции");
    expect(html).not.toContain("Команда");
    expect(html).not.toContain("Биллинг");
    expect(html).not.toContain("Календарь выключен");
    expect(html).toContain("3 расшифровки · 184 МБ");
    expect(html).toContain("На этом компьютере, без облачной квоты");
    expect(html).toContain("Илья");
    expect(html).toContain("этот компьютер");
    expect(html).toContain("Выйти");
    expect(html).toContain('aria-label="Свернуть меню"');
    expect(html).toContain('data-icon="house"');
    expect(html).toContain('data-icon="calendar"');
    expect(html).toContain('data-icon="file-text"');
    expect(html).toContain('data-icon="settings"');
    expect(html).toContain("sidebar__storage-track");
    expect(html).not.toContain("встречи и протоколы");
    expect(html).not.toContain("Поиск по встречам");
    expect(html).not.toContain("Уведомления");
  });

  it("в collapsed режиме показывает компактное хранилище и аватар", () => {
    const html = renderShell("/meetings/demo-id", true);
    expect(html).toContain("sidebar--collapsed");
    expect(html).toContain('aria-label="Развернуть меню"');
    expect(html).toContain(">184<");
    expect(html).toContain(">ИВ<");
    expect(html).not.toContain("Выйти");
    expect(html).not.toContain("Календарь выключен");
  });
});

describe("Shell route defaults", () => {
  it("экспортирует Shell с outlet", () => {
    const html = renderToString(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route element={<Shell />}>
            <Route path="/" element={<p>главная</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(html).toContain("PM Assistant");
    expect(html).toContain("главная");
    expect(html).not.toContain("Поиск по встречам");
    expect(html).not.toContain("Уведомления");
    expect(html).not.toContain("topbar");
  });

  it("на экране встречи фиксирует высоту рабочей области", () => {
    const html = renderToString(
      <MemoryRouter initialEntries={["/meetings/abc"]}>
        <Routes>
          <Route element={<Shell />}>
            <Route path="/meetings/:id" element={<p>встреча</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(html).toContain("shell--lock");
    expect(html).toContain("workspace__main--lock");
    expect(html).toContain("встреча");
  });
});

describe("TabBar", () => {
  function renderTabBar(path: string) {
    return renderToString(
      <MemoryRouter initialEntries={[path]}>
        <TabBar />
      </MemoryRouter>,
    );
  }

  it("рендерит 4 вкладки с иконкой, подписью и ссылкой на нужный роут", () => {
    const html = renderTabBar("/");
    expect(html).toContain('data-icon="house"');
    expect(html).toContain('data-icon="calendar"');
    expect(html).toContain('data-icon="file-text"');
    expect(html).toContain('data-icon="settings"');
    expect(html).toContain('href="/calendar"');
    expect(html).toContain('href="/archive"');
    expect(html).toContain('href="/settings"');
    expect(html).toContain("Главная");
    expect(html).toContain("Календарь");
    expect(html).toContain("Архив");
    expect(html).toContain("Настройки");
  });

  it("на Главной подсвечен таб Главная, остальные — нет", () => {
    const html = renderTabBar("/");
    const tabs = html.split("<a ").slice(1);
    expect(tabs).toHaveLength(4);
    expect(tabs[0]).toContain("tabbar__item--active");
    expect(tabs[1]).not.toContain("tabbar__item--active");
    expect(tabs[2]).not.toContain("tabbar__item--active");
    expect(tabs[3]).not.toContain("tabbar__item--active");
  });

  it("на Архиве подсвечен таб Архив, Главная — нет", () => {
    const html = renderTabBar("/archive");
    const tabs = html.split("<a ").slice(1);
    expect(tabs[0]).not.toContain("tabbar__item--active");
    expect(tabs[2]).toContain("tabbar__item--active");
  });
});
