import { Worker } from 'bullmq'
import { runScan } from './scan.js'
import { db } from './db.js'
import { loadKeysFromDb } from './keyring.js'
import { checkDueMonitors } from './monitor.js'

loadKeysFromDb()

const worker = new Worker(
  'scans',
  async (job) => {
    const { id, seed } = job.data
    console.log(`[*] scan ${id}: ${seed}`)

    db.prepare('UPDATE scans SET status = ? WHERE id = ?').run('running', id)

    try {
      const stats = await runScan(id, seed)
      db.prepare(
        `UPDATE scans SET status = ?, node_count = ?, edge_count = ?, finished_at = datetime('now') WHERE id = ?`
      ).run('done', stats.nodes, stats.edges, id)
    } catch (e) {
      db.prepare('UPDATE scans SET status = ? WHERE id = ?').run('failed', id)
      throw e
    }

    console.log(`[*] scan ${id}: done`)
  },
  {
    connection: { host: process.env.REDIS_HOST || 'localhost', port: 6379 },
    concurrency: 2,
  }
)

worker.on('failed', (job, err) => {
  console.log(`[!] job ${job?.id} failed: ${err.message}`)
})

setInterval(checkDueMonitors, 60_000)

console.log('worker ready')
