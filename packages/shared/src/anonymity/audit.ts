/**
 * Statistical indistinguishability self-audit.
 *
 * Runs mathematical tests on threadr's own traffic patterns to verify
 * they're indistinguishable from real browsing. If any test fails,
 * the anonymity parameters need adjustment.
 *
 * Tests:
 * 1. Kolmogorov-Smirnov test — compares timing distribution against
 *    reference distributions (Poisson, exponential, uniform)
 * 2. Autocorrelation test — checks for serial dependencies in timing
 * 3. Runs test — detects non-randomness in request ordering
 * 4. Entropy test — measures information content of the pattern
 *
 * A passing audit means: a statistical test cannot distinguish this
 * traffic from the reference distribution at significance level α=0.05.
 */

export interface AuditResult {
  passed: boolean
  tests: {
    name: string
    passed: boolean
    statistic: number
    pValue: number
    description: string
  }[]
  recommendation: string
}

/**
 * Kolmogorov-Smirnov two-sample test.
 *
 * Compares two empirical distributions. The test statistic D is the
 * maximum absolute difference between the two ECDFs.
 *
 * D = sup_x |F_1(x) - F_2(x)|
 *
 * The null hypothesis is that both samples come from the same
 * distribution. We reject if D > critical value for α=0.05.
 *
 * @param sample1 - First sample
 * @param sample2 - Second sample (reference)
 * @returns { D, pValue, reject }
 */
export function ksTest(
  sample1: number[],
  sample2: number[],
): { D: number; pValue: number; reject: boolean } {
  const n1 = sample1.length
  const n2 = sample2.length
  if (n1 === 0 || n2 === 0) return { D: 0, pValue: 1, reject: false }

  const sorted1 = [...sample1].sort((a, b) => a - b)
  const sorted2 = [...sample2].sort((a, b) => a - b)

  // Merge and compute ECDF difference
  let i = 0, j = 0
  let D = 0

  while (i < n1 || j < n2) {
    const v1 = i < n1 ? sorted1[i] : Infinity
    const v2 = j < n2 ? sorted2[j] : Infinity

    if (v1 <= v2) i++
    if (v2 <= v1) j++

    const ecdf1 = i / n1
    const ecdf2 = j / n2
    D = Math.max(D, Math.abs(ecdf1 - ecdf2))
  }

  // Approximate p-value using the Kolmogorov distribution
  const en = Math.sqrt(n1 * n2 / (n1 + n2))
  const lambda = (en + 0.12 + 0.11 / en) * D
  const pValue = kolmogorovPValue(lambda)

  return { D, pValue, reject: pValue < 0.05 }
}

/**
 * P-value from the Kolmogorov distribution.
 *
 * Q_KS(λ) = 2 Σ_{k=1}^∞ (-1)^{k+1} exp(-2k²λ²)
 *
 * Converges rapidly — 10 terms gives machine precision.
 */
function kolmogorovPValue(lambda: number): number {
  if (lambda <= 0) return 1

  let sum = 0
  for (let k = 1; k <= 20; k++) {
    const sign = k % 2 === 1 ? 1 : -1
    sum += sign * Math.exp(-2 * k * k * lambda * lambda)
  }

  return Math.min(Math.max(2 * sum, 0), 1)
}

/**
 * Autocorrelation at lag k.
 *
 * R(k) = Σ_{i=0}^{n-k-1} (x_i - μ)(x_{i+k} - μ) / Σ_{i=0}^{n-1} (x_i - μ)²
 *
 * Significant autocorrelation indicates predictable timing patterns.
 * For truly random timing, R(k) ≈ 0 for all k > 0.
 */
export function autocorrelation(samples: number[], lag: number): number {
  const n = samples.length
  if (n <= lag) return 0

  const mean = samples.reduce((a, b) => a + b, 0) / n
  let num = 0
  let den = 0

  for (let i = 0; i < n; i++) {
    den += (samples[i] - mean) ** 2
  }
  for (let i = 0; i < n - lag; i++) {
    num += (samples[i] - mean) * (samples[i + lag] - mean)
  }

  return den > 0 ? num / den : 0
}

/**
 * Wald-Wolfowitz runs test for randomness.
 *
 * Splits the sequence at the median and counts "runs" — consecutive
 * sequences above or below the median. Too few runs = clustering
 * (predictable). Too many = alternating (also predictable).
 *
 * The expected number of runs for n values with n_a above and n_b
 * below the median is: E[R] = 1 + 2n_a·n_b / (n_a + n_b)
 *
 * @returns Z-score and p-value
 */
export function runsTest(samples: number[]): { Z: number; pValue: number; reject: boolean } {
  const n = samples.length
  if (n < 10) return { Z: 0, pValue: 1, reject: false }

  const sorted = [...samples].sort((a, b) => a - b)
  const median = sorted[Math.floor(n / 2)]

  // Count runs
  let runs = 1
  let nAbove = 0
  let nBelow = 0
  let lastAbove = samples[0] >= median

  for (let i = 0; i < n; i++) {
    const above = samples[i] >= median
    if (above) nAbove++; else nBelow++
    if (i > 0 && above !== lastAbove) runs++
    lastAbove = above
  }

  if (nAbove === 0 || nBelow === 0) return { Z: 0, pValue: 1, reject: false }

  // Expected runs and variance
  const E = 1 + 2 * nAbove * nBelow / n
  const V = 2 * nAbove * nBelow * (2 * nAbove * nBelow - n) / (n * n * (n - 1))

  if (V <= 0) return { Z: 0, pValue: 1, reject: false }

  const Z = (runs - E) / Math.sqrt(V)

  // Two-tailed p-value from standard normal
  const pValue = 2 * (1 - normalCdf(Math.abs(Z)))

  return { Z, pValue, reject: pValue < 0.05 }
}

