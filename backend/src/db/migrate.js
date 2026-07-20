/**
 * src/db/migrate.js — v9 Schema (unchanged from v8 — no new tables this release)
 * Adds: dataset_versions, dataset_files (actual stored data), comments,
 *       mentions, activity_feed, dataset_tags, shared_dashboards
 */
import { initPool, execMultiple, getBackend } from "./pool.js";
import { serviceLogger } from "../logger.js";
const log = serviceLogger("migrate");

const SCHEMA = [
  // ── Core ────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, email TEXT, role TEXT NOT NULL DEFAULT 'user', avatar_url TEXT, created_at TEXT NOT NULL, last_login TEXT, is_active INTEGER NOT NULL DEFAULT 1)`,
  `CREATE TABLE IF NOT EXISTS refresh_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, description TEXT, owner_id TEXT NOT NULL, brand_logo TEXT, brand_color TEXT DEFAULT '#1D9E75', brand_name TEXT, plan TEXT NOT NULL DEFAULT 'free', created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS workspace_members (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', invited_by TEXT, joined_at TEXT NOT NULL, UNIQUE(workspace_id,user_id))`,

  // ── Dataset Management (Google-Drive style) ─────────
  `CREATE TABLE IF NOT EXISTS datasets (
    id            TEXT PRIMARY KEY,
    workspace_id  TEXT,
    owner_id      TEXT NOT NULL,
    name          TEXT NOT NULL,
    description   TEXT,
    folder_id     TEXT,
    is_starred    INTEGER NOT NULL DEFAULT 0,
    is_trashed    INTEGER NOT NULL DEFAULT 0,
    trashed_at    TEXT,
    current_version_id TEXT,
    total_rows    INTEGER NOT NULL DEFAULT 0,
    total_cols    INTEGER NOT NULL DEFAULT 0,
    file_type     TEXT,
    size_bytes    INTEGER NOT NULL DEFAULT 0,
    quality_score REAL,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  )`,

  // Stores actual file content per version (so re-analysis doesn't need re-upload)
  `CREATE TABLE IF NOT EXISTS dataset_versions (
    id            TEXT PRIMARY KEY,
    dataset_id    TEXT NOT NULL,
    version_num   INTEGER NOT NULL,
    file_name     TEXT NOT NULL,
    file_content  TEXT NOT NULL,
    file_type     TEXT NOT NULL,
    total_rows    INTEGER NOT NULL,
    total_cols    INTEGER NOT NULL,
    col_analysis  TEXT,
    quality_score REAL,
    change_note   TEXT,
    uploaded_by   TEXT NOT NULL,
    size_bytes    INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS dataset_folders (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT,
    owner_id     TEXT NOT NULL,
    name         TEXT NOT NULL,
    parent_id    TEXT,
    created_at   TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS dataset_tags (
    id         TEXT PRIMARY KEY,
    dataset_id TEXT NOT NULL,
    tag        TEXT NOT NULL,
    UNIQUE(dataset_id, tag)
  )`,

  // ── Analyses (linked to dataset+version) ────────────
  `CREATE TABLE IF NOT EXISTS analyses (id TEXT PRIMARY KEY, user_id TEXT, workspace_id TEXT, dataset_id TEXT, version_id TEXT, file_name TEXT NOT NULL, file_type TEXT NOT NULL, total_rows INTEGER NOT NULL, total_cols INTEGER NOT NULL, prompt TEXT NOT NULL, analysis TEXT NOT NULL, stats_json TEXT, chart_config TEXT, quality_score REAL, duration_ms INTEGER, ip_address TEXT, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS chat_messages (id TEXT PRIMARY KEY, analysis_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS shared_reports (id TEXT PRIMARY KEY, analysis_id TEXT NOT NULL, user_id TEXT NOT NULL, token TEXT UNIQUE NOT NULL, title TEXT, password_hash TEXT, expires_at TEXT, view_count INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS scheduled_reports (id TEXT PRIMARY KEY, workspace_id TEXT, user_id TEXT NOT NULL, name TEXT NOT NULL, dataset_id TEXT, prompt TEXT NOT NULL, cron_expr TEXT NOT NULL, recipients TEXT NOT NULL, format TEXT NOT NULL DEFAULT 'pdf', is_active INTEGER NOT NULL DEFAULT 1, last_run TEXT, next_run TEXT, run_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,

  // ── Collaboration ────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS dataset_permissions (
    id         TEXT PRIMARY KEY,
    dataset_id TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    role       TEXT NOT NULL DEFAULT 'viewer',
    invited_by TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(dataset_id, user_id)
  )`,

  `CREATE TABLE IF NOT EXISTS comments (
    id           TEXT PRIMARY KEY,
    dataset_id   TEXT,
    analysis_id  TEXT,
    user_id      TEXT NOT NULL,
    parent_id    TEXT,
    content      TEXT NOT NULL,
    is_resolved  INTEGER NOT NULL DEFAULT 0,
    is_edited    INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL,
    updated_at   TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS mentions (
    id          TEXT PRIMARY KEY,
    comment_id  TEXT NOT NULL,
    mentioned_user_id TEXT NOT NULL,
    is_read     INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS activity_feed (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT,
    dataset_id   TEXT,
    user_id      TEXT NOT NULL,
    action       TEXT NOT NULL,
    target_type  TEXT,
    target_id    TEXT,
    metadata     TEXT,
    created_at   TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS shared_dashboards (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    name         TEXT NOT NULL,
    description  TEXT,
    layout       TEXT NOT NULL,
    created_by   TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS dashboard_widgets (
    id           TEXT PRIMARY KEY,
    dashboard_id TEXT NOT NULL,
    analysis_id  TEXT,
    dataset_id   TEXT,
    widget_type  TEXT NOT NULL,
    title        TEXT,
    config       TEXT NOT NULL,
    position     TEXT NOT NULL,
    created_at   TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS notifications (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    type       TEXT NOT NULL,
    title      TEXT NOT NULL,
    body       TEXT,
    link       TEXT,
    is_read    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, user_id TEXT, workspace_id TEXT, action TEXT NOT NULL, resource TEXT, ip_address TEXT, user_agent TEXT, created_at TEXT NOT NULL)`,

  // ── Indexes ───────────────────────────────────────────
  `CREATE INDEX IF NOT EXISTS idx_datasets_owner       ON datasets(owner_id)`,
  `CREATE INDEX IF NOT EXISTS idx_datasets_workspace   ON datasets(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_datasets_folder      ON datasets(folder_id)`,
  `CREATE INDEX IF NOT EXISTS idx_datasets_trashed     ON datasets(is_trashed)`,
  `CREATE INDEX IF NOT EXISTS idx_versions_dataset     ON dataset_versions(dataset_id)`,
  `CREATE INDEX IF NOT EXISTS idx_folders_workspace    ON dataset_folders(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_folders_parent       ON dataset_folders(parent_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tags_dataset         ON dataset_tags(dataset_id)`,
  `CREATE INDEX IF NOT EXISTS idx_perms_dataset        ON dataset_permissions(dataset_id)`,
  `CREATE INDEX IF NOT EXISTS idx_perms_user           ON dataset_permissions(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_comments_dataset     ON comments(dataset_id)`,
  `CREATE INDEX IF NOT EXISTS idx_comments_analysis    ON comments(analysis_id)`,
  `CREATE INDEX IF NOT EXISTS idx_comments_parent      ON comments(parent_id)`,
  `CREATE INDEX IF NOT EXISTS idx_mentions_user        ON mentions(mentioned_user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_activity_workspace   ON activity_feed(workspace_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_activity_dataset     ON activity_feed(dataset_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_widgets_dashboard    ON dashboard_widgets(dashboard_id)`,
  `CREATE INDEX IF NOT EXISTS idx_notif_user           ON notifications(user_id, is_read)`,
  `CREATE INDEX IF NOT EXISTS idx_analyses_dataset     ON analyses(dataset_id)`,
  `CREATE INDEX IF NOT EXISTS idx_analyses_created     ON analyses(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_refresh_hash         ON refresh_tokens(token_hash)`,
];

export async function migrate() {
  await execMultiple(SCHEMA);
  log.info({ backend: getBackend() }, "migrations applied");
}

if (process.argv[1].endsWith("migrate.js")) {
  await initPool(); await migrate(); process.exit(0);
}
