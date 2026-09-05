import { renderToString } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { SidebarView } from "./Sidebar.tsx";
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
    expect(html).toContain("Расшифровки");
    expect(html).toContain("Настройки");
    expect(html).not.toContain("Интеграции");
    expect(html).not.toContain("Команда");
    expect(html).not.toContain("Биллинг");
    expect(html).toContain("Календарь выключен");
    expect(html).toContain("В этой версии бот идёт только по ссылке");
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
});
