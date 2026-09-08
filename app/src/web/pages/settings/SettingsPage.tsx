import { useEffect, useState } from "react";
import type {
  LlmProvider,
  Project,
  RecordingMode,
  SessionInfo,
  Settings,
  SettingsResponse,
  TrackerType,
  TranscriptionQueueItem,
  LlmConnections,
} from "../../../shared/types.ts";
import { emptyLlmConnections, LLM_PROVIDER_LABELS } from "../../../shared/types.ts";
import { readResponseJson } from "../../read-response-json.ts";
import {
  SettingsView,
  type ProjectRow,
  type ProjectRowMode,
} from "./SettingsView.tsx";
import "./settings.css";

type Snapshot = {
  name: string;
  trackerProjectRef: string;
  trackerParentRef: string;
};

type DraftRow = ProjectRow & { snapshot: Snapshot | null };

function toRow(project: Project): DraftRow {
  return {
    key: project.id,
    id: project.id,
    name: project.name,
    trackerProjectRef: project.trackerProjectRef,
    trackerParentRef: project.trackerParentRef,
    meetingCount: project.meetingCount ?? 0,
    mode: "view",
    pendingDelete: false,
    snapshot: null,
  };
}

function emptyRow(): DraftRow {
  return {
    key: `new-${crypto.randomUUID()}`,
    id: null,
    name: "",
    trackerProjectRef: "",
    trackerParentRef: "",
    meetingCount: 0,
    mode: "new",
    pendingDelete: false,
    snapshot: null,
  };
}

export function projectsLoadError(status: number): string {
  if (status === 404) {
    return "Список проектов недоступен. Перезапустите API (`npm run dev`) после обновления до 0.2.0.";
  }
  return "Не удалось загрузить проекты";
}

