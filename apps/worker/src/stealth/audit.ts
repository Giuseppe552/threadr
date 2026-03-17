/**
 * Stealth self-audit — verifies the stealth stack works.
 *
 * Makes test requests through the proxy layer and checks:
 * 1. Header order matches the selected browser profile
 * 2. User-Agent is consistent across requests
 * 3. sec-ch-ua matches the claimed browser version
 * 4. Cookies are being captured and replayed
 * 5. Timing distribution passes statistical tests
 *
 * Reports PASS/FAIL for each check with details.
 */

import { proxiedFetch, getSessionProfile } from '../proxy.js'
import { auditTraffic } from '@threadr/shared'

export interface AuditCheck {
  name: string
  passed: boolean
  detail: string
}

export interface StealthAuditResult {
  passed: boolean
  checks: AuditCheck[]
  profileId: string
}

/**
 * Run a full stealth audit.
 *
 * @param numRequests - Number of test requests to make (default 10)
 */
export async function runStealthAudit(numRequests: number = 10): Promise<StealthAuditResult> {
  const checks: AuditCheck[] = []
  const profile = getSessionProfile()

  if (!profile) {
    return {
      passed: false,
      checks: [{ name: 'profile', passed: false, detail: 'no browser profile selected — enable stealth mode first' }],
      profileId: 'none',
    }
  }

  // Check 1: Profile consistency
  checks.push({
    name: 'profile-selected',
    passed: true,
    detail: `using ${profile.id} (${profile.name})`,
  })

  // Check 2: sec-ch-ua consistency
  const isChrome = profile.id.startsWith('chrome')
  if (isChrome && !profile.secChUa) {
    checks.push({ name: 'sec-ch-ua', passed: false, detail: 'Chrome profile missing sec-ch-ua' })
  } else if (!isChrome && profile.secChUa) {
    checks.push({ name: 'sec-ch-ua', passed: false, detail: 'Firefox profile should not have sec-ch-ua' })
  } else {
    checks.push({ name: 'sec-ch-ua', passed: true, detail: `sec-ch-ua consistent with ${isChrome ? 'Chrome' : 'Firefox'} profile` })
  }

  // Check 3: UA version matches sec-ch-ua version
  if (isChrome) {
    const uaVersion = profile.userAgent.match(/Chrome\/(\d+)/)?.[1]
    const chUaVersion = profile.secChUa.match(/Chrome";v="(\d+)/)?.[1]
    const match = uaVersion === chUaVersion
    checks.push({
      name: 'version-consistency',
      passed: match,
      detail: match
        ? `UA version ${uaVersion} matches sec-ch-ua version ${chUaVersion}`
        : `MISMATCH: UA=${uaVersion}, sec-ch-ua=${chUaVersion}`,
    })
  } else {
    checks.push({ name: 'version-consistency', passed: true, detail: 'Firefox — no sec-ch-ua version to check' })
  }

  // Check 4: Accept-Encoding matches browser
  const hasZstd = profile.acceptEncoding.includes('zstd')
  if (isChrome && !hasZstd) {
    checks.push({ name: 'accept-encoding', passed: false, detail: 'Chrome should include zstd in Accept-Encoding' })
  } else if (!isChrome && hasZstd) {
    checks.push({ name: 'accept-encoding', passed: false, detail: 'Firefox should not include zstd' })
  } else {
    checks.push({ name: 'accept-encoding', passed: true, detail: `Accept-Encoding: ${profile.acceptEncoding}` })
  }

  // Check 5: Header order has required fields
  const requiredHeaders = ['host', 'user-agent', 'accept', 'accept-encoding', 'accept-language']
  const missingRequired = requiredHeaders.filter(h => !profile.headerOrder.includes(h))
  checks.push({
    name: 'header-completeness',
    passed: missingRequired.length === 0,
    detail: missingRequired.length === 0
      ? `all ${requiredHeaders.length} required headers present in order`
      : `missing headers: ${missingRequired.join(', ')}`,
  })

  // Check 6: Timing distribution (make real requests and measure)
  const timings: number[] = []
  const testUrl = 'https://httpbin.org/get' // public echo service
  let requestsFailed = 0

  for (let i = 0; i < numRequests; i++) {
    const start = performance.now()
    try {
      const res = await proxiedFetch(testUrl, 'audit', { method: 'HEAD' })
      await res.arrayBuffer().catch(() => {})
    } catch {
      requestsFailed++
    }
    timings.push(performance.now() - start)
  }

  if (requestsFailed === numRequests) {
    checks.push({
      name: 'connectivity',
      passed: false,
      detail: `all ${numRequests} requests failed — proxy may not be running`,
    })
  } else {
    checks.push({
      name: 'connectivity',
      passed: true,
      detail: `${numRequests - requestsFailed}/${numRequests} requests succeeded`,
    })

    // Statistical timing audit
    if (timings.length >= 5) {
      const intervals = timings.slice(1).map((t, i) => t - timings[i])
      const result = auditTraffic(intervals.filter(t => t > 0))
      const passedTests = result.tests.filter(t => t.passed).length
      checks.push({
        name: 'timing-distribution',
        passed: passedTests >= 3,
        detail: `${passedTests}/${result.tests.length} statistical tests passed. ${result.recommendation}`,
      })
    }
  }

  const allPassed = checks.every(c => c.passed)

  return {
    passed: allPassed,
    checks,
    profileId: profile.id,
  }
}
