import { randomUUID } from 'node:crypto'
import { db } from './db.js'
import { runScan } from './scan.js'
import { takeSnapshot, diffSnapshots } from './snapshot.js'
import type { SnapshotDiff } from './snapshot.js'

interface MonitorRow {
  id: string
  scan_id: string
  interval: string
  next_run: string
}

interface ScanRow {
  id: string
  seed: string
}

type AlertType = 'breach' | 'open_port' | 'subdomain' | 'repository' | 'whois_change' | 'social_profile'
type Severity = 'critical' | 'high' | 'medium' | 'low'

function classify(label: string, edge: string): { type: AlertType; severity: Severity } {
  if (label === 'Breach') return { type: 'breach', severity: 'critical' }
  if (label === 'Port') return { type: 'open_port', severity: 'high' }
  if (label === 'Domain' && edge.includes('HAS_CERT')) return { type: 'subdomain', severity: 'medium' }
  if (label === 'Repository') return { type: 'repository', severity: 'medium' }
  if (label === 'Username') return { type: 'social_profile', severity: 'low' }
  return { type: 'subdomain', severity: 'low' }
}

function classifyPropChange(field: string): { type: AlertType; severity: Severity } {
  if (field.startsWith('whois_')) return { type: 'whois_change', severity: 'medium' }
  return { type: 'subdomain', severity: 'low' }
}

function nextRun(interval: string): string {
  const d = new Date()
  if (interval === 'hourly') d.setHours(d.getHours() + 1)
  else if (interval === 'daily') d.setDate(d.getDate() + 1)
  else d.setDate(d.getDate() + 7)
  return d.toISOString()
}

function createAlerts(scanId: string, monitorId: string, diff: SnapshotDiff) {
  const insert = db.prepare(
    'INSERT INTO alerts (id, scan_id, monitor_id, type, severity, title, detail) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )

  for (const node of diff.newNodes) {
    const { type, severity } = classify(node.label, '')
    const name = node.props.address || node.props.name || node.id
    insert.run(randomUUID(), scanId, monitorId, type, severity, `new ${node.label}: ${name}`, JSON.stringify(node.props))
  }

  for (const edge of diff.newEdges) {
    // edge format: "id-TYPE->id"
    const typeMatch = edge.match(/-(\w+)->/)
    const relType = typeMatch?.[1] || ''
    if (relType === 'OPEN_PORT') {
      insert.run(randomUUID(), scanId, monitorId, 'open_port', 'high', `new open port detected`, edge)
    }
  }

  for (const change of diff.changedProps) {
    const { type, severity } = classifyPropChange(change.field)
    insert.run(randomUUID(), scanId, monitorId, type, severity, `${change.label} ${change.field} changed`, `${change.before} -> ${change.after}`)
  }
}

export async function checkDueMonitors() {
  const now = new Date().toISOString()
  const due = db.prepare('SELECT * FROM monitors WHERE active = 1 AND next_run <= ?').all(now) as MonitorRow[]

  for (const m of due) {
    const scan = db.prepare('SELECT id, seed FROM scans WHERE id = ?').get(m.scan_id) as ScanRow | undefined
    if (!scan) continue

    console.log(`[*] monitor: re-scanning ${scan.seed}`)
    try {
      const before = await takeSnapshot(scan.seed)
      await runScan(scan.id, scan.seed)
      const after = await takeSnapshot(scan.seed)
      const diff = diffSnapshots(before, after)

      if (diff.newNodes.length || diff.newEdges.length || diff.changedProps.length) {
        console.log(`[+] monitor: ${diff.newNodes.length} new nodes, ${diff.newEdges.length} new edges`)
        createAlerts(scan.id, m.id, diff)
      }
    } catch (err) {
      console.log(`[!] monitor: ${(err as Error).message}`)
    }

    db.prepare('UPDATE monitors SET last_run = ?, next_run = ? WHERE id = ?').run(now, nextRun(m.interval), m.id)
  }
}
