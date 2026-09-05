import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { hashPassword } from "../server/auth/crypto.ts";
import { migrate, getDefaultProjectId } from "./schema.ts";
import type {
  ActionItem,
  CreateMeetingInput,
  Job,
  Meeting,
  MeetingStatus,
  Platform,
  Project,
  RecordingMode,
  SearchMeetingsFilters,
  Settings,
  Summary,
  TrackerState,
  TrackerType,
  TranscriptSegment,
  User,
  UserRole,
  WebhookDelivery,
  WebhookDeliveryStatus,
} from "../shared/types.ts";
import { trackerStateToAsanaState } from "../shared/types.ts";
import {
  LIVE_AUDIO_MISSING_TEXT,
  LIVE_AUDIO_PENDING_TEXT,
} from "../adapters/stt/pending.ts";
import { toFtsMatchQuery } from "../shared/fts-query.ts";

const DEFAULT_DB_FILE = "data/app.sqlite";
export const STALE_JOB_ERROR = "задание зависло и снято с очереди";
export const JOIN_JOB_STALE_MS = 4 * 60 * 60 * 1000;
export const OTHER_JOB_STALE_MS = 30 * 60 * 1000;

function resolveDbPath(path: string): string {
  if (path === ":memory:" || isAbsolute(path)) {
    return path;
  }
  return join(process.cwd(), path);
}

function defaultDbPath(): string {
  return process.env.PM_ASSISTANT_DB_PATH ?? DEFAULT_DB_FILE;
}

function rowToMeeting(row: Record<string, unknown>): Meeting {
  return {
    id: String(row.id),
    url: String(row.url),
    platform: row.platform as Platform,
    title: row.title == null ? null : String(row.title),
    status: row.status as MeetingStatus,
    recordingMode: row.recording_mode as RecordingMode,
    startedAt: row.started_at == null ? null : String(row.started_at),
    endedAt: row.ended_at == null ? null : String(row.ended_at),
    error: row.error == null ? null : String(row.error),
    announcementStatus:
      row.announcement_status == null ? null : String(row.announcement_status),
    source: row.source as Meeting["source"],
    audioPath: row.audio_path == null ? null : String(row.audio_path),
    projectId: row.project_id == null ? null : String(row.project_id),
    ownerUserId: row.owner_user_id == null ? null : String(row.owner_user_id),
  };
}

