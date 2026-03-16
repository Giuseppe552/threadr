import { describe, it, expect } from 'vitest'
import {
  fingerprint,
  generateChallenge,
  verifySignature,
  createSessionToken,
  verifySessionToken,
  deriveEncryptionKey,
  encryptData,
  decryptData,
} from './identity.js'

// Generate a real ECDSA P-256 keypair for testing
async function generateTestKeypair() {
  const keypair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )
  const publicKeyRaw = new Uint8Array(
    await crypto.subtle.exportKey('raw', keypair.publicKey)
  )
  return { keypair, publicKeyRaw }
}

async function signChallenge(privateKey: CryptoKey, challenge: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(challenge)
  return new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, data)
  )
}

describe('fingerprint', () => {
  it('produces 32-char hex string', async () => {
    const { publicKeyRaw } = await generateTestKeypair()
    const fp = await fingerprint(publicKeyRaw)
    expect(fp).toHaveLength(32)
    expect(fp).toMatch(/^[0-9a-f]{32}$/)
  })

  it('same key produces same fingerprint', async () => {
    const { publicKeyRaw } = await generateTestKeypair()
    const fp1 = await fingerprint(publicKeyRaw)
    const fp2 = await fingerprint(publicKeyRaw)
    expect(fp1).toBe(fp2)
  })

  it('different keys produce different fingerprints', async () => {
    const { publicKeyRaw: key1 } = await generateTestKeypair()
    const { publicKeyRaw: key2 } = await generateTestKeypair()
    const fp1 = await fingerprint(key1)
    const fp2 = await fingerprint(key2)
    expect(fp1).not.toBe(fp2)
  })
})

describe('generateChallenge', () => {
  it('produces 64-char hex string (32 bytes)', () => {
    const c = generateChallenge()
    expect(c).toHaveLength(64)
    expect(c).toMatch(/^[0-9a-f]{64}$/)
  })

  it('generates unique challenges', () => {
    const c1 = generateChallenge()
    const c2 = generateChallenge()
    expect(c1).not.toBe(c2)
  })
})

describe('verifySignature', () => {
  it('valid signature verifies', async () => {
    const { keypair, publicKeyRaw } = await generateTestKeypair()
    const challenge = generateChallenge()
    const sig = await signChallenge(keypair.privateKey, challenge)
    const valid = await verifySignature(publicKeyRaw, sig, challenge)
    expect(valid).toBe(true)
  })

  it('wrong challenge fails', async () => {
    const { keypair, publicKeyRaw } = await generateTestKeypair()
    const sig = await signChallenge(keypair.privateKey, 'real-challenge')
    const valid = await verifySignature(publicKeyRaw, sig, 'wrong-challenge')
    expect(valid).toBe(false)
  })

  it('wrong key fails', async () => {
    const { keypair } = await generateTestKeypair()
    const { publicKeyRaw: wrongKey } = await generateTestKeypair()
    const challenge = generateChallenge()
    const sig = await signChallenge(keypair.privateKey, challenge)
    const valid = await verifySignature(wrongKey, sig, challenge)
    expect(valid).toBe(false)
  })

  it('corrupted signature fails', async () => {
    const { keypair, publicKeyRaw } = await generateTestKeypair()
    const challenge = generateChallenge()
    const sig = await signChallenge(keypair.privateKey, challenge)
    sig[0] ^= 0xff // corrupt first byte
    const valid = await verifySignature(publicKeyRaw, sig, challenge)
    expect(valid).toBe(false)
  })
})

describe('session tokens', () => {
  const secret = crypto.getRandomValues(new Uint8Array(32))

  it('valid token verifies and returns fingerprint', async () => {
    const { publicKeyRaw } = await generateTestKeypair()
    const fp = await fingerprint(publicKeyRaw)
    const expiresAt = Date.now() + 3600_000 // 1 hour
    const token = await createSessionToken(secret, fp, expiresAt)
    const result = await verifySessionToken(secret, token)
    expect(result).toBe(fp)
  })

  it('expired token returns null', async () => {
    const fp = 'a'.repeat(32)
    const expiresAt = Date.now() - 1000 // expired
    const token = await createSessionToken(secret, fp, expiresAt)
    const result = await verifySessionToken(secret, token)
    expect(result).toBeNull()
  })

  it('tampered token returns null', async () => {
    const fp = 'a'.repeat(32)
    const expiresAt = Date.now() + 3600_000
    const token = await createSessionToken(secret, fp, expiresAt)
    // Tamper with the fingerprint
    const tampered = 'b'.repeat(32) + token.slice(32)
    const result = await verifySessionToken(secret, tampered)
    expect(result).toBeNull()
  })

  it('wrong secret fails', async () => {
    const fp = 'a'.repeat(32)
    const expiresAt = Date.now() + 3600_000
    const token = await createSessionToken(secret, fp, expiresAt)
    const wrongSecret = crypto.getRandomValues(new Uint8Array(32))
    const result = await verifySessionToken(wrongSecret, token)
    expect(result).toBeNull()
  })
})

describe('encryption', () => {
  it('round-trips plaintext', async () => {
    const { publicKeyRaw } = await generateTestKeypair()
    const key = await deriveEncryptionKey(publicKeyRaw)
    const plaintext = 'my-secret-api-key-abc123'
    const encrypted = await encryptData(key, plaintext)
    const decrypted = await decryptData(key, encrypted)
    expect(decrypted).toBe(plaintext)
  })

  it('different keys produce different ciphertext', async () => {
    const { publicKeyRaw: key1 } = await generateTestKeypair()
    const { publicKeyRaw: key2 } = await generateTestKeypair()
    const ek1 = await deriveEncryptionKey(key1)
    const ek2 = await deriveEncryptionKey(key2)
    const plaintext = 'test-data'
    const enc1 = await encryptData(ek1, plaintext)
    const enc2 = await encryptData(ek2, plaintext)
    // Ciphertext should differ (different keys + different IVs)
    expect(Buffer.from(enc1).toString('hex')).not.toBe(Buffer.from(enc2).toString('hex'))
  })

  it('wrong key cannot decrypt', async () => {
    const { publicKeyRaw: key1 } = await generateTestKeypair()
    const { publicKeyRaw: key2 } = await generateTestKeypair()
    const ek1 = await deriveEncryptionKey(key1)
    const ek2 = await deriveEncryptionKey(key2)
    const encrypted = await encryptData(ek1, 'secret')
    await expect(decryptData(ek2, encrypted)).rejects.toThrow()
  })

  it('encrypted data is longer than plaintext (IV + auth tag)', async () => {
    const { publicKeyRaw } = await generateTestKeypair()
    const key = await deriveEncryptionKey(publicKeyRaw)
    const plaintext = 'short'
    const encrypted = await encryptData(key, plaintext)
    // 12 bytes IV + plaintext + 16 bytes auth tag
    expect(encrypted.length).toBeGreaterThanOrEqual(plaintext.length + 12 + 16)
  })
})
