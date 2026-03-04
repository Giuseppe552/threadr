import { useState, useEffect } from 'react'
import { Outlet, Link } from 'react-router-dom'

export function Layout() {
  const [alertCount, setAlertCount] = useState(0)

  useEffect(() => {
    const check = () => fetch('/api/alerts/count').then(r => r.json()).then(d => setAlertCount(d.count)).catch(() => {})
    check()
    const id = setInterval(check, 30_000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="min-h-screen bg-bg text-text">
      <nav className="flex items-center justify-between px-4 py-2 border-b border-border">
        <Link to="/" className="mono text-sm font-bold tracking-wider">threadr</Link>
        <div className="flex gap-4 text-xs text-text-muted">
          <Link to="/" className="hover:text-text">scans</Link>
          <span className="text-border">|</span>
          <Link to="/alerts" className="hover:text-text">
            alerts{alertCount > 0 && <span className="ml-1 text-red-400">({alertCount})</span>}
          </Link>
          <span className="text-border">|</span>
          <Link to="/settings" className="hover:text-text">settings</Link>
        </div>
      </nav>
      <Outlet />
    </div>
  )
}
