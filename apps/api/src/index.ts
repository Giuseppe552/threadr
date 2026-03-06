import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { Queue } from 'bullmq'
import { randomUUID } from 'node:crypto'
import { db } from './db.js'
import { getGraph } from './graph.js'

const scanQueue = new Queue('scans', {
  connection: { host: process.env.REDIS_HOST || 'localhost', port: 6379 },
})

const app = new Hono()
app.use('*', cors())

app.get('/health', (c) => c.json({ status: 'ok' }))

app.post('/scan', async (c) => {
  const body = await c.req.json()
  const { seed } = body

  if (!seed || typeof seed !== 'string') {
    return c.json({ error: 'seed required' }, 400)
  }

  const id = randomUUID()
  const type = seed.includes('@') ? 'email' : seed.includes('.') ? 'domain' : 'username'

  db.prepare(
    'INSERT INTO scans (id, seed, seed_type, status) VALUES (?, ?, ?, ?)'
  ).run(id, seed, type, 'queued')

  await scanQueue.add('scan', { id, seed }, { jobId: id })

  return c.json({ id, seed, type, status: 'queued' }, 201)
})

app.get('/scans', (c) => {
  const rows = db.prepare('SELECT * FROM scans ORDER BY created_at DESC LIMIT 50').all()
  return c.json(rows)
})

app.get('/scan/:id', (c) => {
  const row = db.prepare('SELECT * FROM scans WHERE id = ?').get(c.req.param('id'))
  if (!row) return c.json({ error: 'scan not found' }, 404)
  return c.json(row)
})

app.get('/scan/:id/graph', async (c) => {
  const row = db.prepare('SELECT * FROM scans WHERE id = ?').get(c.req.param('id')) as { seed: string } | undefined
  if (!row) return c.json({ error: 'scan not found' }, 404)
  const graph = await getGraph(row.seed)
  return c.json(graph)
})

// expand a specific node — re-run lookups from that node as seed
app.post('/scan/:id/expand', async (c) => {
  const row = db.prepare('SELECT * FROM scans WHERE id = ?').get(c.req.param('id')) as { id: string } | undefined
  if (!row) return c.json({ error: 'scan not found' }, 404)

  const body = await c.req.json()
  const { seed } = body
  if (!seed) return c.json({ error: 'seed required' }, 400)

  // queue expansion as a job tied to the same scan
  await scanQueue.add('scan', { id: row.id, seed }, { jobId: `${row.id}-expand-${Date.now()}` })

  return c.json({ status: 'expanding', seed })
})

serve({ fetch: app.fetch, port: 3001 }, (info) => {
  console.log(`api running on :${info.port}`)
})
