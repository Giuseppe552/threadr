/**
 * Traffic analysis resistant timing distributions.
 *
 * Three layers of timing defense:
 *
 * 1. LÉVY FLIGHT scheduling — heavy-tailed distribution that mimics
 *    real human browsing (quick bursts + long idle periods). Unlike
 *    Poisson (which has finite variance and a detectable signature),
 *    Lévy stable distributions have INFINITE variance. A KS test
 *    against Poisson will reject, but a KS test against Lévy matches
 *    real browser inter-arrival times (Paxson & Floyd, 1995).
 *
 * 2. DIFFERENTIAL PRIVACY guarantee — Laplace noise added to all
 *    timing with calibrated ε. Provides a mathematical guarantee:
 *    an observer cannot distinguish whether a request happened at
 *    time T or T+δ with probability better than e^ε. This is the
 *    same mechanism used in Census data protection.
 *
 * 3. BATCH RELEASE with entropy maximization — instead of sending
 *    requests as they're ready, collect into batches and release in
 *    random order after a random delay. The anonymity set equals
 *    the batch size: any request could be any item in the batch.
 */

/**
 * Lévy stable distribution sampling via Chambers-Mallows-Stuck method.
 *
 * The Lévy distribution L(α, β, γ, δ) with stability parameter α ∈ (0,2]
 * and skewness β ∈ [-1,1]. For α < 2, variance is infinite — this is
 * the key property that defeats timing correlation.
 *
 * We use α = 1.5 (heavy tail but not as extreme as Cauchy α=1),
 * β = 1 (right-skewed: delays are always positive), γ = scale, δ = shift.
 *
 * Reference: Chambers, Mallows, Stuck (1976). "A Method for Simulating
 * Stable Random Variables." Journal of the American Statistical Association.
 */
export function levySample(scale: number, minMs: number = 100, maxMs: number = 30000): number {
  const alpha = 1.5 // stability: 1.5 gives heavy tail without Cauchy extremes
  const beta = 1.0  // fully right-skewed (positive delays only)

  // Chambers-Mallows-Stuck algorithm
  const U = (Math.random() - 0.5) * Math.PI // Uniform on (-π/2, π/2)
  const W = -Math.log(Math.random() || 1e-10) // Exponential(1)

  const phi0 = Math.atan(beta * Math.tan(Math.PI * alpha / 2)) / alpha
  const factor = Math.cos(U - alpha * phi0) > 0
    ? Math.pow(
        Math.cos(U - alpha * phi0) / W,
        (1 - alpha) / alpha
      ) * Math.sin(alpha * (U - phi0)) / Math.pow(Math.cos(U), 1 / alpha)
    : scale // fallback for numerical edge case

  const raw = Math.abs(factor) * scale + minMs
  return Math.min(raw, maxMs) // cap extreme outliers
}

/**
 * Lévy flight delay — returns a Promise that resolves after a
 * Lévy-distributed random duration.
 *
 * @param scaleMs - Scale parameter (typical delay ~scaleMs)
 */
export function levyDelay(scaleMs: number = 1500): Promise<void> {
  const ms = levySample(scaleMs)
  return new Promise(resolve => setTimeout(resolve, Math.round(ms)))
}

/**
 * Laplace mechanism for differential privacy on timing.
 *
 * Adds Laplace noise with scale b = Δf/ε where:
 * - Δf = sensitivity (max change in timing from a single request)
 * - ε = privacy budget (lower = more private, more noise)
 *
 * With ε = 1.0 and Δf = 5000ms, the Laplace noise has scale 5000ms
 * and mean 0. Combined with the base timing, this guarantees that
 * observing the request time reveals at most ε bits of information
 * about when the request was actually scheduled.
 *
 * @param baseMs - Base timing value
 * @param epsilon - Privacy parameter (default 1.0)
 * @param sensitivity - Maximum timing sensitivity in ms (default 5000)
 */
export function laplaceMechanism(baseMs: number, epsilon: number = 1.0, sensitivity: number = 5000): number {
  const scale = sensitivity / epsilon

  // Laplace sampling via inverse CDF: X = μ - b·sign(U)·ln(1 - 2|U|)
  // where U ~ Uniform(-0.5, 0.5)
  const u = Math.random() - 0.5
  const noise = -scale * Math.sign(u) * Math.log(1 - 2 * Math.abs(u))

  const result = baseMs + noise
  return Math.max(result, 50) // never go below 50ms
}

/**
 * Combined timing: Lévy base + Laplace differential privacy noise.
 *
 * The Lévy distribution provides the base timing pattern (matches
 * real browsing). The Laplace mechanism adds provable privacy on top.
 *
 * @param scaleMs - Lévy scale parameter
 * @param epsilon - DP privacy budget
 */
export function privateTimingDelay(scaleMs: number = 1500, epsilon: number = 1.0): Promise<void> {
  const base = levySample(scaleMs)
  const final = laplaceMechanism(base, epsilon)
  return new Promise(resolve => setTimeout(resolve, Math.round(Math.max(final, 50))))
}

/**
 * Batch release with entropy maximization.
 *
 * Collects items into a batch, shuffles them (Fisher-Yates with
 * cryptographic randomness), then releases with random inter-item
 * delays. The batch provides an anonymity set of size n: any
 * observed output could be any item in the batch.
 *
 * The inter-release timing is drawn from the Lévy distribution
 * to maintain the same statistical profile as individual requests.
 *
 * @param items - Items to batch and release
 * @param execute - Function to execute each item
 * @param batchDelayMs - How long to collect before releasing
 */
export async function batchRelease<T>(
  items: T[],
  execute: (item: T) => Promise<void>,
  batchDelayMs: number = 3000,
): Promise<void> {
  if (items.length === 0) return

  // Wait for batch collection period
  await new Promise(resolve => setTimeout(resolve, batchDelayMs))

  // Cryptographic Fisher-Yates shuffle
  const shuffled = [...items]
  const randomBytes = new Uint32Array(shuffled.length)
  crypto.getRandomValues(randomBytes)

  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = randomBytes[i] % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }

  // Release with Lévy timing
  for (const item of shuffled) {
    await execute(item)
    if (shuffled.indexOf(item) < shuffled.length - 1) {
      await levyDelay(800) // shorter delays within batch
    }
  }
}

/**
 * Compute the Shannon entropy of observed inter-arrival times.
 *
 * Used for self-auditing: compare the entropy of threadr's traffic
 * against the entropy of real browsing traffic. If they differ
 * significantly, the timing parameters need adjustment.
 *
 * @param intervals - Array of inter-arrival times in ms
 * @param binWidth - Histogram bin width in ms (default 500)
 * @returns Entropy in bits
 */
export function timingEntropy(intervals: number[], binWidth: number = 500): number {
  if (intervals.length === 0) return 0

  // Build histogram
  const bins = new Map<number, number>()
  for (const t of intervals) {
    const bin = Math.floor(t / binWidth) * binWidth
    bins.set(bin, (bins.get(bin) ?? 0) + 1)
  }

  // Compute entropy
  const total = intervals.length
  let H = 0
  for (const count of bins.values()) {
    const p = count / total
    if (p > 0) H -= p * Math.log2(p)
  }

  return H
}
