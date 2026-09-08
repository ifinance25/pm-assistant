import { useEffect, useState } from "react";
import type {
  LlmProvider,
  RecordingMode,
  Settings,
  TrackerType,
  TranscriptionQueueItem,
} from "../../../shared/types.ts";
import {
  LLM_PROVIDERS,
  LLM_PROVIDER_LABELS,
  TRACKER_LABELS,
  TRACKER_TYPES,
  emptyLlmConnections,
  type LlmConnections,
} from "../../../shared/types.ts";
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
  googleCalendarAccount?: string | null;
  googleClientId?: string;
  googleClientSecretSet?: boolean;
  googleDialogOpen?: boolean;
  googleDialogBusy?: boolean;
  googleDialogError?: string | null;
  trackerConnected?: boolean;
  llmConnections?: LlmConnections;
  llmDialogProvider?: LlmProvider | null;
  llmDialogOpen?: boolean;
  llmDialogInstructions?: string | null;
  llmDialogBusy?: boolean;
  llmDialogError?: string | null;
  tableError?: string | null;
  onRecordingModeChange?: (mode: RecordingMode) => void;
  onTrackerTypeChange?: (type: TrackerType) => void;
  onLlmProviderChange?: (provider: LlmProvider) => void;
  onConnectLlm?: (provider: LlmProvider) => void;
  onDisconnectLlm?: (provider: LlmProvider) => void;
  onLlmCodeSubmit?: (value: string) => void;
  onLlmDialogClose?: () => void;
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
  onGoogleCredentialsClick?: () => void;
  onGoogleCredentialsSubmit?: (clientId: string, clientSecret: string) => void;
  onGoogleDialogClose?: () => void;
  onRestartClick?: () => void;
  onRestartConfirm?: () => void;
  onRestartCancel?: () => void;
  logDialogOpen?: boolean;
  logLoading?: boolean;
  logText?: string | null;
  onLogsClick?: () => void;
  onLogsRefresh?: () => void;
  onLogsClose?: () => void;
  queueDialogOpen?: boolean;
  queueLoading?: boolean;
  queueItems?: TranscriptionQueueItem[];
  queueError?: string | null;
  onQueueClick?: () => void;
  onQueueRefresh?: () => void;
  onQueueClose?: () => void;
};

const JOB_TYPE_LABELS: Record<string, string> = {
  join: "вход",
  transcribe: "расшифровка",
  summarize: "резюме",
};

const JOB_STATUS_LABELS: Record<string, string> = {
  pending: "ожидает",
  running: "в работе",
};

const MEETING_STATUS_LABELS: Record<string, string> = {
  queued: "в очереди",
  joining: "подключение",
  waiting_room: "зал ожидания",
  recording: "запись",
  transcribing: "расшифровка",
  summarizing: "резюме",
  ready: "готово",
  error: "ошибка",
};

function formatQueuedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatEtaClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function formatRemaining(ms: number): string {
  const totalMin = Math.max(1, Math.round(ms / 60_000));
  if (totalMin < 60) {
    return `${totalMin} мин`;
  }
  const hours = Math.floor(totalMin / 60);
  const rest = totalMin % 60;
  return rest === 0 ? `${hours} ч` : `${hours} ч ${rest} мин`;
}

function formatProcessingMs(ms: number): string {
  const totalMin = Math.max(1, Math.round(ms / 60_000));
  if (totalMin < 60) {
    return `${totalMin} мин`;
  }
  const hours = Math.floor(totalMin / 60);
  const rest = totalMin % 60;
  return rest === 0 ? `${hours} ч` : `${hours} ч ${rest} мин`;
}

function formatEta(item: TranscriptionQueueItem): string {
  const progress = item.transcribeProgress;
  if (!progress?.etaAt || progress.remainingMs == null) {
    return "—";
  }
  const percent = Math.max(0, Math.round(progress.percent));
  return `${percent}%, ~${formatEtaClock(progress.etaAt)}, осталось ${formatRemaining(progress.remainingMs)}`;
}

