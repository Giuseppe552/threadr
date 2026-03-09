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

  return (
    <div className="p-4 max-w-3xl">
      <div className="text-xs text-text-muted uppercase tracking-wider mb-3">plugins</div>
      <table className="w-full text-sm mb-8">
        <thead>
          <tr className="text-left text-text-muted text-xs border-b border-border">
            <th className="py-1 pr-4">plugin</th>
            <th className="py-1 pr-4">requires key</th>
            <th className="py-1">status</th>
          </tr>
        </thead>
        <tbody>
          {plugins.map(p => (
            <tr key={p.id} className="border-b border-border">
              <td className="py-1.5 pr-4 mono">{p.id}</td>
              <td className="py-1.5 pr-4 text-text-muted">{p.requiresKey ? 'yes' : 'no'}</td>
              <td className="py-1.5">
                {p.requiresKey
                  ? keys.some(k => k.plugin_id === p.id) ? <span className="text-green-500">configured</span> : <span className="text-text-muted">no key</span>
                  : <span className="text-green-500">active</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="text-xs text-text-muted uppercase tracking-wider mb-3">api keys</div>

      {keys.length > 0 && (
        <div className="space-y-1 mb-4">
          {keys.map(k => (
            <div key={k.id} className="flex items-center gap-3 text-sm">
              <span className="mono text-mono">{k.plugin_id}</span>
              <span className="text-text-muted">{k.label || '(no label)'}</span>
              <button onClick={() => removeKey(k.id)} className="text-red-500 text-xs hover:underline ml-auto">remove</button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={addKey} className="flex gap-2 items-end">
        <select
          value={pluginId}
          onChange={e => setPluginId(e.target.value)}
          className="bg-surface border border-border px-2 py-1 text-sm rounded-sm"
        >
          <option value="">plugin...</option>
          {keyed.map(p => <option key={p.id} value={p.id}>{p.id}</option>)}
        </select>
        <input
          type="password"
          value={keyVal}
          onChange={e => setKeyVal(e.target.value)}
          placeholder="api key"
          className="flex-1 bg-surface border border-border px-2 py-1 text-sm mono rounded-sm"
        />
        <input
          type="text"
          value={label}
          onChange={e => setLabel(e.target.value)}
          placeholder="label (optional)"
          className="w-32 bg-surface border border-border px-2 py-1 text-sm rounded-sm"
        />
        <button type="submit" className="px-3 py-1 text-sm bg-surface border border-border hover:border-text-muted rounded-sm">add</button>
      </form>
    </div>
  )
}
