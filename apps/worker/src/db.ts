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
