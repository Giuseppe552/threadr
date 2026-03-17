/**
 * Cryptographic proxy routing — unpredictable but reproducible.
 *
 * The naive approach (hash plugin ID → proxy index) is deterministic
 * and readable from the source code. An adversary who reads the code
 * knows exactly which exit node handles which plugin.
 *
 * This module uses a Verifiable Random Function (VRF) seeded with a
 * per-scan cryptographic nonce. The assignment is:
 * - Unpredictable to an observer who doesn't know the nonce
 * - Deterministic for the operator (same nonce → same assignment)
 * - Uniform across proxies (no bias)
 * - Rotatable: new scan → new nonce → new assignment
 *
 * Implementation uses HMAC-SHA256 as the PRF (not a full VRF with
 * proofs, but sufficient for proxy selection where verifiability
 * isn't needed by a third party).
 */

/**
 * Generate a cryptographic nonce for a scan session.
 * 32 bytes of randomness — used to seed all routing decisions.
 */
export function generateSessionNonce(): Uint8Array {
  const nonce = new Uint8Array(32)
  crypto.getRandomValues(nonce)
  return nonce
}

/**
 * Select a proxy index for a given plugin using HMAC-SHA256.
 *
 * HMAC(nonce, pluginId) → uniform index in [0, numProxies)
 *
 * The HMAC output is 256 bits. We take the first 4 bytes as a
 * uint32 and reduce modulo numProxies. The bias from modular
 * reduction is negligible for numProxies < 2^16.
 *
 * @param nonce - Per-scan session nonce (32 bytes)
 * @param pluginId - Plugin identifier string
 * @param numProxies - Number of available proxies
 * @returns Proxy index in [0, numProxies)
 */
export async function selectProxy(
  nonce: Uint8Array,
  pluginId: string,
  numProxies: number,
): Promise<number> {
  if (numProxies <= 1) return 0

  const key = await crypto.subtle.importKey(
    'raw',
    nonce as unknown as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const data = new TextEncoder().encode(pluginId)
  const sig = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, data as unknown as BufferSource)
  )

  // First 4 bytes as uint32, big-endian
  const value = (sig[0] << 24) | (sig[1] << 16) | (sig[2] << 8) | sig[3]
  return (value >>> 0) % numProxies // >>> 0 for unsigned
}

/**
 * Generate a full proxy assignment map for all plugins in a scan.
 * Returns a Map<pluginId, proxyIndex>.
 *
 * Each scan gets a fresh nonce, so the assignment changes every time.
 * An observer who sees one scan's routing cannot predict the next.
 */
export async function generateProxyMap(
  pluginIds: string[],
  numProxies: number,
): Promise<{ nonce: Uint8Array; assignments: Map<string, number> }> {
  const nonce = generateSessionNonce()
  const assignments = new Map<string, number>()

  for (const id of pluginIds) {
    const idx = await selectProxy(nonce, id, numProxies)
    assignments.set(id, idx)
  }

  return { nonce, assignments }
}

/**
 * Verify that a proxy assignment map is uniformly distributed.
 *
 * Uses a chi-squared goodness-of-fit test against the uniform
 * distribution. Returns the p-value: if p < 0.05, the assignment
 * is suspiciously non-uniform (possible bias in the HMAC output
 * or too few plugins for the test to be meaningful).
 *
 * @param assignments - Map of pluginId → proxy index
 * @param numProxies - Total number of proxies
 * @returns Chi-squared p-value (higher = more uniform)
 */
export function uniformityTest(assignments: Map<string, number>, numProxies: number): number {
  const observed = new Array(numProxies).fill(0)
  for (const idx of assignments.values()) {
    observed[idx]++
  }

  const expected = assignments.size / numProxies
  let chiSquared = 0
  for (const o of observed) {
    chiSquared += (o - expected) ** 2 / expected
  }

  // Approximate p-value using chi-squared CDF with (numProxies - 1) df
  // For small df, use the regularized incomplete gamma function approximation
  const df = numProxies - 1
  return 1 - chiSquaredCdf(chiSquared, df)
}

/**
 * Chi-squared CDF approximation via the regularized incomplete
 * gamma function. Uses the series expansion for small values
 * and Wilson-Hilferty approximation for large values.
 */
function chiSquaredCdf(x: number, k: number): number {
  if (x <= 0) return 0
  if (k <= 0) return 1

  // Wilson-Hilferty normal approximation for k > 20
  if (k > 20) {
    const z = Math.pow(x / k, 1 / 3) - (1 - 2 / (9 * k))
    const s = Math.sqrt(2 / (9 * k))
    return normalCdf(z / s)
  }

  // Series expansion of regularized lower incomplete gamma
  const halfK = k / 2
  const halfX = x / 2
  let sum = 0
  let term = Math.exp(-halfX) * Math.pow(halfX, halfK) / gamma(halfK + 1)
  for (let n = 0; n < 200; n++) {
    sum += term
    term *= halfX / (halfK + n + 1)
    if (Math.abs(term) < 1e-15) break
  }

  return Math.min(sum, 1)
}

function normalCdf(x: number): number {
  // Abramowitz and Stegun approximation 26.2.17
  const a1 = 0.254829592
  const a2 = -0.284496736
  const a3 = 1.421413741
  const a4 = -1.453152027
  const a5 = 1.061405429
  const p = 0.3275911
  const sign = x < 0 ? -1 : 1
  const t = 1 / (1 + p * Math.abs(x))
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x / 2)
  return 0.5 * (1 + sign * y)
}

function gamma(n: number): number {
  // Stirling's approximation for the gamma function
  if (n <= 0) return Infinity
  if (n === 1) return 1
  if (n === 0.5) return Math.sqrt(Math.PI)
  if (Number.isInteger(n) && n <= 20) {
    let result = 1
    for (let i = 2; i < n; i++) result *= i
    return result
  }
  // Stirling: Γ(n) ≈ √(2π/n) · (n/e)^n
  return Math.sqrt(2 * Math.PI / n) * Math.pow(n / Math.E, n)
}
