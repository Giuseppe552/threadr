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

const SEV_COLORS: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  low: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
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

  return (
    <div className="p-4 max-w-4xl">
      <div className="flex items-center gap-3 mb-4">
        <div className="text-xs text-text-muted uppercase tracking-wider">alerts</div>
        <div className="flex gap-1 ml-auto">
          {['', 'critical', 'high', 'medium', 'low'].map(s => (
            <button
              key={s}
              onClick={() => { setFilter(s); setTimeout(fetchAlerts, 0) }}
              className={`text-xs px-2 py-0.5 rounded-sm border ${filter === s ? 'border-text-muted text-text' : 'border-border text-text-muted'}`}
            >{s || 'all'}</button>
          ))}
        </div>
      </div>

      {alerts.length === 0 ? (
        <div className="text-sm text-text-muted">no alerts yet</div>
      ) : (
        <div className="space-y-1 mb-8">
          {alerts.map(a => (
            <div key={a.id} className={`flex items-center gap-3 text-sm py-1.5 px-2 rounded-sm ${a.seen ? 'opacity-50' : ''}`}>
              <span className={`text-xs px-1.5 py-0.5 rounded border ${SEV_COLORS[a.severity] || ''}`}>{a.severity}</span>
              <span className="flex-1">{a.title}</span>
              <span className="text-xs text-text-muted">{a.type}</span>
              {!a.seen && (
                <button onClick={() => markSeen(a.id)} className="text-xs text-text-muted hover:text-text">mark seen</button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="text-xs text-text-muted uppercase tracking-wider mb-3">monitors</div>
      {monitors.length === 0 ? (
        <div className="text-sm text-text-muted">no monitors configured</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-text-muted text-xs border-b border-border">
              <th className="py-1 pr-4">seed</th>
              <th className="py-1 pr-4">interval</th>
              <th className="py-1 pr-4">next run</th>
              <th className="py-1"></th>
            </tr>
          </thead>
          <tbody>
            {monitors.map(m => (
              <tr key={m.id} className="border-b border-border">
                <td className="py-1.5 pr-4 mono text-mono">{m.seed}</td>
                <td className="py-1.5 pr-4 text-text-muted">{m.interval}</td>
                <td className="py-1.5 pr-4 text-text-muted text-xs">{m.next_run ? new Date(m.next_run).toLocaleString() : '-'}</td>
                <td className="py-1.5">
                  <button onClick={() => deleteMonitor(m.id)} className="text-xs text-red-500 hover:underline">delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
