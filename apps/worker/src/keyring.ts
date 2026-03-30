import type { KeyRing } from '@threadr/shared'
import { deriveEncryptionKey, decryptData } from '@threadr/shared'
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

/**
 * Load API keys from SQLite.
 *
 * If KEY_ENCRYPTION_SECRET is set, keys are decrypted with AES-256-GCM
 * (HKDF-derived from the secret). If not set, keys are read as plaintext
 * for backwards compatibility during migration.
 */
export async function loadKeysFromDb() {
  const secret = process.env.KEY_ENCRYPTION_SECRET
  let encKey: CryptoKey | null = null
  if (secret) {
    encKey = await deriveEncryptionKey(new TextEncoder().encode(secret))
  }

  const rows = db.prepare('SELECT plugin_id, key_value FROM api_keys WHERE active = 1').all() as { plugin_id: string; key_value: string }[]
  const grouped = new Map<string, string[]>()

  for (const r of rows) {
    let plainKey: string
    if (encKey && looksEncrypted(r.key_value)) {
      const bytes = Buffer.from(r.key_value, 'base64')
      plainKey = await decryptData(encKey, new Uint8Array(bytes))
    } else {
      plainKey = r.key_value
    }
    const arr = grouped.get(r.plugin_id) || []
    arr.push(plainKey)
    grouped.set(r.plugin_id, arr)
  }

  for (const [pid, keys] of grouped) {
    loadKeys(pid, keys)
  }
  console.log(`[*] loaded keys for ${grouped.size} plugins${encKey ? ' (encrypted)' : ''}`)
}

/**
 * Encrypted values are base64-encoded and at least 28 chars
 * (12 bytes IV + 16 bytes auth tag minimum).
 * Plaintext API keys are typically alphanumeric with hyphens.
 */
function looksEncrypted(value: string): boolean {
  if (value.length < 28) return false
  try {
    const bytes = Buffer.from(value, 'base64')
    // IV (12) + at least 1 byte ciphertext + auth tag (16) = 29 minimum
    return bytes.length >= 29
  } catch {
    return false
  }
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
      console.log(`[!] key burned for ${pluginId}`)
    }
  },
}
