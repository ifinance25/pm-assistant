import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Settings } from "../../../shared/types.ts";
import { SettingsView, type ProjectRow } from "./SettingsView.tsx";

const settings: Settings = {
  recordingModeDefault: "text",
  trackerType: "clickup",
  llmProvider: "claude",
  asanaProjectLabel: "",
  asanaAutoSend: false,
  webhookUrl: "",
  workerHeartbeatAt: null,
};

const demoProjects: ProjectRow[] = [
  {
    key: "svoi",
    id: "svoi",
    name: "Свои",
    trackerProjectRef: "",
    trackerParentRef: "",
    meetingCount: 12,
    mode: "view",
    pendingDelete: false,
  },
  {
    key: "onb",
    id: "onb",
    name: "Onboarding",
    trackerProjectRef: "https://app.clickup.com/123",
    trackerParentRef: "ONB",
    meetingCount: 3,
    mode: "view",
    pendingDelete: false,
  },
  {
    key: "road",
    id: "road",
    name: "Roadmap Q4",
    trackerProjectRef: "https://app.clickup.com/q4",
    trackerParentRef: "ROAD-100",
    meetingCount: 4,
    mode: "edit",
    pendingDelete: false,
  },
  {
    key: "client",
    id: "client",
    name: "Клиентский прототип",
    trackerProjectRef: "",
    trackerParentRef: "",
    meetingCount: 0,
    mode: "delete_confirm",
    pendingDelete: false,
  },
  {
    key: "new-1",
    id: null,
    name: "",
    trackerProjectRef: "",
    trackerParentRef: "",
    meetingCount: 0,
    mode: "new",
    pendingDelete: false,
  },
];

function render(extra: Partial<Parameters<typeof SettingsView>[0]> = {}) {
  return renderToString(
    <SettingsView settings={settings} projects={demoProjects} {...extra} />,
  );
}