function jobTypeLabel(type: string): string {
  return JOB_TYPE_LABELS[type] ?? type;
}

function jobStatusLabel(status: string): string {
  return JOB_STATUS_LABELS[status] ?? status;
}

function meetingStatusLabel(status: string): string {
  return MEETING_STATUS_LABELS[status] ?? status;
}

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
  googleCalendarAccount = null,
  googleClientId = "",
  googleClientSecretSet = false,
  googleDialogOpen = false,
  googleDialogBusy = false,
  googleDialogError = null,
  trackerConnected = false,
  llmConnections = emptyLlmConnections(),
  llmDialogProvider = null,
  llmDialogOpen = false,
  llmDialogInstructions = null,
  llmDialogBusy = false,
  llmDialogError = null,
  tableError = null,
  onRecordingModeChange,
  onTrackerTypeChange,
  onLlmProviderChange,
  onConnectLlm,
  onDisconnectLlm,
  onLlmCodeSubmit,
  onLlmDialogClose,
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
  onGoogleCredentialsClick,
  onGoogleCredentialsSubmit,
  onGoogleDialogClose,
  onRestartClick,
  onRestartConfirm,
  onRestartCancel,
  logDialogOpen = false,
  logLoading = false,
  logText = null,
  onLogsClick,
  onLogsRefresh,
  onLogsClose,
  queueDialogOpen = false,
  queueLoading = false,
  queueItems = [],
  queueError = null,
  onQueueClick,
  onQueueRefresh,
  onQueueClose,
}: SettingsViewProps) {
  const trackerLabel = TRACKER_LABELS[settings.trackerType];
  const activeLlmLabel = LLM_PROVIDER_LABELS[settings.llmProvider];
  const dialogLlmLabel = llmDialogProvider
    ? LLM_PROVIDER_LABELS[llmDialogProvider]
    : activeLlmLabel;
  const [llmInput, setLlmInput] = useState("");
  const [googleClientIdInput, setGoogleClientIdInput] = useState(googleClientId);
  const [googleClientSecretInput, setGoogleClientSecretInput] = useState("");
  useEffect(() => {
    if (googleDialogOpen) {
      setGoogleClientIdInput(googleClientId);
      setGoogleClientSecretInput("");
    }
  }, [googleDialogOpen, googleClientId]);

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
                {googleCalendarConnected
                  ? googleCalendarAccount
                    ? `подключён · ${googleCalendarAccount}`
                    : "подключён"
                  : "не подключён"}
              </span>
              <span className="settings__status">
                {googleClientId && googleClientSecretSet
                  ? "Client ID и Secret настроены"
                  : "Client ID / Secret не настроены"}
              </span>
            </div>
            <button
              type="button"
              className="settings__connect"
              onClick={() => onGoogleCredentialsClick?.()}
            >
              {googleClientId && googleClientSecretSet
                ? "Изменить Client ID/Secret"
                : "Настроить Client ID/Secret"}
            </button>
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
                disabled={!googleClientId || !googleClientSecretSet}
              >
                Подключить Google Календарь
              </button>
            )}
          </div>
          <p className="settings__hint">
            Client ID и Secret из Google Cloud Console. Один и тот же ключ
            используется и для входа через Google, и для календаря. Secret
            сохраняется в env-файл окружения (локально `.env`, на сервере
            `/etc/pm-assistant.env`) и не показывается повторно.
          </p>
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
          <div className="settings__integration settings__integration--llm">
            <div>
              <strong>LLM для расшифровки</strong>
              <span className="settings__status">
                {`активный: ${activeLlmLabel}`}
                {llmConnections[settings.llmProvider]
                  ? " · подключён"
                  : " · не подключён"}
              </span>
            </div>
            <div
              className="settings__llm-list"
              role="radiogroup"
              aria-label="Активный провайдер LLM"
            >
              {LLM_PROVIDERS.map((provider) => {
                const selected = settings.llmProvider === provider;
                const connected = llmConnections[provider];
                const label = LLM_PROVIDER_LABELS[provider];
                return (
                  <div
                    key={provider}
                    className={
                      selected
                        ? "settings__llm-row settings__llm-row--active"
                        : "settings__llm-row"
                    }
                  >
                    <label className="settings__llm-choice">
                      <input
                        type="radio"
                        name="llmProvider"
                        value={provider}
                        checked={selected}
                        onChange={() => onLlmProviderChange?.(provider)}
                      />
                      <span className="settings__llm-name">{label}</span>
                      <span
                        className={
                          connected
                            ? "settings__llm-badge settings__llm-badge--on"
                            : "settings__llm-badge"
                        }
                      >
                        {connected ? "подключён" : "не подключён"}
                      </span>
                    </label>
                    {connected ? (
                      <button
                        type="button"
                        className="settings__llm-action"
                        onClick={() => onDisconnectLlm?.(provider)}
                      >
                        {`Отключить ${label}`}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="settings__llm-action settings__llm-action--connect"
                        onClick={() => onConnectLlm?.(provider)}
                      >
                        {`Подключить ${label}`}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="settings__hint">
              Радиокнопка выбирает, какой провайдер использует воркер после
              «Сохранить». Подключение и отключение у каждого провайдера своё.
              Токен сохраняется в env-файл окружения (локально `.env`, на сервере
              `/etc/pm-assistant.env`). Cursor вызывает локальный CLI `agent`
              (режим ask), не Cloud Agents API.
            </p>
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
        <button
          type="button"
          className="settings__logs-button"
          onClick={() => onLogsClick?.()}
        >
          Журнал подключений
        </button>
        <button
          type="button"
          className="settings__logs-button"
          onClick={() => onQueueClick?.()}
        >
          Очередь транскрибации
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
      {logDialogOpen ? (
        <div className="settings__dialog-backdrop">
          <div
            className="settings__dialog settings__log-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-logs-title"
          >
            <h2 id="settings-logs-title">Журнал подключений</h2>
            {logLoading ? (
              <p className="settings__hint">Загрузка...</p>
            ) : logText === "no-systemd" ? (
              <p className="settings__hint">
                Логи доступны только на боевом сервере. В локальной разработке
                смотрите вывод в терминале.
              </p>
            ) : logText ? (
              <pre className="settings__log-body">{logText}</pre>
            ) : (
              <p className="settings__hint">Не удалось загрузить логи.</p>
            )}
            <div className="settings__dialog-actions">
              <button
                type="button"
                className="settings__dialog-no"
                onClick={() => onLogsRefresh?.()}
                disabled={logLoading}
              >
                Обновить
              </button>
              <button
                type="button"
                className="settings__dialog-yes"
                onClick={() => onLogsClose?.()}
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {llmDialogOpen ? (
        <div className="settings__dialog-backdrop">
          <div
            className="settings__dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-llm-title"
          >
            <h2 id="settings-llm-title">Подключение {dialogLlmLabel}</h2>
            {llmDialogInstructions ? (
              <p className="settings__hint">{llmDialogInstructions}</p>
            ) : null}
            {llmDialogError ? (
              <p className="settings__error">{llmDialogError}</p>
            ) : null}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const value = llmInput.trim();
                if (!value) {
                  return;
                }
                onLlmCodeSubmit?.(value);
              }}
            >
              <input
                key={llmDialogProvider ?? "none"}
                className="settings__cell-input settings__llm-input"
                value={llmInput}
                onChange={(event) => setLlmInput(event.target.value)}
                placeholder={
                  llmDialogProvider === "claude"
                    ? "Код авторизации Claude"
                    : llmDialogProvider === "kimi"
                      ? "KIMI_API_KEY"
                      : llmDialogProvider === "cursor"
                        ? "CURSOR_API_KEY"
                        : "OPENAI_API_KEY"
                }
                aria-label="Код или токен авторизации"
                disabled={llmDialogBusy}
              />
              <div className="settings__dialog-actions">
                <button
                  type="button"
                  className="settings__dialog-no"
                  onClick={() => onLlmDialogClose?.()}
                  disabled={llmDialogBusy}
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  className="settings__dialog-yes"
                  disabled={llmDialogBusy || !llmInput.trim()}
                >
                  Сохранить
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
      {googleDialogOpen ? (
        <div className="settings__dialog-backdrop">
          <div
            className="settings__dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-google-title"
          >
            <h2 id="settings-google-title">Google Client ID/Secret</h2>
            <p className="settings__hint">
              Возьмите значения в Google Cloud Console (OAuth client). Один
              ключ работает и для входа через Google, и для календаря.
            </p>
            {googleDialogError ? (
              <p className="settings__error">{googleDialogError}</p>
            ) : null}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const clientId = googleClientIdInput.trim();
                const clientSecret = googleClientSecretInput.trim();
                if (!clientId || !clientSecret) {
                  return;
                }
                onGoogleCredentialsSubmit?.(clientId, clientSecret);
              }}
            >
              <input
                className="settings__cell-input settings__llm-input"
                value={googleClientIdInput}
                onChange={(event) => setGoogleClientIdInput(event.target.value)}
                placeholder="Client ID"
                aria-label="Google Client ID"
                disabled={googleDialogBusy}
              />
              <input
                type="password"
                className="settings__cell-input settings__llm-input"
                value={googleClientSecretInput}
                onChange={(event) => setGoogleClientSecretInput(event.target.value)}
                placeholder="Client Secret"
                aria-label="Google Client Secret"
                disabled={googleDialogBusy}
              />
              <div className="settings__dialog-actions">
                <button
                  type="button"
                  className="settings__dialog-no"
                  onClick={() => onGoogleDialogClose?.()}
                  disabled={googleDialogBusy}
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  className="settings__dialog-yes"
                  disabled={
                    googleDialogBusy ||
                    !googleClientIdInput.trim() ||
                    !googleClientSecretInput.trim()
                  }
                >
                  Сохранить
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
      {queueDialogOpen ? (
        <div className="settings__dialog-backdrop">
          <div
            className="settings__dialog settings__queue-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-queue-title"
          >
            <h2 id="settings-queue-title">Очередь транскрибации</h2>
            {queueLoading && queueItems.length === 0 ? (
              <p className="settings__hint">Загрузка...</p>
            ) : queueError ? (
              <p className="settings__error">{queueError}</p>
            ) : queueItems.length === 0 ? (
              <p className="settings__hint">Активных заданий нет.</p>
            ) : (
              <div className="settings__queue-table-wrap">
                <table className="settings__queue-table">
                  <thead>
                    <tr>
                      <th>Добавлено в очередь</th>
                      <th>Статус</th>
                      <th>В обработке</th>
                      <th>Осталось</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queueItems.map((item) => (
                      <tr key={item.job.id}>
                        <td>{formatQueuedAt(item.queuedAt)}</td>
                        <td>
                          <div>{`${jobStatusLabel(item.job.status)} · ${jobTypeLabel(item.job.type)}`}</div>
                          <div className="settings__queue-sub">
                            {item.meeting.title || item.meeting.url}
                            {` · ${meetingStatusLabel(item.meeting.status)}`}
                          </div>
                        </td>
                        <td>
                          {item.processingMs == null
                            ? "ожидает"
                            : formatProcessingMs(item.processingMs)}
                        </td>
                        <td>{formatEta(item)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="settings__dialog-actions">
              <button
                type="button"
                className="settings__dialog-no"
                onClick={() => onQueueRefresh?.()}
                disabled={queueLoading}
              >
                Обновить
              </button>
              <button
                type="button"
                className="settings__dialog-yes"
                onClick={() => onQueueClose?.()}
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
