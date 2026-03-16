import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { Queue } from 'bullmq'
import { randomUUID } from 'node:crypto'
import { db } from './db.js'
import { getGraph, getMerges, confirmMerge, rejectMerge } from './graph.js'
import { toGraphML, detectSeedType } from './graphml.js'

const scanQueue = new Queue('scans', {
  connection: { host: process.env.REDIS_HOST || 'localhost', port: 6379 },
})

const app = new Hono()
app.use('*', cors())

// Token auth middleware — skip if API_TOKEN is not set (local-only usage)
const apiToken = process.env.API_TOKEN
app.use('*', async (c, next) => {
  // Health check is always public
  if (c.req.path === '/health') return next()
  // If no token configured, skip auth (backwards compatible)
  if (!apiToken) return next()

  const auth = c.req.header('authorization')
  const bearer = auth?.startsWith('Bearer ') ? auth.slice(7) : null
  const query = c.req.query('token')
  const token = bearer || query

  if (!token || token !== apiToken) {
    return c.json({ error: 'unauthorized' }, 401)
  }
  return next()
})

app.get('/health', (c) => c.json({ status: 'ok' }))

const scanLimits = new Map<string, { count: number, reset: number }>()

app.post('/scan', async (c) => {
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const now = Date.now()
  const entry = scanLimits.get(ip)
  if (entry && entry.reset > now && entry.count >= 10) {
    return c.json({ error: 'rate limited — try again later' }, 429)
  }
  if (!entry || entry.reset <= now) {
    scanLimits.set(ip, { count: 1, reset: now + 3600_000 })
  } else {
    entry.count++
  }

  const body = await c.req.json()
  const { seed } = body

  if (!seed || typeof seed !== 'string') {
    return c.json({ error: 'seed required' }, 400)
  }

  const id = randomUUID()
  const type = detectSeedType(seed)

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

// --- export ---

app.get('/scan/:id/export', async (c) => {
  const row = db.prepare('SELECT * FROM scans WHERE id = ?').get(c.req.param('id')) as { seed: string; id: string } | undefined
  if (!row) return c.json({ error: 'scan not found' }, 404)

  const format = c.req.query('format') || 'json'
  const graph = await getGraph(row.seed)

  if (format === 'graphml') {
    const xml = toGraphML(graph.nodes, graph.edges)
    c.header('Content-Type', 'application/xml')
    c.header('Content-Disposition', `attachment; filename="threadr-${row.id.slice(0, 8)}.graphml"`)
    return c.body(xml)
  }

  // Default: JSON
  c.header('Content-Disposition', `attachment; filename="threadr-${row.id.slice(0, 8)}.json"`)
  return c.json({
    scan_id: row.id,
    seed: row.seed,
    exported_at: new Date().toISOString(),
    nodes: graph.nodes,
    edges: graph.edges,
  })
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

// --- merge suggestions ---

app.get('/scan/:id/merges', async (c) => {
  const row = db.prepare('SELECT * FROM scans WHERE id = ?').get(c.req.param('id')) as { seed: string } | undefined
  if (!row) return c.json({ error: 'scan not found' }, 404)
  const merges = await getMerges()
  return c.json(merges)
})

app.post('/merge', async (c) => {
  const body = await c.req.json()
  const { fromId, toId, action } = body
  if (!fromId || !toId || !action) return c.json({ error: 'fromId, toId, action required' }, 400)

  if (action === 'confirm') {
    await confirmMerge(fromId, toId)
  } else {
    await rejectMerge(fromId, toId)
  }
  return c.json({ ok: true })
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
    { id: 'hibp', name: 'Have I Been Pwned', requiresKey: true },
  ]
  return c.json(plugins)
})

// --- alerts ---

app.get('/alerts', (c) => {
  const scanId = c.req.query('scan_id')
  const severity = c.req.query('severity')
  let sql = 'SELECT * FROM alerts WHERE 1=1'
  const params: string[] = []
  if (scanId) { sql += ' AND scan_id = ?'; params.push(scanId) }
  if (severity) { sql += ' AND severity = ?'; params.push(severity) }
  sql += ' ORDER BY created_at DESC LIMIT 100'
  const rows = db.prepare(sql).all(...params)
  return c.json(rows)
})

app.get('/alerts/count', (c) => {
  const row = db.prepare('SELECT COUNT(*) as count FROM alerts WHERE seen = 0').get() as { count: number }
  return c.json({ count: row.count })
})

app.post('/alerts/:id/seen', (c) => {
  db.prepare('UPDATE alerts SET seen = 1 WHERE id = ?').run(c.req.param('id'))
  return c.json({ ok: true })
})

// --- monitors ---

app.get('/monitors', (c) => {
  const rows = db.prepare(`
    SELECT m.*, s.seed FROM monitors m JOIN scans s ON m.scan_id = s.id ORDER BY m.next_run
  `).all()
  return c.json(rows)
})

app.post('/monitor', async (c) => {
  const body = await c.req.json()
  const { scan_id, interval } = body
  if (!scan_id || !interval) return c.json({ error: 'scan_id and interval required' }, 400)

  const id = randomUUID()
  const next = new Date()
  if (interval === 'hourly') next.setHours(next.getHours() + 1)
  else if (interval === 'daily') next.setDate(next.getDate() + 1)
  else next.setDate(next.getDate() + 7)

  db.prepare('INSERT INTO monitors (id, scan_id, interval, next_run) VALUES (?, ?, ?, ?)').run(id, scan_id, interval, next.toISOString())
  return c.json({ id, scan_id, interval }, 201)
})

app.delete('/monitor/:id', (c) => {
  db.prepare('DELETE FROM monitors WHERE id = ?').run(c.req.param('id'))
  return c.json({ ok: true })
})

serve({ fetch: app.fetch, port: 3001 }, (info) => {
  console.log(`api running on :${info.port}`)
})
