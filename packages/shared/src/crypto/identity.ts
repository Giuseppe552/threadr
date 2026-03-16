/**
 * Cryptographic identity system — zero-knowledge accounts.
 *
 * Each user is identified by an ECDSA P-256 public key. No email,
 * no name, no KYC. The keypair is generated in the browser and
 * the private key never leaves the client.
 *
 * Authentication flow:
 * 1. Client sends public key to server
 * 2. Server returns a random challenge (32 bytes, hex)
 * 3. Client signs the challenge with private key
 * 4. Server verifies signature against stored public key
 * 5. Server issues a session token (HMAC of pubkey + timestamp)
 *
 * The public key fingerprint (SHA-256 of the raw public key, truncated
 * to 16 bytes) serves as the human-readable account ID.
 */

// TS 5.9 generic Uint8Array workaround
const buf = (u: Uint8Array): BufferSource => u as unknown as BufferSource

export async function fingerprint(publicKeyRaw: Uint8Array): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', buf(publicKeyRaw)))
  return Array.from(hash.slice(0, 16))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

export function generateChallenge(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function verifySignature(
  publicKeyRaw: Uint8Array,
  signature: Uint8Array,
  challenge: string,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      buf(publicKeyRaw),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    )

    const data = new TextEncoder().encode(challenge)

    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      buf(signature),
      buf(data),
    )
  } catch {
    return false
  }
}

export async function createSessionToken(
  secret: Uint8Array,
  pubkeyFingerprint: string,
  expiresAt: number,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    buf(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const payload = `${pubkeyFingerprint}|${expiresAt}`
  const sig = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, buf(new TextEncoder().encode(payload)))
  )

  const sigHex = Array.from(sig)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')

  return `${payload}|${sigHex}`
}

export async function verifySessionToken(
  secret: Uint8Array,
  token: string,
): Promise<string | null> {
  const parts = token.split('|')
  if (parts.length !== 3) return null

  const [fp, expiresStr, sigHex] = parts
  const expiresAt = parseInt(expiresStr, 10)

  if (isNaN(expiresAt) || Date.now() > expiresAt) return null

  const key = await crypto.subtle.importKey(
    'raw',
    buf(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  )

  const payload = `${fp}|${expiresStr}`
  const sigBytes = new Uint8Array(
    sigHex.match(/.{2}/g)!.map(h => parseInt(h, 16))
  )

  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    buf(sigBytes),
    buf(new TextEncoder().encode(payload)),
  )

  return valid ? fp : null
}

export async function deriveEncryptionKey(
  publicKeyRaw: Uint8Array,
): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey(
    'raw',
    buf(publicKeyRaw),
    'HKDF',
    false,
    ['deriveKey'],
  )

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: buf(new TextEncoder().encode('threadr-api-key-encryption-v1')),
      info: buf(new TextEncoder().encode('aes-gcm-256')),
    },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptData(
  key: CryptoKey,
  plaintext: string,
): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = new TextEncoder().encode(plaintext)
  const ciphertext = new Uint8Array(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TS 5.9 Uint8Array generic mismatch
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as any }, key, buf(data))
  )

  const result = new Uint8Array(iv.length + ciphertext.length)
  result.set(iv)
  result.set(ciphertext, iv.length)
  return result
}

export async function decryptData(
  key: CryptoKey,
  encrypted: Uint8Array,
): Promise<string> {
  const iv = encrypted.slice(0, 12)
  const ciphertext = encrypted.slice(12)
  const plaintext = await crypto.subtle.decrypt(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TS 5.9 Uint8Array generic mismatch
    { name: 'AES-GCM', iv: iv as any },
    key,
    buf(ciphertext),
  )
  return new TextDecoder().decode(plaintext)
}
