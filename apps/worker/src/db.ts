import Database from 'better-sqlite3'
import path from 'node:path'

// same db file as the api - they run on the same machine
const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'threadr.db')
export const db = new Database(dbPath)

db.pragma('journal_mode = WAL')
