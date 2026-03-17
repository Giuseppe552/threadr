import { useState, useEffect } from 'react'
import { Outlet, Link, useLocation } from 'react-router-dom'

export function Layout() {
  const [alertCount, setAlertCount] = useState(0)
  const location = useLocation()

  useEffect(() => {
    const check = () => fetch('/api/alerts/count').then(r => r.json()).then(d => setAlertCount(d.count)).catch(() => {})
    check()
    const id = setInterval(check, 30_000)
    return () => clearInterval(id)
  }, [])

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/'
    return location.pathname.startsWith(path)
  }

  return (
    <div className="min-h-screen bg-bg text-text">
      <div className="intel-grid" />
      <div className="atmo-glow" />

      <nav className="relative z-10 flex items-center justify-between px-5 py-3 border-b border-border bg-bg-subtle/80 backdrop-blur-sm">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="status-dot status-dot-active" />
          <span className="mono text-sm font-bold tracking-wider text-text">threadr</span>
          <span className="section-label ml-1 hidden sm:inline">osint</span>
        </Link>

        <div className="flex gap-1">
          <NavLink to="/" active={isActive('/')} label="scans" />
          <NavLink to="/alerts" active={isActive('/alerts')} label="alerts" badge={alertCount > 0 ? alertCount : undefined} />
          <NavLink to="/settings" active={isActive('/settings')} label="settings" />
        </div>
      </nav>

      <main className="relative z-10">
        <Outlet />
      </main>
    </div>
  )
}

function NavLink({ to, active, label, badge }: { to: string; active: boolean; label: string; badge?: number }) {
  return (
    <Link
      to={to}
      className={`mono text-xs px-3 py-1.5 rounded transition-all ${
        active
          ? 'text-accent bg-accent/8 border border-accent/20'
          : 'text-text-muted hover:text-text-secondary border border-transparent hover:border-border'
      }`}
    >
      {label}
      {badge !== undefined && (
        <span className="ml-1.5 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold bg-critical/20 text-critical border border-critical/30">
          {badge}
        </span>
      )}
    </Link>
  )
}
