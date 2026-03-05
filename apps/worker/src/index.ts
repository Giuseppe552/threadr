import { Worker } from 'bullmq'
import { runScan } from './scan.js'

const worker = new Worker(
  'scans',
  async (job) => {
    const { id, seed } = job.data
    console.log(`[*] scan ${id}: ${seed}`)
    await runScan(id, seed)
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

console.log('worker ready')
