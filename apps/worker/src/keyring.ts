import type { KeyRing } from '@threadr/shared'

interface KeyState {
  keys: string[]
  current: number
  burned: Set<string>
}

const state = new Map<string, KeyState>()

export function loadKeys(pluginId: string, keys: string[]) {
  state.set(pluginId, { keys, current: 0, burned: new Set() })
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
