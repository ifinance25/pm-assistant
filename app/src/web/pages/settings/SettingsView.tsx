import type { RecordingMode, Settings, TrackerType } from "../../../shared/types.ts";
import { TRACKER_LABELS, TRACKER_TYPES } from "../../../shared/types.ts";
import { APP_VERSION } from "../../../shared/version.ts";

const MODES: { id: RecordingMode; title: string; short: string; text: string }[] =
  [
    {
      id: "text",
      title: "Только текст",
      short: "только текст",
      text: "Без сохранения звука. Транскрипт и резюме остаются в базе.",
    },
    {
      id: "local_audio",
      title: "Локальный звук",
      short: "локальный звук",
      text: "Аудио остаётся на этом Mac, в облако не уходит.",
    },
    {
      id: "full",
      title: "Полная запись",
      short: "полная запись",
      text: "Звук, транскрипт, резюме и решения. Удалять вручную.",
    },
  ];

export type ProjectRowMode = "view" | "edit" | "new" | "delete_confirm";

export type ProjectRow = {
  key: string;
  id: string | null;
  name: string;
  trackerProjectRef: string;
  trackerParentRef: string;
  meetingCount: number;
  mode: ProjectRowMode;
  pendingDelete: boolean;
};

export type SettingsViewProps = {
  settings: Settings;
  projects: ProjectRow[];
  saving?: boolean;
  restartDialogOpen?: boolean;
  restarting?: boolean;
  googleCalendarConnected?: boolean;
  trackerConnected?: boolean;
  tableError?: string | null;
  onRecordingModeChange?: (mode: RecordingMode) => void;
  onTrackerTypeChange?: (type: TrackerType) => void;
  onSave?: () => void;
  onAddProject?: () => void;
  onRowFieldChange?: (
    key: string,
    field: "name" | "trackerProjectRef" | "trackerParentRef",
    value: string,
  ) => void;
  onRowMode?: (key: string, mode: ProjectRowMode) => void;
  onRowCancel?: (key: string) => void;
  onConfirmDelete?: (key: string) => void;
  onConnectTracker?: () => void;
  onDisconnectTracker?: () => void;
  onConnectGoogle?: () => void;
  onDisconnectGoogle?: () => void;
  onRestartClick?: () => void;
  onRestartConfirm?: () => void;
  onRestartCancel?: () => void;
};

function rowClass(row: ProjectRow): string {
  const parts = ["settings__row"];
  if (row.mode === "edit") {
    parts.push("settings__row--edit");
  }
  if (row.mode === "new") {
    parts.push("settings__row--new");
  }
  if (row.mode === "delete_confirm") {
    parts.push("settings__row--delete");
  }
  if (row.pendingDelete) {
    parts.push("settings__row--pending-delete");
  }
  return parts.join(" ");
}

