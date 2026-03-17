import { useState, useEffect } from 'react'

interface Alert {
  id: string
  scan_id: string
  type: string
  severity: string
  title: string
  detail: string
  seen: number
  created_at: string
}

interface Monitor {
  id: string
  scan_id: string
  seed: string
  interval: string
  last_run: string | null
  next_run: string
  active: number
}

const SEV_CLASS: Record<string, string> = {
  critical: 'sev-critical',
  high: 'sev-high',
  medium: 'sev-medium',
  low: 'sev-low',
}

export function Alerts() {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [monitors, setMonitors] = useState<Monitor[]>([])
  const [filter, setFilter] = useState('')

  useEffect(() => {
    fetchAlerts()
    fetch('/api/monitors').then(r => r.json()).then(setMonitors).catch(() => {})
  }, [])

  function fetchAlerts() {
    const url = filter ? `/api/alerts?severity=${filter}` : '/api/alerts'
    fetch(url).then(r => r.json()).then(setAlerts).catch(() => {})
  }

  async function markSeen(id: string) {
    await fetch(`/api/alerts/${id}/seen`, { method: 'POST' })
    setAlerts(alerts.map(a => a.id === id ? { ...a, seen: 1 } : a))
  }

  async function deleteMonitor(id: string) {
    await fetch(`/api/monitor/${id}`, { method: 'DELETE' })
    setMonitors(monitors.filter(m => m.id !== id))
  }

  const unseen = alerts.filter(a => !a.seen).length

  return (
    <div className="p-5 max-w-5xl">
      {/* Header + filters */}
      <div className="flex items-center gap-3 mb-5">
        <div className="section-label">
          alerts
          {unseen > 0 && <span className="ml-2 text-critical">{unseen} new</span>}
        </div>
        <div className="flex gap-1 ml-auto">
          {['', 'critical', 'high', 'medium', 'low'].map(s => (
            <button
              key={s}
              onClick={() => { setFilter(s); setTimeout(fetchAlerts, 0) }}
              className={`btn text-[10px] py-1 px-2 ${filter === s ? '!border-accent/30 !text-accent !bg-accent/8' : ''}`}
            >{s || 'all'}</button>
          ))}
        </div>
      </div>

      {/* Alert list */}
      {alerts.length === 0 ? (
        <div className="intel-card p-8 text-center">
          <div className="mono text-text-muted text-sm">no alerts</div>
          <div className="text-text-muted text-xs mt-1">set up a monitor on any scan to start receiving alerts</div>
        </div>
      ) : (
        <div className="space-y-1.5 mb-10">
          {alerts.map(a => (
            <div
              key={a.id}
              className={`intel-card flex items-center gap-3 px-4 py-3 transition-opacity ${a.seen ? 'opacity-40' : ''}`}
            >
              <span className={`mono text-[10px] px-2 py-0.5 rounded ${SEV_CLASS[a.severity] || ''}`}>
                {a.severity}
              </span>
              <span className="flex-1 text-sm text-text-secondary">{a.title}</span>
              <span className="section-label">{a.type}</span>
              {!a.seen && (
                <button onClick={() => markSeen(a.id)} className="btn text-[10px] py-0.5 px-2">dismiss</button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Monitors */}
      <div className="section-label mb-3">active monitors</div>
      {monitors.length === 0 ? (
        <div className="intel-card p-6 text-center">
          <div className="text-text-muted text-xs">no monitors configured</div>
        </div>
      ) : (
        <div className="space-y-1.5">
          {monitors.map(m => (
            <div key={m.id} className="intel-card flex items-center gap-4 px-4 py-3">
              <div className="status-dot status-dot-active" />
              <span className="mono text-sm text-mono flex-1">{m.seed}</span>
              <span className="section-label">{m.interval}</span>
              <span className="text-xs text-text-muted mono">
                next: {m.next_run ? new Date(m.next_run).toLocaleDateString() : '-'}
              </span>
              <button onClick={() => deleteMonitor(m.id)} className="btn text-[10px] py-0.5 px-2 !text-critical !border-critical/20 hover:!bg-critical/10">
                remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