export function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [loaded, setLoaded] = useState<Project[]>([]);
  const [googleCalendarConnected, setGoogleCalendarConnected] = useState(false);
  const [googleCalendarAccount, setGoogleCalendarAccount] = useState<string | null>(
    null,
  );
  const [googleClientId, setGoogleClientId] = useState("");
  const [googleClientSecretSet, setGoogleClientSecretSet] = useState(false);
  const [googleDialogOpen, setGoogleDialogOpen] = useState(false);
  const [googleDialogBusy, setGoogleDialogBusy] = useState(false);
  const [googleDialogError, setGoogleDialogError] = useState<string | null>(null);
  const [trackerConnected, setTrackerConnected] = useState(false);
  const [llmConnections, setLlmConnections] = useState<LlmConnections>(
    emptyLlmConnections(),
  );
  const [llmDialogProvider, setLlmDialogProvider] = useState<LlmProvider | null>(
    null,
  );
  const [llmDialogOpen, setLlmDialogOpen] = useState(false);
  const [llmDialogInstructions, setLlmDialogInstructions] = useState<string | null>(
    null,
  );
  const [llmDialogBusy, setLlmDialogBusy] = useState(false);
  const [llmDialogError, setLlmDialogError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tableError, setTableError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [restartDialogOpen, setRestartDialogOpen] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [logDialogOpen, setLogDialogOpen] = useState(false);
  const [logLoading, setLogLoading] = useState(false);
  const [logText, setLogText] = useState<string | null>(null);
  const [queueDialogOpen, setQueueDialogOpen] = useState(false);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueItems, setQueueItems] = useState<TranscriptionQueueItem[]>([]);
  const [queueError, setQueueError] = useState<string | null>(null);

  async function loadAll(): Promise<void> {
    const [settingsRes, projectsRes, sessionRes] = await Promise.all([
      fetch("/api/settings"),
      fetch("/api/projects"),
      fetch("/api/auth/session"),
    ]);

    if (!settingsRes.ok) {
      throw new Error("settings");
    }

    const nextSettings = await readResponseJson<SettingsResponse>(settingsRes);
    setSettings(nextSettings);
    setGoogleClientId(nextSettings.googleClientId);
    setGoogleClientSecretSet(nextSettings.googleClientSecretSet);
    setError(null);

    if (projectsRes.ok) {
      const projectsBody = await readResponseJson<{ projects: Project[] }>(
        projectsRes,
      );
      setLoaded(projectsBody.projects);
      setRows(projectsBody.projects.map(toRow));
      setTableError(null);
    } else {
      setLoaded([]);
      setRows([]);
      setTableError(projectsLoadError(projectsRes.status));
    }

    if (sessionRes.ok) {
      const session = await readResponseJson<SessionInfo>(sessionRes);
      setGoogleCalendarConnected(session.integrations.googleCalendar);
      setGoogleCalendarAccount(session.integrations.googleCalendarAccount);
      setTrackerConnected(session.integrations.trackerConnected);
      setLlmConnections(
        session.integrations.llmConnections ?? emptyLlmConnections(),
      );
    }
  }

  useEffect(() => {
    void loadAll().catch(() => {
      setSettings(null);
      setError("Не удалось загрузить настройки");
    });
  }, []);

  function patchRow(key: string, patch: Partial<DraftRow>): void {
    setRows((prev) =>
      prev.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }

  function onRowMode(key: string, mode: ProjectRowMode): void {
    const row = rows.find((item) => item.key === key);
    if (!row) {
      return;
    }
    if (mode === "delete_confirm" && row.meetingCount > 0) {
      setTableError("Нельзя удалить проект с расшифровками");
      return;
    }
    if (mode === "edit") {
      patchRow(key, {
        mode,
        snapshot: {
          name: row.name,
          trackerProjectRef: row.trackerProjectRef,
          trackerParentRef: row.trackerParentRef,
        },
      });
      return;
    }
    setTableError(null);
    patchRow(key, { mode });
  }

  function onRowCancel(key: string): void {
    setRows((prev) => {
      const row = prev.find((item) => item.key === key);
      if (!row) {
        return prev;
      }
      if (row.mode === "new" && row.id === null) {
        return prev.filter((item) => item.key !== key);
      }
      if (row.pendingDelete) {
        return prev.map((item) =>
          item.key === key ? { ...item, pendingDelete: false, mode: "view" } : item,
        );
      }
      if (row.snapshot) {
        return prev.map((item) =>
          item.key === key
            ? {
                ...item,
                name: row.snapshot!.name,
                trackerProjectRef: row.snapshot!.trackerProjectRef,
                trackerParentRef: row.snapshot!.trackerParentRef,
                mode: "view",
                snapshot: null,
              }
            : item,
        );
      }
      return prev.map((item) =>
        item.key === key ? { ...item, mode: "view" } : item,
      );
    });
  }

  async function onRestartConfirm(): Promise<void> {
    setRestarting(true);
    try {
      const res = await fetch("/api/bot/restart", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      if (!res.ok) {
        throw new Error("restart");
      }
      const body = await readResponseJson<{
        meetingsCleared?: number;
        jobsFailed?: number;
        containersRemoved?: number;
        workerRestarted?: boolean;
      }>(res);
      const worker = body.workerRestarted
        ? "воркер перезапущен"
        : "воркер на этой машине не трогали";
      setNotice(
        `Бот сброшен: встреч снято ${body.meetingsCleared ?? 0}, заданий ${body.jobsFailed ?? 0}, контейнеров ${body.containersRemoved ?? 0}. ${worker}.`,
      );
      setError(null);
      setRestartDialogOpen(false);
    } catch {
      setError("Не удалось перезапустить бота");
      setNotice(null);
      setRestartDialogOpen(false);
    } finally {
      setRestarting(false);
    }
  }

  async function fetchLogs(): Promise<void> {
    setLogLoading(true);
    try {
      const res = await fetch("/api/logs");
      if (!res.ok) {
        throw new Error("logs");
      }
      const body = await readResponseJson<{
        ok: boolean;
        text?: string;
        reason?: string;
      }>(res);
      setLogText(body.ok ? body.text ?? "" : body.reason ?? "error");
    } catch {
      setLogText("error");
    } finally {
      setLogLoading(false);
    }
  }

  function onLogsClick(): void {
    setLogDialogOpen(true);
    void fetchLogs();
  }

  function onLogsClose(): void {
    setLogDialogOpen(false);
  }

  async function fetchQueue(): Promise<void> {
    setQueueLoading(true);
    try {
      const res = await fetch("/api/transcription-queue");
      if (res.status === 403) {
        setQueueError("Нужны права администратора");
        setQueueItems([]);
        return;
      }
      if (!res.ok) {
        throw new Error("queue");
      }
      const body = await readResponseJson<{ items: TranscriptionQueueItem[] }>(res);
      setQueueItems(body.items);
      setQueueError(null);
    } catch {
      setQueueError("Не удалось загрузить очередь");
      setQueueItems([]);
    } finally {
      setQueueLoading(false);
    }
  }

  function onQueueClick(): void {
    setQueueDialogOpen(true);
    void fetchQueue();
  }

  function onQueueClose(): void {
    setQueueDialogOpen(false);
  }

  useEffect(() => {
    if (!queueDialogOpen) {
      return;
    }
    const timer = window.setInterval(() => {
      void fetchQueue();
    }, 1500);
    return () => window.clearInterval(timer);
  }, [queueDialogOpen]);

  async function onSave(): Promise<void> {
    if (!settings) {
      return;
    }
    const create = rows
      .filter((row) => row.id === null && row.name.trim() && !row.pendingDelete)
      .map((row) => ({
        name: row.name.trim(),
        trackerProjectRef: row.trackerProjectRef.trim(),
        trackerParentRef: row.trackerParentRef.trim(),
      }));
    const original = new Map(loaded.map((project) => [project.id, project]));
    const update = rows.flatMap((row) => {
      if (!row.id || row.pendingDelete) {
        return [];
      }
      const prev = original.get(row.id);
      if (!prev) {
        return [];
      }
      const name = row.name.trim();
      const trackerProjectRef = row.trackerProjectRef.trim();
      const trackerParentRef = row.trackerParentRef.trim();
      if (
        prev.name === name &&
        prev.trackerProjectRef === trackerProjectRef &&
        prev.trackerParentRef === trackerParentRef
      ) {
        return [];
      }
      if (!name) {
        return [];
      }
      return [{ id: row.id, name, trackerProjectRef, trackerParentRef }];
    });
    const deletes = rows
      .filter((row) => row.id && row.pendingDelete)
      .map((row) => row.id as string);

    setSaving(true);
    try {
      const batchRes = await fetch("/api/projects/batch", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ create, update, delete: deletes }),
      });
      if (!batchRes.ok) {
        const body = await readResponseJson<{ error?: string }>(batchRes);
        throw new Error(body.error ?? "batch");
      }
      const settingsRes = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          recordingModeDefault: settings.recordingModeDefault,
          trackerType: settings.trackerType,
          llmProvider: settings.llmProvider,
        }),
      });
      if (!settingsRes.ok) {
        throw new Error("settings");
      }
      setSettings(await readResponseJson<SettingsResponse>(settingsRes));
      await loadAll();
      setNotice("Настройки сохранены");
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error && err.message && err.message !== "batch" && err.message !== "settings"
          ? err.message
          : "Не удалось сохранить настройки",
      );
      setNotice(null);
    } finally {
      setSaving(false);
    }
  }

  async function connect(path: string): Promise<void> {
    const res = await fetch(path);
    if (!res.ok) {
      setError("Не удалось подключить интеграцию");
      return;
    }
    const body = await readResponseJson<{
      connected?: boolean;
      stub?: boolean;
      notice?: string;
    }>(res);
    if (body.stub || body.connected === false) {
      setNotice(body.notice ?? "заглушка: интеграция не подключена");
    }
    await loadAll();
  }

  async function disconnect(path: string): Promise<void> {
    const res = await fetch(path, { method: "DELETE" });
    if (!res.ok) {
      setError("Не удалось отключить интеграцию");
      return;
    }
    await loadAll();
  }

  async function onConnectLlm(provider: LlmProvider): Promise<void> {
    setLlmDialogError(null);
    setLlmDialogProvider(provider);
    const res = await fetch(`/api/integrations/llm/${provider}/start`);
    if (!res.ok) {
      setError("Не удалось начать авторизацию LLM");
      setLlmDialogProvider(null);
      return;
    }
    const body = await readResponseJson<{
      authUrl?: string;
      instructions?: string;
    }>(res);
    if (body.authUrl) {
      window.open(body.authUrl, "_blank", "noopener,noreferrer");
    }
    setLlmDialogInstructions(body.instructions ?? null);
    setLlmDialogOpen(true);
  }

  async function onLlmCodeSubmit(value: string): Promise<void> {
    if (!llmDialogProvider) {
      return;
    }
    setLlmDialogBusy(true);
    setLlmDialogError(null);
    try {
      const payload =
        llmDialogProvider === "claude" ? { code: value } : { token: value };
      const res = await fetch(
        `/api/integrations/llm/${llmDialogProvider}/complete`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) {
        const errBody = await readResponseJson<{ error?: string }>(res);
        throw new Error(errBody.error ?? "complete");
      }
      setLlmDialogOpen(false);
      setLlmDialogProvider(null);
      setNotice(`${LLM_PROVIDER_LABELS[llmDialogProvider]} подключён, токен сохранён в .env`);
      setError(null);
      await loadAll();
    } catch (err) {
      setLlmDialogError(
        err instanceof Error && err.message !== "complete"
          ? err.message
          : "Не удалось сохранить токен",
      );
    } finally {
      setLlmDialogBusy(false);
    }
  }

  function onLlmDialogClose(): void {
    setLlmDialogOpen(false);
    setLlmDialogProvider(null);
    setLlmDialogError(null);
  }

  function onGoogleCredentialsClick(): void {
    setGoogleDialogError(null);
    setGoogleDialogOpen(true);
  }

  function onGoogleDialogClose(): void {
    setGoogleDialogOpen(false);
    setGoogleDialogError(null);
  }

  async function onGoogleCredentialsSubmit(
    clientId: string,
    clientSecret: string,
  ): Promise<void> {
    setGoogleDialogBusy(true);
    setGoogleDialogError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          googleClientId: clientId,
          googleClientSecret: clientSecret,
        }),
      });
      if (!res.ok) {
        const errBody = await readResponseJson<{ error?: string }>(res);
        throw new Error(errBody.error ?? "google-credentials");
      }
      setGoogleDialogOpen(false);
      setNotice("Google Client ID/Secret сохранены в .env");
      setError(null);
      await loadAll();
    } catch (err) {
      setGoogleDialogError(
        err instanceof Error && err.message !== "google-credentials"
          ? err.message
          : "Не удалось сохранить Client ID/Secret",
      );
    } finally {
      setGoogleDialogBusy(false);
    }
  }

  if (!settings) {
    return (
      <section className="settings">
        <h1 className="settings__title">{error ?? "Загрузка настроек..."}</h1>
      </section>
    );
  }

  return (
    <>
      {error ? <p className="settings__error">{error}</p> : null}
      {notice ? <p className="settings__notice">{notice}</p> : null}
      <SettingsView
        settings={settings}
        projects={rows}
        saving={saving}
        restartDialogOpen={restartDialogOpen}
        restarting={restarting}
        googleCalendarConnected={googleCalendarConnected}
        googleCalendarAccount={googleCalendarAccount}
        googleClientId={googleClientId}
        googleClientSecretSet={googleClientSecretSet}
        googleDialogOpen={googleDialogOpen}
        googleDialogBusy={googleDialogBusy}
        googleDialogError={googleDialogError}
        trackerConnected={trackerConnected}
        llmConnections={llmConnections}
        llmDialogProvider={llmDialogProvider}
        llmDialogOpen={llmDialogOpen}
        llmDialogInstructions={llmDialogInstructions}
        llmDialogBusy={llmDialogBusy}
        llmDialogError={llmDialogError}
        tableError={tableError}
        onRecordingModeChange={(mode: RecordingMode) =>
          setSettings((prev) =>
            prev ? { ...prev, recordingModeDefault: mode } : prev,
          )
        }
        onTrackerTypeChange={(type: TrackerType) =>
          setSettings((prev) => (prev ? { ...prev, trackerType: type } : prev))
        }
        onLlmProviderChange={(provider: LlmProvider) =>
          setSettings((prev) => (prev ? { ...prev, llmProvider: provider } : prev))
        }
        onSave={() => void onSave()}
        onAddProject={() => setRows((prev) => [...prev, emptyRow()])}
        onRowFieldChange={(key, field, value) => patchRow(key, { [field]: value })}
        onRowMode={onRowMode}
        onRowCancel={onRowCancel}
        onConfirmDelete={(key) =>
          patchRow(key, { pendingDelete: true, mode: "view" })
        }
        onConnectTracker={() =>
          void connect(`/api/integrations/tracker/${settings.trackerType}/start`)
        }
        onDisconnectTracker={() =>
          void disconnect(`/api/integrations/tracker/${settings.trackerType}`)
        }
        onConnectGoogle={() => {
          window.location.href = "/api/integrations/google-calendar/start";
        }}
        onDisconnectGoogle={() =>
          void disconnect("/api/integrations/google-calendar")
        }
        onGoogleCredentialsClick={onGoogleCredentialsClick}
        onGoogleCredentialsSubmit={(clientId, clientSecret) =>
          void onGoogleCredentialsSubmit(clientId, clientSecret)
        }
        onGoogleDialogClose={onGoogleDialogClose}
        onConnectLlm={(provider) => void onConnectLlm(provider)}
        onDisconnectLlm={(provider) =>
          void disconnect(`/api/integrations/llm/${provider}`)
        }
        onLlmCodeSubmit={(value) => void onLlmCodeSubmit(value)}
        onLlmDialogClose={onLlmDialogClose}
        onRestartClick={() => setRestartDialogOpen(true)}
        onRestartCancel={() => setRestartDialogOpen(false)}
        onRestartConfirm={() => void onRestartConfirm()}
        logDialogOpen={logDialogOpen}
        logLoading={logLoading}
        logText={logText}
        onLogsClick={onLogsClick}
        onLogsRefresh={() => void fetchLogs()}
        onLogsClose={onLogsClose}
        queueDialogOpen={queueDialogOpen}
        queueLoading={queueLoading}
        queueItems={queueItems}
        queueError={queueError}
        onQueueClick={onQueueClick}
        onQueueRefresh={() => void fetchQueue()}
        onQueueClose={onQueueClose}
      />
    </>
  );
}
