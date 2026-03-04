import Database from 'better-sqlite3'
import path from 'node:path'

// same db file as the api - they run on the same machine
const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'threadr.db')
export const db = new Database(dbPath)

db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    plugin_id TEXT NOT NULL,
    key_value TEXT NOT NULL,
    label TEXT DEFAULT '',
    active INTEGER DEFAULT 1
  )
`)

db.exec(`
  CREATE TABLE IF NOT EXISTS monitors (
    id TEXT PRIMARY KEY,
    scan_id TEXT NOT NULL,
    interval TEXT NOT NULL CHECK(interval IN ('hourly', 'daily', 'weekly')),
    last_run TEXT,
    next_run TEXT,
    active INTEGER DEFAULT 1
  )
`)

db.exec(`
  CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY,
    scan_id TEXT NOT NULL,
    monitor_id TEXT,
    type TEXT NOT NULL CHECK(type IN ('breach', 'open_port', 'subdomain', 'repository', 'whois_change', 'social_profile')),
    severity TEXT NOT NULL CHECK(severity IN ('critical', 'high', 'medium', 'low')),
    title TEXT NOT NULL,
    detail TEXT DEFAULT '',
    seen INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )
`)
