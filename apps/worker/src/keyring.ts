import type { KeyRing } from '@threadr/shared'
import { db } from './db.js'

interface KeyState {
  keys: string[]
  current: number
  burned: Set<string>
}

const state = new Map<string, KeyState>()

export function loadKeys(pluginId: string, keys: string[]) {
  state.set(pluginId, { keys, current: 0, burned: new Set() })
}

export function loadKeysFromDb() {
  const rows = db.prepare('SELECT plugin_id, key_value FROM api_keys WHERE active = 1').all() as { plugin_id: string; key_value: string }[]
  const grouped = new Map<string, string[]>()
  for (const r of rows) {
    const arr = grouped.get(r.plugin_id) || []
    arr.push(r.key_value)
    grouped.set(r.plugin_id, arr)
  }
  for (const [pid, keys] of grouped) {
    loadKeys(pid, keys)
  }
  console.log(`[*] loaded keys for ${grouped.size} plugins`)
}

export const keyring: KeyRing = {
  get(pluginId: string): string | null {
    const s = state.get(pluginId)
    if (!s || s.keys.length === 0) return null

    // round-robin, skip burned
    for (let i = 0; i < s.keys.length; i++) {
      const idx = (s.current + i) % s.keys.length
      const key = s.keys[idx]
      if (!s.burned.has(key)) {
        s.current = (idx + 1) % s.keys.length
        return key
      }
    }

    return null // all burned
  },

  markBurned(pluginId: string, key: string) {
    const s = state.get(pluginId)
    if (s) {
      s.burned.add(key)
      console.log(`[!] key burned for ${pluginId}: ${key.slice(0, 8)}...`)
    }
  },
}
