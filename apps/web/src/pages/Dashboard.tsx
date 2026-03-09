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
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return `${Math.floor(hrs / 24)}d ago`
  }

  return (
    <div className="p-4 max-w-4xl">
      <form onSubmit={startScan} className="flex gap-2 mb-6">
        <input
          type="text"
          value={seed}
          onChange={e => setSeed(e.target.value)}
          placeholder="try: torvalds@linux-foundation.org"
          className="flex-1 bg-surface border border-border px-3 py-1.5 text-sm mono text-mono rounded-sm focus:outline-none focus:border-text-muted"
        />
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-1.5 text-sm bg-surface border border-border hover:border-text-muted rounded-sm disabled:opacity-50"
        >
          {loading ? '...' : 'scan'}
        </button>
      </form>
      {error && <div className="text-red-500 text-xs mb-4 -mt-4">{error}</div>}

      <div className="text-xs text-text-muted uppercase tracking-wider mb-2">recent scans</div>
      {fetching ? (
        <div className="text-sm text-text-muted">loading...</div>
      ) : scans.length === 0 ? (
        <div className="text-sm text-text-muted">no scans yet — enter an email, domain, or username above</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-text-muted text-xs border-b border-border">
              <th className="py-1 pr-4">seed</th>
              <th className="py-1 pr-4">type</th>
              <th className="py-1 pr-4">nodes</th>
              <th className="py-1 pr-4">edges</th>
              <th className="py-1">when</th>
            </tr>
          </thead>
          <tbody>
            {scans.map(s => (
              <tr
                key={s.id}
                onClick={() => nav(`/scan/${s.id}`)}
                className="border-b border-border cursor-pointer hover:bg-surface"
              >
                <td className="py-1.5 pr-4 mono text-mono">{s.seed}</td>
                <td className="py-1.5 pr-4 text-text-muted">{s.seed_type}</td>
                <td className="py-1.5 pr-4 mono">{s.node_count}</td>
                <td className="py-1.5 pr-4 mono">{s.edge_count}</td>
                <td className="py-1.5 text-text-muted">{timeAgo(s.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