function rowToProject(row: Record<string, unknown>): Project {
  return {
    id: String(row.id),
    name: String(row.name),
    trackerProjectRef: String(row.tracker_project_ref ?? ""),
    trackerParentRef: String(row.tracker_parent_ref ?? ""),
    meetingCount:
      row.meeting_count == null ? undefined : Number(row.meeting_count),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToUser(row: Record<string, unknown>): User {
  return {
    id: String(row.id),
    email: String(row.email),
    displayName: String(row.display_name),
    role: row.role === "admin" ? "admin" : "user",
  };
}

function asanaStateFromTracker(state: TrackerState): ActionItem["asanaState"] {
  return trackerStateToAsanaState(state);
}

function trackerStateFromAsana(
  asanaState: ActionItem["asanaState"],
): TrackerState {
  if (asanaState === "queued_for_asana") {
    return "queued";
  }
  if (asanaState === "sent") {
    return "created";
  }
  return "none";
}

function seedUserFromEnv(sqlite: Database.Database): void {
  const email = process.env.PM_ASSISTANT_AUTH_EMAIL?.trim().toLowerCase();
  if (email) {
    sqlite
      .prepare("UPDATE users SET role = 'admin' WHERE email = ?")
      .run(email);
  }

  const count = sqlite
    .prepare("SELECT COUNT(*) AS n FROM users")
    .get() as { n: number };
  if (count.n > 0) {
    return;
  }

  const password = process.env.PM_ASSISTANT_AUTH_PASSWORD;
  if (!email || !password) {
    return;
  }

  const displayName =
    process.env.PM_ASSISTANT_AUTH_DISPLAY_NAME?.trim() ||
    email.split("@")[0] ||
    "Пользователь";
  const id = crypto.randomUUID();
  sqlite
    .prepare(
      `INSERT INTO users (
        id, email, password_hash, google_sub, display_name, created_at, role
      ) VALUES (?, ?, ?, NULL, ?, ?, 'admin')`,
    )
    .run(
      id,
      email.trim().toLowerCase(),
      hashPassword(password),
      displayName,
      new Date().toISOString(),
    );
}

function parseBool(value: string): boolean {
  return value === "true" || value === "1";
}

export function createDb(path = defaultDbPath()) {
  const resolved = resolveDbPath(path);
  if (resolved !== ":memory:") {
    mkdirSync(dirname(resolved), { recursive: true });
  }
  const sqlite = new Database(resolved);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  migrate(sqlite);
  seedUserFromEnv(sqlite);
  function currentDefaultProjectId(): string {
    return getDefaultProjectId(sqlite);
  }

  const selectMeetings = sqlite.prepare("SELECT * FROM meetings ORDER BY id");
  const selectMeetingsForUser = sqlite.prepare(`
    SELECT * FROM meetings
    WHERE owner_user_id IS NULL OR owner_user_id = ?
    ORDER BY id
  `);
  const selectMeeting = sqlite.prepare("SELECT * FROM meetings WHERE id = ?");
  const insertMeeting = sqlite.prepare(`
    INSERT INTO meetings (
      id, url, platform, title, status, recording_mode,
      started_at, ended_at, error, announcement_status, source, audio_path,
      project_id, owner_user_id
    ) VALUES (
      @id, @url, @platform, @title, @status, @recording_mode,
      @started_at, @ended_at, @error, @announcement_status, @source, @audio_path,
      @project_id, @owner_user_id
    )
  `);
  const updateStatus = sqlite.prepare(`
    UPDATE meetings SET
      status = @status,
      error = @error,
      announcement_status = @announcement_status,
      source = @source,
      audio_path = @audio_path,
      started_at = @started_at,
      ended_at = @ended_at
    WHERE id = @id
  `);
  const updateMeetingTitle = sqlite.prepare(`
    UPDATE meetings SET title = @title WHERE id = @id
  `);
  const selectSettings = sqlite.prepare("SELECT key, value FROM settings");
  const upsertSetting = sqlite.prepare(`
    INSERT INTO settings (key, value) VALUES (@key, @value)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  const insertSegment = sqlite.prepare(`
    INSERT INTO transcript_segments (
      id, meeting_id, speaker, started_at_ms, ended_at_ms, text
    ) VALUES (
      @id, @meeting_id, @speaker, @started_at_ms, @ended_at_ms, @text
    )
  `);
  const deleteSegments = sqlite.prepare(
    "DELETE FROM transcript_segments WHERE meeting_id = ?",
  );
  const selectSegments = sqlite.prepare(
    "SELECT * FROM transcript_segments WHERE meeting_id = ? ORDER BY started_at_ms",
  );
  const upsertSummary = sqlite.prepare(`
    INSERT INTO summaries (meeting_id, headline, decisions, risks, next_step)
    VALUES (@meeting_id, @headline, @decisions, @risks, @next_step)
    ON CONFLICT(meeting_id) DO UPDATE SET
      headline = excluded.headline,
      decisions = excluded.decisions,
      risks = excluded.risks,
      next_step = excluded.next_step
  `);
  const selectSummary = sqlite.prepare(
    "SELECT * FROM summaries WHERE meeting_id = ?",
  );
  const selectHeadlines = sqlite.prepare(
    "SELECT meeting_id, headline FROM summaries",
  );
  const insertActionItem = sqlite.prepare(`
    INSERT INTO action_items (
      id, meeting_id, assignee, title, due_at, timecode_ms, segment_id,
      asana_state, tracker_type, tracker_state, tracker_external_id
    ) VALUES (
      @id, @meeting_id, @assignee, @title, @due_at, @timecode_ms, @segment_id,
      @asana_state, @tracker_type, @tracker_state, @tracker_external_id
    )
  `);
  const selectActionItems = sqlite.prepare(
    "SELECT * FROM action_items WHERE meeting_id = ? ORDER BY id",
  );
  const markQueuedStmt = sqlite.prepare(`
    UPDATE action_items SET
      asana_state = CASE WHEN @tracker_type = 'asana' THEN 'queued_for_asana' ELSE asana_state END,
      tracker_state = 'queued',
      tracker_type = @tracker_type,
      tracker_external_id = NULL
    WHERE id = @id
  `);
  const markCreatedStmt = sqlite.prepare(`
    UPDATE action_items SET
      asana_state = CASE WHEN @tracker_type = 'asana' THEN 'sent' ELSE asana_state END,
      tracker_state = 'created',
      tracker_type = @tracker_type,
      tracker_external_id = @tracker_external_id
    WHERE id = @id
  `);
  const selectProjects = sqlite.prepare(`
    SELECT p.*, (
      SELECT COUNT(*) FROM meetings m WHERE m.project_id = p.id
    ) AS meeting_count
    FROM projects p
    ORDER BY p.name
  `);
  const selectProject = sqlite.prepare("SELECT * FROM projects WHERE id = ?");
  const selectProjectWithCount = sqlite.prepare(`
    SELECT p.*, (
      SELECT COUNT(*) FROM meetings m WHERE m.project_id = p.id
    ) AS meeting_count
    FROM projects p
    WHERE p.id = ?
  `);
  const insertProject = sqlite.prepare(`
    INSERT INTO projects (
      id, name, tracker_project_ref, tracker_parent_ref, created_at, updated_at
    ) VALUES (
      @id, @name, @tracker_project_ref, @tracker_parent_ref, @created_at, @updated_at
    )
  `);
  const updateProjectStmt = sqlite.prepare(`
    UPDATE projects SET
      name = @name,
      tracker_project_ref = @tracker_project_ref,
      tracker_parent_ref = @tracker_parent_ref,
      updated_at = @updated_at
    WHERE id = @id
  `);
  const deleteProjectStmt = sqlite.prepare("DELETE FROM projects WHERE id = ?");
  const countMeetingsForProject = sqlite.prepare(
    "SELECT COUNT(*) AS count FROM meetings WHERE project_id = ?",
  );
  const selectUserByEmail = sqlite.prepare(
    "SELECT * FROM users WHERE email = ? COLLATE NOCASE",
  );
  const selectUserById = sqlite.prepare("SELECT * FROM users WHERE id = ?");
  const selectUserByGoogleSub = sqlite.prepare(
    "SELECT * FROM users WHERE google_sub = ?",
  );
  const insertUser = sqlite.prepare(`
    INSERT INTO users (
      id, email, password_hash, google_sub, display_name, created_at, role
    ) VALUES (
      @id, @email, @password_hash, @google_sub, @display_name, @created_at, @role
    )
  `);
  const updateUserPasswordStmt = sqlite.prepare(
    "UPDATE users SET password_hash = ? WHERE id = ?",
  );
  const updateUserGoogle = sqlite.prepare(`
    UPDATE users SET google_sub = @google_sub, display_name = @display_name
    WHERE id = @id
  `);
  const insertSession = sqlite.prepare(`
    INSERT INTO sessions (id, user_id, expires_at, created_at)
    VALUES (@id, @user_id, @expires_at, @created_at)
  `);
  const selectSession = sqlite.prepare(`
    SELECT s.*, u.email, u.display_name, u.role
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.id = ?
  `);
  const deleteSession = sqlite.prepare("DELETE FROM sessions WHERE id = ?");
  const deleteExpiredSessions = sqlite.prepare(
    "DELETE FROM sessions WHERE expires_at < ?",
  );
  const selectIntegration = sqlite.prepare(
    "SELECT access_token, meta_json FROM integration_tokens WHERE provider = ? LIMIT 1",
  );
  const selectActiveJob = sqlite.prepare(`
    SELECT 1 AS ok FROM jobs
    WHERE meeting_id = ? AND status IN ('pending', 'running')
    LIMIT 1
  `);
  const selectActiveJobType = sqlite.prepare(`
    SELECT 1 AS ok FROM jobs
    WHERE meeting_id = ? AND type = ? AND status IN ('pending', 'running')
    LIMIT 1
  `);
  const selectJobsForMeeting = sqlite.prepare(
    "SELECT * FROM jobs WHERE meeting_id = ? ORDER BY id",
  );
  const upsertIntegrationTokenStmt = sqlite.prepare(`
    INSERT INTO integration_tokens (
      provider, access_token, refresh_token, expires_at, meta_json
    ) VALUES (
      @provider, @access_token, @refresh_token, @expires_at, @meta_json
    )
    ON CONFLICT(provider) DO UPDATE SET
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      expires_at = excluded.expires_at,
      meta_json = excluded.meta_json
  `);
  const deleteIntegrationTokenStmt = sqlite.prepare(
    "DELETE FROM integration_tokens WHERE provider = ?",
  );
  const insertJob = sqlite.prepare(`
    INSERT INTO jobs (id, meeting_id, type, status, attempts, last_error, claimed_at)
    VALUES (@id, @meeting_id, @type, @status, @attempts, @last_error, @claimed_at)
  `);
  const selectAllJobs = sqlite.prepare("SELECT * FROM jobs ORDER BY id");
  const selectNextJob = sqlite.prepare(
    "SELECT * FROM jobs WHERE status = 'pending' ORDER BY id LIMIT 1",
  );
  const selectRunningJob = sqlite.prepare(
    "SELECT id FROM jobs WHERE status = 'running' LIMIT 1",
  );
  const claimJob = sqlite.prepare(
    "UPDATE jobs SET status = 'running', attempts = attempts + 1, claimed_at = ? WHERE id = ? AND status = 'pending'",
  );
  const finishJobStmt = sqlite.prepare(
    "UPDATE jobs SET status = 'done' WHERE id = ?",
  );
  const failJobStmt = sqlite.prepare(
    "UPDATE jobs SET status = 'failed', last_error = ? WHERE id = ?",
  );
  const upsertFts = sqlite.prepare(`
    INSERT INTO meetings_fts (meeting_id, content) VALUES (?, ?)
  `);
  const deleteFts = sqlite.prepare(
    "DELETE FROM meetings_fts WHERE meeting_id = ?",
  );
  const searchFts = sqlite.prepare(`
    SELECT meeting_id FROM meetings_fts WHERE meetings_fts MATCH ? 
  `);
  const insertWebhookDelivery = sqlite.prepare(`
    INSERT INTO webhook_deliveries (
      id, meeting_id, url, status, detail, created_at
    ) VALUES (
      @id, @meeting_id, @url, @status, @detail, @created_at
    )
  `);
  const selectWebhookDeliveries = sqlite.prepare(
    "SELECT * FROM webhook_deliveries ORDER BY created_at, id",
  );

  function rebuildFts(meetingId: string): void {
    const meeting = getMeeting(meetingId);
    if (!meeting) {
      return;
    }
    const segments = listTranscript(meetingId);
    const summary = getSummary(meetingId);
    const items = listActionItems(meetingId);
    const parts = [
      meeting.title ?? "",
      meeting.url,
      ...segments.map((s) => s.text),
      summary?.headline ?? "",
      summary?.decisions ?? "",
      summary?.risks ?? "",
      summary?.nextStep ?? "",
      ...items.map((item) => item.title),
    ];
    deleteFts.run(meetingId);
    upsertFts.run(meetingId, parts.join(" "));
  }

  function listMeetings(): Meeting[] {
    return (selectMeetings.all() as Record<string, unknown>[]).map(rowToMeeting);
  }

  function listMeetingsForUser(userId: string): Meeting[] {
    return (selectMeetingsForUser.all(userId) as Record<string, unknown>[]).map(
      rowToMeeting,
    );
  }

  function getMeeting(id: string): Meeting | null {
    const row = selectMeeting.get(id) as Record<string, unknown> | undefined;
    return row ? rowToMeeting(row) : null;
  }

  function getMeetingForUser(id: string, userId: string): Meeting | null {
    const meeting = getMeeting(id);
    if (!meeting) {
      return null;
    }
    if (meeting.ownerUserId && meeting.ownerUserId !== userId) {
      return null;
    }
    return meeting;
  }

  function createMeeting(input: CreateMeetingInput): Meeting {
    const id = crypto.randomUUID();
    const projectId = input.projectId ?? currentDefaultProjectId();
    insertMeeting.run({
      id,
      url: input.url,
      platform: input.platform ?? "unknown",
      title: input.title ?? null,
      status: "queued",
      recording_mode: input.recordingMode ?? "text",
      started_at: null,
      ended_at: null,
      error: null,
      announcement_status: null,
      source: input.source ?? "stub",
      audio_path: null,
      project_id: projectId,
      owner_user_id: input.ownerUserId ?? null,
    });
    rebuildFts(id);
    const created = getMeeting(id);
    if (!created) {
      throw new Error("не удалось создать встречу");
    }
    return created;
  }

  function searchMeetings(
    query: string,
    filters: SearchMeetingsFilters = {},
  ): Meeting[] {
    const trimmed = query.trim();
    let ids: string[];
    if (!trimmed) {
      ids = listMeetings().map((m) => m.id);
    } else {
      const match = toFtsMatchQuery(trimmed);
      const ftsIds =
        match
          ? (searchFts.all(match) as { meeting_id: string }[]).map(
              (row) => row.meeting_id,
            )
          : [];
      const needle = trimmed.toLowerCase();
      const titleIds = listMeetings()
        .filter((meeting) =>
          (meeting.title ?? "").toLowerCase().includes(needle),
        )
        .map((meeting) => meeting.id);
      ids = [...new Set([...ftsIds, ...titleIds])];
    }
    return ids
      .map((id) => getMeeting(id))
      .filter((m): m is Meeting => m !== null)
      .filter((m) => (filters.platform ? m.platform === filters.platform : true));
  }

  function updateMeetingStatus(
    id: string,
    status: MeetingStatus,
    extra: {
      error?: string | null;
      announcementStatus?: string | null;
      source?: Meeting["source"];
      audioPath?: string | null;
      startedAt?: string | null;
      endedAt?: string | null;
    } = {},
  ): Meeting {
    const existing = getMeeting(id);
    if (!existing) {
      throw new Error("встреча не найдена");
    }
    updateStatus.run({
      id,
      status,
      error: extra.error === undefined ? existing.error : extra.error,
      announcement_status:
        extra.announcementStatus === undefined
          ? existing.announcementStatus
          : extra.announcementStatus,
      source: extra.source === undefined ? existing.source : extra.source,
      audio_path:
        extra.audioPath === undefined ? existing.audioPath : extra.audioPath,
      started_at:
        extra.startedAt === undefined ? existing.startedAt : extra.startedAt,
      ended_at: extra.endedAt === undefined ? existing.endedAt : extra.endedAt,
    });
    const updated = getMeeting(id);
    if (!updated) {
      throw new Error("встреча не найдена");
    }
    return updated;
  }

  function listTranscript(meetingId: string): TranscriptSegment[] {
    return (selectSegments.all(meetingId) as Record<string, unknown>[]).map(
      (row) => ({
        id: String(row.id),
        meetingId: String(row.meeting_id),
        speaker: String(row.speaker),
        startedAtMs: Number(row.started_at_ms),
        endedAtMs: row.ended_at_ms == null ? null : Number(row.ended_at_ms),
        text: String(row.text),
      }),
    );
  }

  function saveTranscript(
    meetingId: string,
    segments: Omit<TranscriptSegment, "id" | "meetingId">[],
  ): TranscriptSegment[] {
    deleteSegments.run(meetingId);
    for (const segment of segments) {
      insertSegment.run({
        id: crypto.randomUUID(),
        meeting_id: meetingId,
        speaker: segment.speaker,
        started_at_ms: segment.startedAtMs,
        ended_at_ms: segment.endedAtMs,
        text: segment.text,
      });
    }
    rebuildFts(meetingId);
    return listTranscript(meetingId);
  }

  function getSummary(meetingId: string): Summary | null {
    const row = selectSummary.get(meetingId) as Record<string, unknown> | undefined;
    if (!row) {
      return null;
    }
    return {
      meetingId: String(row.meeting_id),
      headline: String(row.headline),
      decisions: String(row.decisions),
      risks: String(row.risks),
      nextStep: String(row.next_step),
    };
  }

  function listHeadlines(): Record<string, string> {
    const rows = selectHeadlines.all() as {
      meeting_id: string;
      headline: string;
    }[];
    const map: Record<string, string> = {};
    for (const row of rows) {
      map[row.meeting_id] = row.headline;
    }
    return map;
  }

  function isPromotableSummaryHeadline(headline: string): boolean {
    const trimmed = headline.trim();
    if (!trimmed) {
      return false;
    }
    return (
      trimmed !== LIVE_AUDIO_PENDING_TEXT &&
      trimmed !== LIVE_AUDIO_MISSING_TEXT
    );
  }

  function saveSummary(
    meetingId: string,
    summary: Omit<Summary, "meetingId">,
  ): Summary {
    upsertSummary.run({
      meeting_id: meetingId,
      headline: summary.headline,
      decisions: summary.decisions,
      risks: summary.risks,
      next_step: summary.nextStep,
    });
    const meeting = getMeeting(meetingId);
    if (
      meeting &&
      !meeting.title?.trim() &&
      isPromotableSummaryHeadline(summary.headline)
    ) {
      updateMeetingTitle.run({
        id: meetingId,
        title: summary.headline.trim(),
      });
    }
    rebuildFts(meetingId);
    const saved = getSummary(meetingId);
    if (!saved) {
      throw new Error("не удалось сохранить резюме");
    }
    return saved;
  }

  function listActionItems(meetingId: string): ActionItem[] {
    return (selectActionItems.all(meetingId) as Record<string, unknown>[]).map(
      (row) => {
        const trackerState = (row.tracker_state ??
          trackerStateFromAsana(
            row.asana_state as ActionItem["asanaState"],
          )) as TrackerState;
        const trackerType =
          row.tracker_type == null
            ? null
            : (String(row.tracker_type) as TrackerType);
        return {
          id: String(row.id),
          meetingId: String(row.meeting_id),
          assignee: row.assignee == null ? null : String(row.assignee),
          title: String(row.title),
          dueAt: row.due_at == null ? null : String(row.due_at),
          timecodeMs: row.timecode_ms == null ? null : Number(row.timecode_ms),
          segmentId: row.segment_id == null ? null : String(row.segment_id),
          trackerType,
          trackerState,
          trackerExternalId:
            row.tracker_external_id == null
              ? null
              : String(row.tracker_external_id),
          asanaState:
            (row.asana_state as ActionItem["asanaState"]) ??
            asanaStateFromTracker(trackerState),
        };
      },
    );
  }

  function saveActionItems(
    meetingId: string,
    items: Array<{
      assignee: string | null;
      title: string;
      dueAt: string | null;
      timecodeMs: number | null;
      segmentId: string | null;
    }>,
  ): ActionItem[] {
    for (const item of items) {
      insertActionItem.run({
        id: crypto.randomUUID(),
        meeting_id: meetingId,
        assignee: item.assignee,
        title: item.title,
        due_at: item.dueAt,
        timecode_ms: item.timecodeMs,
        segment_id: item.segmentId,
        asana_state: "none",
        tracker_type: null,
        tracker_state: "none",
        tracker_external_id: null,
      });
    }
    rebuildFts(meetingId);
    return listActionItems(meetingId);
  }

  function markActionItemsQueued(
    ids: string[],
    trackerType: TrackerType = "asana",
  ): void {
    const tx = sqlite.transaction((itemIds: string[]) => {
      for (const id of itemIds) {
        markQueuedStmt.run({ id, tracker_type: trackerType });
      }
    });
    tx(ids);
  }

  function markActionItemsCreated(
    items: Array<{ id: string; externalId: string | null }>,
    trackerType: TrackerType = "asana",
  ): void {
    const tx = sqlite.transaction(
      (rows: Array<{ id: string; externalId: string | null }>) => {
        for (const row of rows) {
          markCreatedStmt.run({
            id: row.id,
            tracker_type: trackerType,
            tracker_external_id: row.externalId,
          });
        }
      },
    );
    tx(items);
  }

  function markActionItemsQueuedForAsana(ids: string[]): void {
    markActionItemsQueued(ids, "asana");
  }

  function markActionItemsSentToAsana(ids: string[]): void {
    markActionItemsCreated(
      ids.map((id) => ({ id, externalId: null })),
      "asana",
    );
  }

  function getSettings(): Settings {
    const rows = selectSettings.all() as { key: string; value: string }[];
    const map = new Map(rows.map((row) => [row.key, row.value]));
    return {
      recordingModeDefault: (map.get("recordingModeDefault") ??
        "text") as RecordingMode,
      trackerType: (map.get("trackerType") ?? "clickup") as TrackerType,
      asanaProjectLabel: map.get("asanaProjectLabel") ?? "",
      asanaAutoSend: parseBool(map.get("asanaAutoSend") ?? "false"),
      webhookUrl: map.get("webhookUrl") ?? "",
      workerHeartbeatAt: map.get("workerHeartbeatAt") ?? null,
    };
  }

  function putSettings(patch: Partial<Settings>): Settings {
    if (patch.recordingModeDefault !== undefined) {
      upsertSetting.run({
        key: "recordingModeDefault",
        value: patch.recordingModeDefault,
      });
    }
    if (patch.trackerType !== undefined) {
      upsertSetting.run({
        key: "trackerType",
        value: patch.trackerType,
      });
    }
    if (patch.asanaProjectLabel !== undefined) {
      upsertSetting.run({
        key: "asanaProjectLabel",
        value: patch.asanaProjectLabel,
      });
    }
    if (patch.asanaAutoSend !== undefined) {
      upsertSetting.run({
        key: "asanaAutoSend",
        value: patch.asanaAutoSend ? "true" : "false",
      });
    }
    if (patch.webhookUrl !== undefined) {
      upsertSetting.run({
        key: "webhookUrl",
        value: patch.webhookUrl,
      });
    }
    if (patch.workerHeartbeatAt !== undefined) {
      upsertSetting.run({
        key: "workerHeartbeatAt",
        value: patch.workerHeartbeatAt ?? "",
      });
    }
    return getSettings();
  }

  function recordWebhookDelivery(input: {
    meetingId: string;
    url: string;
    status: WebhookDeliveryStatus;
    detail: string;
  }): WebhookDelivery {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    insertWebhookDelivery.run({
      id,
      meeting_id: input.meetingId,
      url: input.url,
      status: input.status,
      detail: input.detail,
      created_at: createdAt,
    });
    return {
      id,
      meetingId: input.meetingId,
      url: input.url,
      status: input.status,
      detail: input.detail,
      createdAt,
    };
  }

  function listWebhookDeliveries(): WebhookDelivery[] {
    return (selectWebhookDeliveries.all() as Record<string, unknown>[]).map(
      (row) => ({
        id: String(row.id),
        meetingId: String(row.meeting_id),
        url: String(row.url),
        status: row.status as WebhookDeliveryStatus,
        detail: String(row.detail),
        createdAt: String(row.created_at),
      }),
    );
  }

  function rowToJob(row: Record<string, unknown>): Job {
    return {
      id: String(row.id),
      meetingId: String(row.meeting_id),
      type: String(row.type),
      status: String(row.status),
      attempts: Number(row.attempts),
      lastError: row.last_error == null ? null : String(row.last_error),
      claimedAt: row.claimed_at == null ? null : String(row.claimed_at),
    };
  }

  function listJobs(): Job[] {
    return (selectAllJobs.all() as Record<string, unknown>[]).map(rowToJob);
  }

  function listJobsForMeeting(meetingId: string): Job[] {
    return (selectJobsForMeeting.all(meetingId) as Record<string, unknown>[]).map(
      rowToJob,
    );
  }

  function hasActiveJob(meetingId: string, type?: string): boolean {
    if (type) {
      return Boolean(selectActiveJobType.get(meetingId, type));
    }
    return Boolean(selectActiveJob.get(meetingId));
  }

  function enqueueJob(input: { meetingId: string; type: string }): Job {
    const id = crypto.randomUUID();
    insertJob.run({
      id,
      meeting_id: input.meetingId,
      type: input.type,
      status: "pending",
      attempts: 0,
      last_error: null,
      claimed_at: null,
    });
    return {
      id,
      meetingId: input.meetingId,
      type: input.type,
      status: "pending",
      attempts: 0,
      lastError: null,
      claimedAt: null,
    };
  }

  function failStaleRunningJobs(maxAgeMs?: number): Job[] {
    const now = Date.now();
    const failed: Job[] = [];
    for (const job of listJobs()) {
      if (job.status !== "running") {
        continue;
      }
      const claimedMs = job.claimedAt ? Date.parse(job.claimedAt) : Number.NaN;
      const ageMs = Number.isFinite(claimedMs)
        ? now - claimedMs
        : Number.POSITIVE_INFINITY;
      const limit =
        maxAgeMs ??
        (job.type === "join" ? JOIN_JOB_STALE_MS : OTHER_JOB_STALE_MS);
      if (ageMs < limit) {
        continue;
      }
      failJob(job.id, STALE_JOB_ERROR);
      failed.push({
        ...job,
        status: "failed",
        lastError: STALE_JOB_ERROR,
      });
    }
    return failed;
  }

  function failAllRunningJobs(lastError: string): Job[] {
    const failed: Job[] = [];
    for (const job of listJobs()) {
      if (job.status !== "running") {
        continue;
      }
      failJob(job.id, lastError);
      failed.push({ ...job, status: "failed", lastError });
    }
    return failed;
  }

  function claimNextJob(): Job | null {
    failStaleRunningJobs();
    const running = selectRunningJob.get() as Record<string, unknown> | undefined;
    if (running) {
      return null;
    }
    const row = selectNextJob.get() as Record<string, unknown> | undefined;
    if (!row) {
      return null;
    }
    const claimedAt = new Date().toISOString();
    const result = claimJob.run(claimedAt, String(row.id));
    if (result.changes === 0) {
      return null;
    }
    return {
      ...rowToJob(row),
      status: "running",
      attempts: Number(row.attempts) + 1,
      claimedAt,
    };
  }

  function finishJob(id: string): void {
    finishJobStmt.run(id);
  }

  function failJob(id: string, lastError: string): void {
    failJobStmt.run(lastError.slice(0, 2000), id);
  }

  function listProjects(): Project[] {
    return (selectProjects.all() as Record<string, unknown>[]).map(rowToProject);
  }

  function getProject(id: string): Project | null {
    const row = selectProjectWithCount.get(id) as Record<string, unknown> | undefined;
    return row ? rowToProject(row) : null;
  }

  function createProject(input: {
    name: string;
    trackerProjectRef?: string;
    trackerParentRef?: string;
  }): Project {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    insertProject.run({
      id,
      name: input.name.trim(),
      tracker_project_ref: input.trackerProjectRef?.trim() ?? "",
      tracker_parent_ref: input.trackerParentRef?.trim() ?? "",
      created_at: now,
      updated_at: now,
    });
    const created = getProject(id);
    if (!created) {
      throw new Error("не удалось создать проект");
    }
    return created;
  }

  function updateProject(
    id: string,
    patch: {
      name?: string;
      trackerProjectRef?: string;
      trackerParentRef?: string;
    },
  ): Project | null {
    const current = getProject(id);
    if (!current) {
      return null;
    }
    const now = new Date().toISOString();
    updateProjectStmt.run({
      id,
      name: patch.name?.trim() ?? current.name,
      tracker_project_ref:
        patch.trackerProjectRef?.trim() ?? current.trackerProjectRef,
      tracker_parent_ref:
        patch.trackerParentRef?.trim() ?? current.trackerParentRef,
      updated_at: now,
    });
    return getProject(id);
  }

  function deleteProject(id: string): "deleted" | "not_found" | "has_meetings" {
    if (!getProject(id)) {
      return "not_found";
    }
    const count = Number(
      (countMeetingsForProject.get(id) as { count: number }).count,
    );
    if (count > 0) {
      return "has_meetings";
    }
    deleteProjectStmt.run(id);
    return "deleted";
  }

  function applyProjectsBatch(input: {
    create?: Array<{
      name: string;
      trackerProjectRef?: string;
      trackerParentRef?: string;
    }>;
    update?: Array<{
      id: string;
      name?: string;
      trackerProjectRef?: string;
      trackerParentRef?: string;
    }>;
    delete?: string[];
  }):
    | { ok: true; projects: Project[] }
    | { ok: false; status: 400 | 404 | 409; error: string } {
    const creates = input.create ?? [];
    const updates = input.update ?? [];
    const deletes = input.delete ?? [];

    for (const row of creates) {
      if (!row.name.trim()) {
        return { ok: false, status: 400, error: "нужно имя проекта" };
      }
    }
    for (const row of updates) {
      if (!getProject(row.id)) {
        return { ok: false, status: 404, error: "проект не найден" };
      }
      if (row.name !== undefined && !row.name.trim()) {
        return { ok: false, status: 400, error: "имя проекта не может быть пустым" };
      }
    }
    for (const id of deletes) {
      const result = (() => {
        const current = getProject(id);
        if (!current) {
          return "not_found" as const;
        }
        if ((current.meetingCount ?? 0) > 0) {
          return "has_meetings" as const;
        }
        return "ok" as const;
      })();
      if (result === "not_found") {
        return { ok: false, status: 404, error: "проект не найден" };
      }
      if (result === "has_meetings") {
        return {
          ok: false,
          status: 409,
          error: "нельзя удалить проект с расшифровками",
        };
      }
    }

    const run = sqlite.transaction(() => {
      for (const row of creates) {
        createProject(row);
      }
      for (const row of updates) {
        updateProject(row.id, row);
      }
      for (const id of deletes) {
        deleteProject(id);
      }
    });
    run();
    return { ok: true, projects: listProjects() };
  }

  function upsertIntegrationToken(
    provider: string,
    input: {
      accessToken: string;
      refreshToken?: string | null;
      expiresAt?: string | null;
      meta?: Record<string, unknown>;
    },
  ): void {
    upsertIntegrationTokenStmt.run({
      provider,
      access_token: input.accessToken,
      refresh_token: input.refreshToken ?? null,
      expires_at: input.expiresAt ?? null,
      meta_json: JSON.stringify(input.meta ?? {}),
    });
  }

  function deleteIntegrationToken(provider: string): void {
    deleteIntegrationTokenStmt.run(provider);
  }

  function listProjectsSummary(): {
    projectCount: number;
    meetingCount: number;
    projects: Array<
      Project & {
        lastMeeting: {
          id: string;
          title: string | null;
          status: MeetingStatus;
          startedAt: string | null;
        } | null;
      }
    >;
  } {
    const projects = listProjects();
    const meetings = listMeetings();
    return {
      projectCount: projects.length,
      meetingCount: meetings.length,
      projects: projects.map((project) => {
        const projectMeetings = meetings
          .filter((meeting) => meeting.projectId === project.id)
          .sort((a, b) => {
            const aTime = a.startedAt ?? a.id;
            const bTime = b.startedAt ?? b.id;
            return bTime.localeCompare(aTime);
          });
        const lastMeeting = projectMeetings[0];
        return {
          ...project,
          meetingCount: projectMeetings.length,
          lastMeeting: lastMeeting
            ? {
                id: lastMeeting.id,
                title: lastMeeting.title,
                status: lastMeeting.status,
                startedAt: lastMeeting.startedAt,
              }
            : null,
        };
      }),
    };
  }

  function getDefaultProject(): Project {
    const project = getProject(currentDefaultProjectId());
    if (!project) {
      throw new Error("проект по умолчанию не найден");
    }
    return project;
  }

  function getUserByEmail(email: string): (User & { passwordHash: string | null }) | null {
    const row = selectUserByEmail.get(email) as Record<string, unknown> | undefined;
    if (!row) {
      return null;
    }
    return {
      ...rowToUser(row),
      passwordHash: row.password_hash == null ? null : String(row.password_hash),
    };
  }

  function getUserById(id: string): User | null {
    const row = selectUserById.get(id) as Record<string, unknown> | undefined;
    return row ? rowToUser(row) : null;
  }

  function getUserByGoogleSub(sub: string): User | null {
    const row = selectUserByGoogleSub.get(sub) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToUser(row) : null;
  }

  function createUser(input: {
    email: string;
    displayName: string;
    passwordHash?: string | null;
    googleSub?: string | null;
    role?: UserRole;
  }): User {
    const id = crypto.randomUUID();
    insertUser.run({
      id,
      email: input.email.trim().toLowerCase(),
      password_hash: input.passwordHash ?? null,
      google_sub: input.googleSub ?? null,
      display_name: input.displayName,
      created_at: new Date().toISOString(),
      role: input.role ?? "user",
    });
    const created = getUserById(id);
    if (!created) {
      throw new Error("не удалось создать пользователя");
    }
    return created;
  }

  function updateUserPassword(userId: string, passwordHash: string): void {
    updateUserPasswordStmt.run(passwordHash, userId);
  }

  function linkUserGoogle(userId: string, googleSub: string, displayName: string): User {
    updateUserGoogle.run({
      id: userId,
      google_sub: googleSub,
      display_name: displayName,
    });
    const updated = getUserById(userId);
    if (!updated) {
      throw new Error("пользователь не найден");
    }
    return updated;
  }

  function createSession(userId: string, ttlMs: number): {
    id: string;
    userId: string;
    expiresAt: string;
    createdAt: string;
  } {
    deleteExpiredSessions.run(new Date().toISOString());
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    insertSession.run({
      id,
      user_id: userId,
      expires_at: expiresAt,
      created_at: createdAt,
    });
    return { id, userId, expiresAt, createdAt };
  }

  function getSession(sessionId: string): {
    id: string;
    userId: string;
    expiresAt: string;
    user: User;
  } | null {
    deleteExpiredSessions.run(new Date().toISOString());
    const row = selectSession.get(sessionId) as Record<string, unknown> | undefined;
    if (!row) {
      return null;
    }
    const expiresAt = String(row.expires_at);
    if (Date.parse(expiresAt) <= Date.now()) {
      deleteSession.run(sessionId);
      return null;
    }
    return {
      id: String(row.id),
      userId: String(row.user_id),
      expiresAt,
      user: {
        id: String(row.user_id),
        email: String(row.email),
        displayName: String(row.display_name),
        role: row.role === "admin" ? "admin" : "user",
      },
    };
  }

  function destroySession(sessionId: string): void {
    deleteSession.run(sessionId);
  }

  function isIntegrationConnected(provider: string): boolean {
    const row = selectIntegration.get(provider) as
      | { access_token: string; meta_json: string }
      | undefined;
    if (!row) {
      return false;
    }
    if (row.access_token === "stub") {
      return false;
    }
    try {
      const meta = JSON.parse(row.meta_json) as { stub?: boolean };
      if (meta.stub === true) {
        return false;
      }
    } catch {
      return true;
    }
    return true;
  }

  return {
    createMeeting,
    listMeetings,
    listMeetingsForUser,
    getMeeting,
    getMeetingForUser,
    searchMeetings,
    updateMeetingStatus,
    saveTranscript,
    listTranscript,
    saveSummary,
    getSummary,
    listHeadlines,
    saveActionItems,
    listActionItems,
    markActionItemsQueued,
    markActionItemsCreated,
    markActionItemsQueuedForAsana,
    markActionItemsSentToAsana,
    getSettings,
    putSettings,
    recordWebhookDelivery,
    listWebhookDeliveries,
    enqueueJob,
    claimNextJob,
    listJobs,
    listJobsForMeeting,
    hasActiveJob,
    finishJob,
    failJob,
    failStaleRunningJobs,
    failAllRunningJobs,
    listProjects,
    getProject,
    createProject,
    updateProject,
    deleteProject,
    applyProjectsBatch,
    listProjectsSummary,
    getDefaultProject,
    getUserByEmail,
    getUserById,
    getUserByGoogleSub,
    createUser,
    updateUserPassword,
    linkUserGoogle,
    createSession,
    getSession,
    destroySession,
    isIntegrationConnected,
    upsertIntegrationToken,
    deleteIntegrationToken,
    close() {
      sqlite.close();
    },
  };
}

export type Db = ReturnType<typeof createDb>;

let singleton: Db | undefined;

export function getDb(): Db {
  if (!singleton) {
    singleton = createDb();
  }
  return singleton;
}

export function setDb(db: Db): void {
  singleton = db;
}
