import { useState, useEffect } from 'react'

interface PluginInfo {
  id: string
  name: string
  requiresKey: boolean
}

interface ApiKey {
  id: string
  plugin_id: string
  label: string
  active: number
}

export function Settings() {
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [pluginId, setPluginId] = useState('')
  const [keyVal, setKeyVal] = useState('')
  const [label, setLabel] = useState('')

  useEffect(() => {
    fetch('/api/settings/plugins').then(r => r.json()).then(setPlugins).catch(() => {})
    fetchKeys()
  }, [])

  function fetchKeys() {
    fetch('/api/settings/keys').then(r => r.json()).then(setKeys).catch(() => {})
  }

  async function addKey(e: React.FormEvent) {
    e.preventDefault()
    if (!pluginId || !keyVal) return
    await fetch('/api/settings/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plugin_id: pluginId, key_value: keyVal, label }),
    })
    setKeyVal('')
    setLabel('')
    fetchKeys()
  }

  async function removeKey(id: string) {
    await fetch(`/api/settings/keys/${id}`, { method: 'DELETE' })
    fetchKeys()
  }

  const keyed = plugins.filter(p => p.requiresKey)
  const configuredIds = new Set(keys.map(k => k.plugin_id))

  return (
    <div className="p-5 max-w-4xl">
      {/* Plugin status */}
      <div className="section-label mb-3">plugins</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-10">
        {plugins.map(p => {
          const hasKey = configuredIds.has(p.id)
          const active = !p.requiresKey || hasKey
          return (
            <div key={p.id} className="intel-card px-4 py-3">
              <div className="flex items-center gap-2 mb-1">
                <div className={`status-dot ${active ? 'status-dot-active' : ''}`}
                     style={active ? {} : { background: 'var(--color-text-muted)', opacity: 0.3 }} />
                <span className="mono text-xs text-text-secondary">{p.id}</span>
              </div>
              <div className="text-[11px] text-text-muted">{p.name}</div>
              {p.requiresKey && !hasKey && (
                <div className="text-[10px] text-high mt-1 mono">needs api key</div>
              )}
            </div>
          )
        })}
      </div>

      {/* API Keys */}
      <div className="section-label mb-3">api keys</div>

      {keys.length > 0 && (
        <div className="space-y-1.5 mb-5">
          {keys.map(k => (
            <div key={k.id} className="intel-card flex items-center gap-3 px-4 py-2.5">
              <div className="status-dot status-dot-active" />
              <span className="mono text-xs text-mono">{k.plugin_id}</span>
              <span className="text-xs text-text-muted flex-1">{k.label || ''}</span>
              <button onClick={() => removeKey(k.id)} className="btn text-[10px] py-0.5 px-2 !text-critical !border-critical/20 hover:!bg-critical/10">
                revoke
              </button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={addKey} className="intel-card p-4">
        <div className="section-label mb-3">add key</div>
        <div className="flex gap-2 items-end flex-wrap">
          <div className="flex-shrink-0">
            <select
              value={pluginId}
              onChange={e => setPluginId(e.target.value)}
              className="input !w-auto"
            >
              <option value="">plugin...</option>
              {keyed.map(p => <option key={p.id} value={p.id}>{p.id}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <input
              type="password"
              value={keyVal}
              onChange={e => setKeyVal(e.target.value)}
              placeholder="api key"
              className="input"
            />
          </div>
          <div className="w-36">
            <input
              type="text"
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="label"
              className="input"
            />
          </div>
          <button type="submit" className="btn btn-primary">add</button>
        </div>
      </form>
    </div>
  )
}
