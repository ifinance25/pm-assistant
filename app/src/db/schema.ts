import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

const DEFAULT_PROJECT_NAME = "Свои";

function columnExists(
  sqlite: Database.Database,
  table: string,
  column: string,
): boolean {
  const cols = sqlite.pragma(`table_info(${table})`) as { name: string }[];
  return cols.some((col) => col.name === column);
}

const TRACKER_BACKFILL_VERSION = 1;
const ADMIN_ROLE_BACKFILL_VERSION = 2;

function userVersion(sqlite: Database.Database): number {
  const row = sqlite.prepare("PRAGMA user_version").get() as
    | { user_version?: number }
    | undefined;
  return Number(row?.user_version ?? 0);
}

function migrateActionItemsTracker(sqlite: Database.Database): void {
  if (!columnExists(sqlite, "action_items", "tracker_type")) {
    sqlite.exec(`
      ALTER TABLE action_items ADD COLUMN tracker_type TEXT;
      ALTER TABLE action_items ADD COLUMN tracker_state TEXT NOT NULL DEFAULT 'none';
      ALTER TABLE action_items ADD COLUMN tracker_external_id TEXT;
    `);
  }

  if (userVersion(sqlite) >= TRACKER_BACKFILL_VERSION) {
    return;
  }

  sqlite.exec(`
    UPDATE action_items
    SET
      tracker_state = CASE asana_state
        WHEN 'queued_for_asana' THEN 'queued'
        WHEN 'sent' THEN 'created'
        ELSE 'none'
      END,
      tracker_type = CASE
        WHEN asana_state IN ('queued_for_asana', 'sent') THEN 'asana'
        ELSE NULL
      END
    WHERE tracker_type IS NULL;
  `);
  sqlite.exec(`PRAGMA user_version = ${TRACKER_BACKFILL_VERSION}`);
}

function migrateExistingUsersToAdmin(sqlite: Database.Database): void {
  if (!columnExists(sqlite, "users", "role")) {
    return;
  }
  if (userVersion(sqlite) >= ADMIN_ROLE_BACKFILL_VERSION) {
    return;
  }
  sqlite.exec("UPDATE users SET role = 'admin'");
  sqlite.exec(`PRAGMA user_version = ${ADMIN_ROLE_BACKFILL_VERSION}`);
}

function seedDefaultProject(sqlite: Database.Database): string {
  const existing = sqlite
    .prepare("SELECT id FROM projects LIMIT 1")
    .get() as { id: string } | undefined;
  if (existing) {
    return existing.id;
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO projects (
        id, name, tracker_project_ref, tracker_parent_ref, created_at, updated_at
      ) VALUES (?, ?, '', '', ?, ?)`,
    )
    .run(id, DEFAULT_PROJECT_NAME, now, now);
  return id;
}

function backfillMeetingProjects(
  sqlite: Database.Database,
  defaultProjectId: string,
): void {
  if (!columnExists(sqlite, "meetings", "project_id")) {
    return;
  }
  sqlite
    .prepare(
      "UPDATE meetings SET project_id = ? WHERE project_id IS NULL OR project_id = ''",
    )
    .run(defaultProjectId);
}

export function migrate(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS meetings (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      platform TEXT NOT NULL,
      title TEXT,
      status TEXT NOT NULL,
      recording_mode TEXT NOT NULL,
      started_at TEXT,
      ended_at TEXT,
      error TEXT,
      announcement_status TEXT,
      source TEXT NOT NULL,
      audio_path TEXT
    );

    CREATE TABLE IF NOT EXISTS transcript_segments (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL REFERENCES meetings(id),
      speaker TEXT NOT NULL,
      started_at_ms INTEGER NOT NULL,
      ended_at_ms INTEGER,
      text TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS summaries (
      meeting_id TEXT PRIMARY KEY REFERENCES meetings(id),
      headline TEXT NOT NULL,
      decisions TEXT NOT NULL,
      risks TEXT NOT NULL,
      next_step TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS action_items (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL REFERENCES meetings(id),
      assignee TEXT,
      title TEXT NOT NULL,
      due_at TEXT,
      timecode_ms INTEGER,
      segment_id TEXT,
      asana_state TEXT NOT NULL DEFAULT 'none'
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL REFERENCES meetings(id),
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      claimed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL REFERENCES meetings(id),
      url TEXT NOT NULL,
      status TEXT NOT NULL,
      detail TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      tracker_project_ref TEXT NOT NULL DEFAULT '',
      tracker_parent_ref TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      google_sub TEXT UNIQUE,
      display_name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS integration_tokens (
      provider TEXT PRIMARY KEY,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      expires_at TEXT,
      meta_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS meetings_fts USING fts5(
      meeting_id UNINDEXED,
      content,
      tokenize = 'unicode61'
    );
  `);

  const insertDefault = sqlite.prepare(
    "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
  );
  insertDefault.run("recordingModeDefault", "text");
  insertDefault.run("asanaProjectLabel", "");
  insertDefault.run("asanaAutoSend", "false");
  insertDefault.run("webhookUrl", "");
  insertDefault.run("trackerType", "clickup");

  const jobCols = sqlite.pragma("table_info(jobs)") as { name: string }[];
  if (!jobCols.some((col) => col.name === "claimed_at")) {
    sqlite.exec("ALTER TABLE jobs ADD COLUMN claimed_at TEXT");
  }

  if (!columnExists(sqlite, "meetings", "project_id")) {
    sqlite.exec(
      "ALTER TABLE meetings ADD COLUMN project_id TEXT REFERENCES projects(id)",
    );
  }

  if (!columnExists(sqlite, "meetings", "owner_user_id")) {
    sqlite.exec("ALTER TABLE meetings ADD COLUMN owner_user_id TEXT");
  }

  if (!columnExists(sqlite, "users", "role")) {
    sqlite.exec(
      "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'",
    );
  }

  sqlite.exec("UPDATE users SET email = lower(email) WHERE email != lower(email)");
  sqlite.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS users_email_nocase ON users(email COLLATE NOCASE)",
  );

  migrateActionItemsTracker(sqlite);
  migrateExistingUsersToAdmin(sqlite);

  const defaultProjectId = seedDefaultProject(sqlite);
  backfillMeetingProjects(sqlite, defaultProjectId);
}

export function getDefaultProjectId(sqlite: Database.Database): string {
  return seedDefaultProject(sqlite);
}
