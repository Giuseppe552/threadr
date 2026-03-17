import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

interface ScanRow {
  id: string
  seed: string
  seed_type: string
  status: string
  node_count: number
  edge_count: number
  created_at: string
}

const TYPE_COLORS: Record<string, string> = {
  email: 'text-node-email',
  domain: 'text-node-domain',
  username: 'text-node-username',
  ip: 'text-node-ip',
}

export function Dashboard() {
  const [seed, setSeed] = useState('')
  const [scans, setScans] = useState<ScanRow[]>([])
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(true)
  const [error, setError] = useState('')
  const nav = useNavigate()

  useEffect(() => {
    fetch('/api/scans')
      .then(r => { if (!r.ok) throw new Error(r.statusText); return r.json() })
      .then(setScans)
      .catch(() => {})
      .finally(() => setFetching(false))
  }, [])

  async function startScan(e: React.FormEvent) {
    e.preventDefault()
    if (!seed.trim()) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed: seed.trim() }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || res.statusText)
      }
      const data = await res.json()
      nav(`/scan/${data.id}`)
    } catch (err) {
      setError((err as Error).message || 'scan failed')
    } finally {
      setLoading(false)
    }
  }

  function timeAgo(ts: string) {
    const diff = Date.now() - new Date(ts).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'now'
    if (mins < 60) return `${mins}m`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h`
    return `${Math.floor(hrs / 24)}d`
  }

  return (
    <div className="p-5 max-w-5xl">
      {/* Scan input */}
      <form onSubmit={startScan} className="flex gap-2 mb-8">
        <input
          type="text"
          value={seed}
          onChange={e => setSeed(e.target.value)}
          placeholder="email, domain, username, or IP"
          className="input flex-1"
          autoFocus
        />
        <button type="submit" disabled={loading} className="btn btn-primary">
          {loading ? (
            <span className="inline-block w-3 h-3 border border-accent/40 border-t-accent rounded-full animate-spin" />
          ) : 'scan'}
        </button>
      </form>

      {error && (
        <div className="mb-4 -mt-6 px-3 py-2 rounded text-xs border sev-critical">
          {error}
        </div>
      )}

      {/* Recent scans */}
      <div className="section-label mb-3">recent scans</div>

      {fetching ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="skeleton h-12 w-full" />
          ))}
        </div>
      ) : scans.length === 0 ? (
        <div className="intel-card p-8 text-center">
          <div className="mono text-text-muted text-sm mb-2">no scans yet</div>
          <div className="text-text-muted text-xs">
            enter an email, domain, or username above to start
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          {scans.map(s => (
            <div
              key={s.id}
              onClick={() => nav(`/scan/${s.id}`)}
              className="intel-card flex items-center gap-4 px-4 py-3 cursor-pointer group"
            >
              <div className="flex-1 min-w-0">
                <div className="mono text-sm text-mono truncate group-hover:text-text transition-colors">
                  {s.seed}
                </div>
              </div>

              <span className={`mono text-[10px] uppercase tracking-wider ${TYPE_COLORS[s.seed_type] || 'text-text-muted'}`}>
                {s.seed_type}
              </span>

              <div className="flex gap-4 text-xs text-text-muted mono">
                <span>{s.node_count} <span className="text-text-muted/60">nodes</span></span>
                <span>{s.edge_count} <span className="text-text-muted/60">edges</span></span>
              </div>

              <span className="text-[10px] text-text-muted mono w-8 text-right">{timeAgo(s.created_at)}</span>

              <StatusBadge status={s.status} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    queued: 'bg-text-muted/10 text-text-muted border-text-muted/20',
    running: 'bg-accent/10 text-accent border-accent/20 animate-pulse',
    done: 'bg-accent-2/10 text-accent-2 border-accent-2/20',
    failed: 'bg-critical/10 text-critical border-critical/20',
  }

  return (
    <span className={`mono text-[10px] px-2 py-0.5 rounded border ${styles[status] || ''}`}>
      {status}
    </span>
  )
}
