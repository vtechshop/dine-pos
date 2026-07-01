import * as SQLite from 'expo-sqlite';

// Opened at module load time — synchronous, safe outside React components.
const db = SQLite.openDatabaseSync('dinepos.db');

// WAL mode: writes survive crashes; readers never block writers.
db.execSync('PRAGMA journal_mode = WAL');
db.execSync('PRAGMA synchronous = NORMAL');
db.execSync('PRAGMA foreign_keys = ON');

// ── Schema ──────────────────────────────────────────────────────────────────

db.execSync(`
  CREATE TABLE IF NOT EXISTS auth_cache (
    id          INTEGER PRIMARY KEY CHECK (id = 1),
    jwt         TEXT,
    hotel_id    TEXT,
    hotel_name  TEXT,
    cached_at   TEXT
  )
`);

db.execSync(`
  CREATE TABLE IF NOT EXISTS order_queue (
    id           TEXT PRIMARY KEY,
    payload      TEXT    NOT NULL,
    status       TEXT    DEFAULT 'pending',
    retries      INTEGER DEFAULT 0,
    next_attempt TEXT,
    created_at   TEXT    NOT NULL,
    synced_at    TEXT,
    error        TEXT
  )
`);

db.execSync(`
  CREATE TABLE IF NOT EXISTS local_products (
    id        TEXT PRIMARY KEY,
    data      TEXT NOT NULL,
    synced_at TEXT
  )
`);

db.execSync(`
  CREATE TABLE IF NOT EXISTS local_categories (
    id        TEXT PRIMARY KEY,
    data      TEXT NOT NULL,
    synced_at TEXT
  )
`);

db.execSync(`
  CREATE TABLE IF NOT EXISTS local_tables (
    id        TEXT PRIMARY KEY,
    data      TEXT NOT NULL,
    synced_at TEXT
  )
`);

db.execSync(`
  CREATE TABLE IF NOT EXISTS local_settings (
    id        INTEGER PRIMARY KEY CHECK (id = 1),
    data      TEXT NOT NULL,
    synced_at TEXT
  )
`);

db.execSync(`
  CREATE TABLE IF NOT EXISTS local_customers (
    phone     TEXT PRIMARY KEY,
    data      TEXT NOT NULL,
    synced_at TEXT
  )
`);

db.execSync(`
  CREATE TABLE IF NOT EXISTS cart_snapshot (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    data       TEXT,
    updated_at TEXT
  )
`);

db.execSync(`
  CREATE TABLE IF NOT EXISTS sync_meta (
    key   TEXT PRIMARY KEY,
    value TEXT
  )
`);

// ── Performance indexes (idempotent — safe to run on every startup) ──────────
// These cover the hot query path: getPendingOrders + count queries.

db.execSync('CREATE INDEX IF NOT EXISTS idx_oq_status_attempt ON order_queue(status, next_attempt)');
db.execSync('CREATE INDEX IF NOT EXISTS idx_oq_status         ON order_queue(status)');
db.execSync('CREATE INDEX IF NOT EXISTS idx_oq_created        ON order_queue(created_at)');

// ── Schema migrations (PRAGMA user_version tracks applied version) ───────────
// Each migration block is a one-time structural change to existing installs.
// Fresh installs still need migrations because CREATE TABLE above is unchanged.

const dbVersion =
  db.getFirstSync<{ user_version: number }>('PRAGMA user_version')?.user_version ?? 0;

if (dbVersion < 1) {
  // v1: add offline_id column for server-side idempotency (dedup on retry).
  // The try/catch handles fresh installs where the column might already exist.
  try { db.execSync('ALTER TABLE order_queue ADD COLUMN offline_id TEXT'); } catch {}
  try {
    // Sparse unique: NULLs are not considered duplicates in SQLite.
    db.execSync('CREATE UNIQUE INDEX IF NOT EXISTS idx_oq_offline_id ON order_queue(offline_id)');
  } catch {}
  db.execSync('PRAGMA user_version = 1');
}

export { db };