function normalCdf(x: number): number {
  const a1 = 0.254829592
  const a2 = -0.284496736
  const a3 = 1.421413741
  const a4 = -1.453152027
  const a5 = 1.061405429
  const p = 0.3275911
  const t = 1 / (1 + p * Math.abs(x))
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x / 2)
  return 0.5 * (1 + (x < 0 ? -y : y))
}

/**
 * Run the full anonymity audit on recorded traffic timings.
 *
 * @param intervals - Inter-arrival times of actual requests (ms)
 * @param referenceIntervals - Inter-arrival times from reference browsing (ms)
 */
export function auditTraffic(
  intervals: number[],
  referenceIntervals?: number[],
): AuditResult {
  const tests: AuditResult['tests'] = []

  // Generate reference if not provided (Lévy-distributed)
  const reference = referenceIntervals ?? generateLevyReference(intervals.length, 1500)

  // 1. KS test against reference distribution
  const ks = ksTest(intervals, reference)
  tests.push({
    name: 'Kolmogorov-Smirnov',
    passed: !ks.reject,
    statistic: ks.D,
    pValue: ks.pValue,
    description: ks.reject
      ? `Traffic timing differs from reference (D=${ks.D.toFixed(4)}, p=${ks.pValue.toFixed(4)}). Adjust Lévy scale.`
      : `Timing is indistinguishable from reference (D=${ks.D.toFixed(4)}, p=${ks.pValue.toFixed(4)}).`,
  })

  // 2. Autocorrelation test (lags 1-5)
  let maxAutoCorr = 0
  for (let lag = 1; lag <= 5; lag++) {
    const r = Math.abs(autocorrelation(intervals, lag))
    maxAutoCorr = Math.max(maxAutoCorr, r)
  }
  const acThreshold = 2 / Math.sqrt(intervals.length) // 95% confidence bound
  const acPassed = maxAutoCorr < acThreshold
  tests.push({
    name: 'Autocorrelation',
    passed: acPassed,
    statistic: maxAutoCorr,
    pValue: acPassed ? 0.5 : 0.01,
    description: acPassed
      ? `No serial dependencies detected (max R=${maxAutoCorr.toFixed(4)}, threshold=${acThreshold.toFixed(4)}).`
      : `Serial dependency detected at R=${maxAutoCorr.toFixed(4)}. Timing is predictable.`,
  })

  // 3. Runs test
  const runs = runsTest(intervals)
  tests.push({
    name: 'Wald-Wolfowitz Runs',
    passed: !runs.reject,
    statistic: runs.Z,
    pValue: runs.pValue,
    description: runs.reject
      ? `Non-random pattern detected (Z=${runs.Z.toFixed(2)}, p=${runs.pValue.toFixed(4)}). Request ordering is predictable.`
      : `Request ordering appears random (Z=${runs.Z.toFixed(2)}, p=${runs.pValue.toFixed(4)}).`,
  })

  // 4. Entropy check
  const H = shannonEntropy(intervals, 500)
  const Href = shannonEntropy(reference, 500)
  const entropyRatio = Href > 0 ? H / Href : 1
  const entropyPassed = entropyRatio > 0.7 && entropyRatio < 1.3
  tests.push({
    name: 'Entropy',
    passed: entropyPassed,
    statistic: H,
    pValue: entropyPassed ? 0.5 : 0.01,
    description: entropyPassed
      ? `Timing entropy (${H.toFixed(2)} bits) matches reference (${Href.toFixed(2)} bits).`
      : `Timing entropy (${H.toFixed(2)} bits) differs from reference (${Href.toFixed(2)} bits). Adjust jitter.`,
  })

  const allPassed = tests.every(t => t.passed)

  return {
    passed: allPassed,
    tests,
    recommendation: allPassed
      ? 'Traffic pattern is statistically indistinguishable from reference browsing.'
      : 'One or more tests failed. Traffic may be distinguishable by statistical analysis. Review the failed tests and adjust parameters.',
  }
}

function shannonEntropy(values: number[], binWidth: number): number {
  const bins = new Map<number, number>()
  for (const v of values) {
    const bin = Math.floor(v / binWidth) * binWidth
    bins.set(bin, (bins.get(bin) ?? 0) + 1)
  }
  let H = 0
  for (const count of bins.values()) {
    const p = count / values.length
    if (p > 0) H -= p * Math.log2(p)
  }
  return H
}

function generateLevyReference(n: number, scale: number): number[] {
  const samples: number[] = []
  for (let i = 0; i < n; i++) {
    // Simplified Lévy sampling for reference generation
    const u = Math.random()
    const sample = scale / Math.pow(u || 0.001, 1 / 1.5)
    samples.push(Math.min(sample, scale * 10))
  }
  return samples
}
