-- Tabelin V2 schema (SQLite). One office server, <15 users. WAL mode is set in
-- code. Config/mapping that is already an object in V1 is stored as JSON text.

CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  username     TEXT NOT NULL UNIQUE,              -- AD account, normalized lower-case (e.g. domain\jdoe)
  display_name TEXT NOT NULL DEFAULT '',
  role         TEXT NOT NULL DEFAULT 'reviewer',  -- admin | reviewer
  active       INTEGER NOT NULL DEFAULT 1,
  pin_hash     TEXT NOT NULL DEFAULT '',          -- bcrypt of the PIN (empty = not set; claimed on first login)
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Browser login sessions (the non-AD path). On the office network the AD
-- handshake fills identity in and this is bypassed; kept for off-domain use.
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  username   TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

-- Projects group reviews (Project > Review). Admins create both.
CREATE TABLE IF NOT EXISTS projects (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A review is one Navisworks comment round inside a project; records hang off it.
CREATE TABLE IF NOT EXISTS reviews (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reviews_project ON reviews(project_id);

CREATE TABLE IF NOT EXISTS records (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id       INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  comment_id      TEXT,
  viewpoint       TEXT,
  commenter       TEXT,
  discipline      TEXT,
  comment_raw     TEXT,
  comment_text    TEXT,
  resolution      TEXT,
  status          TEXT,
  closed_at       TEXT,
  comment_date    TEXT,
  author_code     TEXT,
  camera_position TEXT,
  image_ref       TEXT,
  source          TEXT,
  extra           TEXT NOT NULL DEFAULT '{}',      -- JSON: custom (cf_) fields
  updated_by      INTEGER REFERENCES users(id),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_records_review ON records(review_id);

CREATE TABLE IF NOT EXISTS images (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id  INTEGER NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,                        -- before | after
  file_key   TEXT NOT NULL,                        -- key under the data files dir
  mime       TEXT,
  size       INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_images_record ON images(record_id);

-- Settings, detection rules, template mapping, statuses, custom-field defs.
-- scope is 'global', 'project:<id>' (template, statuses, detection, custom
-- fields shared by the project's reviews) or 'review:<id>' (e.g. the target).
CREATE TABLE IF NOT EXISTS config (
  scope TEXT NOT NULL,
  key   TEXT NOT NULL,
  json  TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (scope, key)
);

CREATE TABLE IF NOT EXISTS templates (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  file_key   TEXT NOT NULL,                        -- .xlsx stored under data files dir
  mapping    TEXT NOT NULL DEFAULT '{}',           -- JSON
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Per-comment history: who changed what, and when. One row per save (an edit,
-- a photo added or removed, an import). detail is JSON, e.g.
-- {"fields":["status","resolution"],"status":"Closed"}.
CREATE TABLE IF NOT EXISTS record_events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id INTEGER NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  user_id   INTEGER REFERENCES users(id),
  at        TEXT NOT NULL,
  action    TEXT NOT NULL,                        -- edit | photo | import
  detail    TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_record_events_record ON record_events(record_id);
