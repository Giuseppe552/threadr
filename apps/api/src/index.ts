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

// --- settings ---

app.get('/settings/keys', (c) => {
  const rows = db.prepare('SELECT id, plugin_id, label, active FROM api_keys ORDER BY plugin_id').all()
  return c.json(rows)
})

app.post('/settings/keys', async (c) => {
  const body = await c.req.json()
  const { plugin_id, key_value, label } = body
  if (!plugin_id || !key_value) return c.json({ error: 'plugin_id and key_value required' }, 400)

  const id = randomUUID()
  db.prepare('INSERT INTO api_keys (id, plugin_id, key_value, label) VALUES (?, ?, ?, ?)').run(id, plugin_id, key_value, label || '')
  return c.json({ id, plugin_id, label }, 201)
})

app.delete('/settings/keys/:id', (c) => {
  db.prepare('DELETE FROM api_keys WHERE id = ?').run(c.req.param('id'))
  return c.json({ ok: true })
})

app.get('/settings/plugins', (c) => {
  // static list — worker knows the real registry but this is good enough for the UI
  const plugins = [
    { id: 'github', name: 'GitHub', requiresKey: false },
    { id: 'crtsh', name: 'Certificate Transparency', requiresKey: false },
    { id: 'dns', name: 'DNS Records', requiresKey: false },
    { id: 'gravatar', name: 'Gravatar', requiresKey: false },
    { id: 'social', name: 'Social Profiles', requiresKey: false },
    { id: 'shodan', name: 'Shodan', requiresKey: true },
    { id: 'git-emails', name: 'Git Email Scraper', requiresKey: false },
    { id: 'whois', name: 'WHOIS', requiresKey: false },
    { id: 'virustotal', name: 'VirusTotal', requiresKey: true },
    { id: 'pgp', name: 'PGP Keyserver', requiresKey: false },
  ]
  return c.json(plugins)
})

serve({ fetch: app.fetch, port: 3001 }, (info) => {
  console.log(`api running on :${info.port}`)
})