describe("SettingsView", () => {
  it("в режимах new и edit в строке есть Сохранить рядом с Отмена", () => {
    const html = render();
    const newRow = html.split("settings__row--new")[1] ?? "";
    const editRow = html.split("settings__row--edit")[1] ?? "";
    expect(newRow).toContain("Сохранить");
    expect(newRow).toContain("Отмена");
    expect(editRow).toContain("Сохранить");
    expect(editRow).toContain("Отмена");
  });

  it("показывает таблицу проектов со всеми режимами строки и глобальную Сохранить", () => {
    const html = render();
    expect(html).toContain("Настройки");
    expect(html).toContain("Таблица проектов, трекер задач и режим записи");
    expect(html).toContain("Проекты");
    expect(html).toContain("Добавить проект");
    expect(html).toContain("Сохранить");
    expect(html).toContain("Проект");
    expect(html).toContain("Ссылка в трекере");
    expect(html).toContain("Родитель");
    expect(html).toContain("Расшифровок");
    expect(html).toContain("Свои");
    expect(html).toContain("Onboarding");
    expect(html).toContain("изменить");
    expect(html).toContain("удалить");
    expect(html).toContain("settings__row--edit");
    expect(html).toContain("Roadmap Q4");
    expect(html).toContain("placeholder=\"Название\"");
    expect(html).toContain("https://.../projects/KEY");
    expect(html).toContain("EPIC-1");
    expect(html).toContain("Отмена");
    expect(html).toContain("settings__row--new");
    expect(html).toContain("Удалить проект «Клиентский прототип»?");
    expect(html).toContain("settings__row--delete");
    expect(html).not.toContain("Автоотправка в Asana");
    expect(html).not.toContain("ASANA_PAT");
    expect(html).not.toContain("Outlook");
    expect(html).not.toContain("\u2014");
  });

  it("показывает три режима записи крупными рядами, выбранный с терракотовой точкой", () => {
    const html = render();
    expect(html).toContain("Режим записи");
    expect(html).toContain("Только текст");
    expect(html).toContain("Локальный звук");
    expect(html).toContain("Полная запись");
    expect(html).toContain("settings__mode--active");
    expect(html).toContain("settings__dot");
    expect(html).toContain("Без сохранения звука. Транскрипт и резюме остаются в базе.");
    expect(html).toContain("Аудио остаётся на этом Mac, в облако не уходит.");
    expect(html).toContain("Звук, транскрипт, резюме и решения. Удалять вручную.");
  });

  it("показывает picker трекера Asana Trello ClickUp Notion", () => {
    const html = render();
    expect(html).toContain("id=\"integrations\"");
    expect(html).toContain("Интеграции");
    expect(html).toContain("Asana");
    expect(html).toContain("Trello");
    expect(html).toContain("ClickUp");
    expect(html).toContain("Notion");
    expect(html).toContain("Подключить ClickUp");
    expect(html).toContain("Google Календарь");
    expect(html).toContain("не подключён");
    expect(html).toContain("Подключить Google Календарь");
    expect(html).toContain("Локальный список встреч");
    expect(html).toContain("активен на этом компьютере");
    expect(html).toContain("LLM для расшифровки");
    expect(html).toContain("активный: Claude");
    expect(html).toContain("settings__llm-row");
    expect(html).toContain("Подключить Kimi");
    expect(html).not.toContain("Jira");
  });

  it("показывает отключение только у подключённых LLM-провайдеров", () => {
    const html = render({
      llmConnections: {
        claude: true,
        openai: false,
        cursor: false,
        kimi: false,
      },
    });
    expect(html).toContain("Отключить Claude");
    expect(html).toContain("Подключить Kimi");
    expect(html).not.toContain("Отключить Kimi");
  });

  it("показывает кнопки отключения трекера и календаря, когда они подключены", () => {
    const html = render({
      googleCalendarConnected: true,
      trackerConnected: true,
    });
    expect(html).toContain("подключён");
    expect(html).toContain("Отключить");
    expect(html).toContain("Отключить ClickUp");
  });

  it("показывает почту аккаунта у подключённого Google Календаря", () => {
    const html = render({
      googleCalendarConnected: true,
      googleCalendarAccount: "ilya@example.com",
    });
    expect(html).toContain("подключён · ilya@example.com");
  });

  it("показывает кнопку перезапуска бота и скрывает диалог", () => {
    const html = render();
    expect(html).toContain("Сервис бота");
    expect(html).toContain(
      "Зависшие встречи снимутся, контейнеры и воркер на сервере перезапустятся.",
    );
    expect(html).toContain("Перезапустить бота");
    expect(html).not.toContain("Нужно ли перезапустить бота?");
    expect(html).not.toContain("role=\"dialog\"");
    expect(html).not.toContain("\u2014");
  });

  it("показывает диалог с кнопками Да и Нет, когда он открыт", () => {
    const html = render({ restartDialogOpen: true });
    expect(html).toContain("Нужно ли перезапустить бота?");
    expect(html).toContain("Да");
    expect(html).toContain("Нет");
    expect(html).toContain("role=\"dialog\"");
    expect(html).toContain("aria-modal");
    expect(html).toContain("aria-labelledby=\"settings-restart-title\"");
    expect(html).not.toContain("\u2014");
  });

  it("показывает версию приложения внизу экрана", () => {
    const html = render();
    expect(html).toContain("settings__version");
    expect(html).toContain("PM Assistant · v0.2.8");
  });

  it("показывает кнопку очереди транскрибации и модалку с таблицей", () => {
    const html = render();
    expect(html).toContain("Очередь транскрибации");
    expect(html).not.toContain("settings__queue-table");

    const openHtml = render({
      queueDialogOpen: true,
      queueItems: [
        {
          job: {
            id: "job-1",
            meetingId: "m-1",
            type: "transcribe",
            status: "running",
            attempts: 1,
            lastError: null,
            claimedAt: "2026-09-05T10:00:00.000Z",
            createdAt: "2026-09-05T09:55:00.000Z",
          },
          meeting: {
            id: "m-1",
            title: "Созвон",
            url: "https://zoom.us/j/1",
            status: "transcribing",
          },
          queuedAt: "2026-09-05T09:55:00.000Z",
          processingMs: 120_000,
          transcribeProgress: {
            percent: 40,
            etaAt: "2026-09-05T10:30:00.000Z",
            remainingMs: 1_800_000,
            transcribedMs: 120_000,
            audioDurationMs: 300_000,
            startedAt: "2026-09-05T10:00:00.000Z",
          },
        },
      ],
    });
    expect(openHtml).toContain("settings__queue-table");
    expect(openHtml).toContain("Добавлено в очередь");
    expect(openHtml).toContain("В обработке");
    expect(openHtml).toContain("Осталось");
    expect(openHtml).toContain("в работе · расшифровка");
    expect(openHtml).toContain("Созвон");
    expect(openHtml).toContain("Обновить");
    expect(openHtml).toContain("Закрыть");
    expect(openHtml).not.toContain("\u2014");
  });
});
