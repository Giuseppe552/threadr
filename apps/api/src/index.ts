import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { Queue } from 'bullmq'
import { randomUUID } from 'node:crypto'

const scanQueue = new Queue('scans', {
  connection: { host: process.env.REDIS_HOST || 'localhost', port: 6379 },
})

const app = new Hono()

app.get('/health', (c) => c.json({ status: 'ok' }))

app.post('/scan', async (c) => {
  const body = await c.req.json()
  const { seed } = body

  if (!seed || typeof seed !== 'string') {
    return c.json({ error: 'seed required' }, 400)
  }

  const id = randomUUID()
  await scanQueue.add('scan', { id, seed }, { jobId: id })

  return c.json({ id, seed, status: 'queued' }, 201)
})

serve({ fetch: app.fetch, port: 3001 }, (info) => {
  console.log(`api running on :${info.port}`)
})