export function SettingsView({
  settings,
  projects,
  saving = false,
  restartDialogOpen = false,
  restarting = false,
  googleCalendarConnected = false,
  trackerConnected = false,
  tableError = null,
  onRecordingModeChange,
  onTrackerTypeChange,
  onSave,
  onAddProject,
  onRowFieldChange,
  onRowMode,
  onRowCancel,
  onConfirmDelete,
  onConnectTracker,
  onDisconnectTracker,
  onConnectGoogle,
  onDisconnectGoogle,
  onRestartClick,
  onRestartConfirm,
  onRestartCancel,
}: SettingsViewProps) {
  const trackerLabel = TRACKER_LABELS[settings.trackerType];

  return (
    <section className="settings">
      <header className="settings__top">
        <h1 className="settings__title">Настройки</h1>
        <p className="settings__lead">
          Таблица проектов, трекер задач и режим записи
        </p>
      </header>

      <section className="settings__panel settings__projects">
        <div className="settings__panel-head">
          <h2 className="settings__panel-title">Проекты</h2>
          <div className="settings__panel-actions">
            <button
              type="button"
              className="settings__add"
              onClick={() => onAddProject?.()}
            >
              Добавить проект
            </button>
            <button
              type="button"
              className="settings__save"
              onClick={() => onSave?.()}
              disabled={saving}
            >
              Сохранить
            </button>
          </div>
        </div>
        {tableError ? <p className="settings__error">{tableError}</p> : null}
        <div className="settings__table-wrap">
          <table className="settings__table">
            <thead>
              <tr>
                <th>Проект</th>
                <th>Ссылка в трекере</th>
                <th>Родитель</th>
                <th>Расшифровок</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((row) => (
                <tr key={row.key} className={rowClass(row)}>
                  {row.mode === "delete_confirm" ? (
                    <td colSpan={5}>
                      <div className="settings__delete-bar">
                        <span>
                          {`Удалить проект «${row.name || "Без названия"}»?`}
                        </span>
                        <button
                          type="button"
                          className="settings__row-danger"
                          onClick={() => onConfirmDelete?.(row.key)}
                        >
                          Удалить
                        </button>
                        <button
                          type="button"
                          className="settings__row-ghost"
                          onClick={() => onRowCancel?.(row.key)}
                        >
                          Отмена
                        </button>
                      </div>
                    </td>
                  ) : row.mode === "edit" || row.mode === "new" ? (
                    <>
                      <td>
                        <input
                          className="settings__cell-input"
                          value={row.name}
                          placeholder="Название"
                          aria-label="Название проекта"
                          onChange={(event) =>
                            onRowFieldChange?.(
                              row.key,
                              "name",
                              event.currentTarget.value,
                            )
                          }
                        />
                      </td>
                      <td>
                        <input
                          className="settings__cell-input"
                          value={row.trackerProjectRef}
                          placeholder="https://.../projects/KEY"
                          aria-label="Ссылка в трекере"
                          onChange={(event) =>
                            onRowFieldChange?.(
                              row.key,
                              "trackerProjectRef",
                              event.currentTarget.value,
                            )
                          }
                        />
                      </td>
                      <td>
                        <input
                          className="settings__cell-input"
                          value={row.trackerParentRef}
                          placeholder="EPIC-1"
                          aria-label="Родитель в трекере"
                          onChange={(event) =>
                            onRowFieldChange?.(
                              row.key,
                              "trackerParentRef",
                              event.currentTarget.value,
                            )
                          }
                        />
                      </td>
                      <td>{row.meetingCount}</td>
                      <td>
                        <button
                          type="button"
                          className="settings__row-link"
                          onClick={() => onSave?.()}
                          disabled={saving}
                        >
                          Сохранить
                        </button>
                        <button
                          type="button"
                          className="settings__row-ghost"
                          onClick={() => onRowCancel?.(row.key)}
                        >
                          Отмена
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td>
                        <strong>{row.name || "Без названия"}</strong>
                        {row.pendingDelete ? (
                          <span className="settings__pending">к удалению</span>
                        ) : null}
                      </td>
                      <td>{row.trackerProjectRef || "нет"}</td>
                      <td>{row.trackerParentRef || "нет"}</td>
                      <td>{row.meetingCount}</td>
                      <td>
                        {row.pendingDelete ? (
                          <button
                            type="button"
                            className="settings__row-ghost"
                            onClick={() => onRowCancel?.(row.key)}
                          >
                            Отмена
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="settings__row-link"
                              onClick={() => onRowMode?.(row.key, "edit")}
                            >
                              изменить
                            </button>
                            <button
                              type="button"
                              className="settings__row-link"
                              onClick={() =>
                                onRowMode?.(row.key, "delete_confirm")
                              }
                            >
                              удалить
                            </button>
                          </>
                        )}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="settings__split">
        <section className="settings__panel">
          <h2 className="settings__panel-title">Режим записи</h2>
          <fieldset className="settings__modes">
            <legend>Режим записи по умолчанию</legend>
            {MODES.map((mode) => {
              const selected = settings.recordingModeDefault === mode.id;
              return (
                <label
                  key={mode.id}
                  className={
                    selected
                      ? "settings__mode settings__mode--active"
                      : "settings__mode"
                  }
                >
                  <input
                    type="radio"
                    name="recordingModeDefault"
                    value={mode.id}
                    checked={selected}
                    onChange={() => onRecordingModeChange?.(mode.id)}
                  />
                  <span
                    className={
                      selected
                        ? "settings__dot settings__dot--on"
                        : "settings__dot"
                    }
                    aria-hidden="true"
                  />
                  <span>
                    <strong>{mode.title}</strong>
                    <span>{mode.text}</span>
                  </span>
                </label>
              );
            })}
          </fieldset>
          <p className="settings__hint">
            Распознавание речи на русском. Сейчас: заглушка STT, пока локальный
            движок не найден.
          </p>
        </section>

        <section
          className="settings__panel settings__integrations"
          id="integrations"
        >
          <h2 className="settings__panel-title">Интеграции</h2>
          <div className="settings__integration">
            <div>
              <strong>Google Календарь</strong>
              <span className="settings__status">
                {googleCalendarConnected ? "подключён" : "не подключён"}
              </span>
            </div>
            {googleCalendarConnected ? (
              <button
                type="button"
                className="settings__connect"
                onClick={() => onDisconnectGoogle?.()}
              >
                Отключить
              </button>
            ) : (
              <button
                type="button"
                className="settings__connect"
                onClick={() => onConnectGoogle?.()}
              >
                Подключить Google Календарь
              </button>
            )}
          </div>
          <div className="settings__integration">
            <div>
              <strong>Трекер задач</strong>
              <span className="settings__status">
                {trackerConnected
                  ? `${trackerLabel}: подключён`
                  : `${trackerLabel}: не подключён`}
              </span>
            </div>
            <div
              className="settings__trackers"
              role="radiogroup"
              aria-label="Трекер задач"
            >
              {TRACKER_TYPES.map((type) => {
                const selected = settings.trackerType === type;
                return (
                  <label
                    key={type}
                    className={
                      selected
                        ? "settings__tracker settings__tracker--active"
                        : "settings__tracker"
                    }
                  >
                    <input
                      type="radio"
                      name="trackerType"
                      value={type}
                      checked={selected}
                      onChange={() => onTrackerTypeChange?.(type)}
                    />
                    {TRACKER_LABELS[type]}
                  </label>
                );
              })}
            </div>
            {trackerConnected ? (
              <button
                type="button"
                className="settings__connect"
                onClick={() => onDisconnectTracker?.()}
              >
                {`Отключить ${trackerLabel}`}
              </button>
            ) : (
              <button
                type="button"
                className="settings__connect"
                onClick={() => onConnectTracker?.()}
              >
                {`Подключить ${trackerLabel}`}
              </button>
            )}
          </div>
          <div className="settings__integration">
            <div>
              <strong>Локальный список встреч</strong>
              <span className="settings__status">активен на этом компьютере</span>
            </div>
          </div>
        </section>
      </div>

      <section className="settings__panel settings__bot">
        <h2 className="settings__panel-title">Сервис бота</h2>
        <p className="settings__hint">
          Зависшие встречи снимутся, контейнеры и воркер на сервере
          перезапустятся.
        </p>
        <button
          type="button"
          className="settings__restart"
          onClick={() => onRestartClick?.()}
          disabled={restarting}
        >
          Перезапустить бота
        </button>
      </section>

      <footer className="settings__version">
        {`PM Assistant · v${APP_VERSION}`}
      </footer>
      {restartDialogOpen ? (
        <div className="settings__dialog-backdrop">
          <div
            className="settings__dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-restart-title"
          >
            <h2 id="settings-restart-title">Нужно ли перезапустить бота?</h2>
            <div className="settings__dialog-actions">
              <button
                type="button"
                className="settings__dialog-no"
                onClick={() => onRestartCancel?.()}
                disabled={restarting}
              >
                Нет
              </button>
              <button
                type="button"
                className="settings__dialog-yes"
                onClick={() => onRestartConfirm?.()}
                disabled={restarting}
              >
                Да
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
