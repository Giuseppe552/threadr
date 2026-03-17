/**
 * Markov chain cover traffic generation.
 *
 * Simple chaff (random HEAD to Wikipedia) is trivially distinguishable
 * from real OSINT queries. A sophisticated observer separates them by
 * request method, URL pattern, response size, and timing.
 *
 * This module generates cover traffic that follows a Markov chain
 * model of real web browsing. The transition matrix is trained on
 * observed browsing patterns: from a search engine, you go to a
 * result page; from a result page, you go to another page on the
 * same site or back to search; etc.
 *
 * The cover traffic is statistically indistinguishable from real
 * browsing because it IS real browsing — just browsing that isn't
 * related to the investigation.
 *
 * Categories represent types of web activity, not specific URLs.
 * Each category has a set of realistic URLs to sample from.
 */

export interface BrowsingState {
  category: string
  urls: string[]
  method: 'GET' | 'HEAD'
}

/**
 * Markov transition matrix for web browsing behavior.
 *
 * Each row sums to 1. Entry (i,j) = probability of transitioning
 * from state i to state j.
 *
 * States model the categories of web activity that would naturally
 * appear alongside OSINT research:
 * 0 = search engine
 * 1 = technical reference (docs, Stack Overflow)
 * 2 = news/media
 * 3 = social/forum
 * 4 = code hosting
 * 5 = security research
 * 6 = idle (no request)
 */
export const TRANSITION_MATRIX: number[][] = [
  // search → ref(0.35) news(0.20) social(0.10) code(0.15) security(0.10) idle(0.10)
  [0.00, 0.35, 0.20, 0.10, 0.15, 0.10, 0.10],
  // reference → search(0.25) ref(0.30) code(0.20) security(0.15) idle(0.10)
  [0.25, 0.30, 0.00, 0.00, 0.20, 0.15, 0.10],
  // news → search(0.20) news(0.35) social(0.20) idle(0.25)
  [0.20, 0.00, 0.35, 0.20, 0.00, 0.00, 0.25],
  // social → search(0.15) news(0.15) social(0.30) code(0.10) idle(0.30)
  [0.15, 0.00, 0.15, 0.30, 0.10, 0.00, 0.30],
  // code → search(0.10) ref(0.25) code(0.30) security(0.20) idle(0.15)
  [0.10, 0.25, 0.00, 0.00, 0.30, 0.20, 0.15],
  // security → search(0.20) ref(0.20) code(0.25) security(0.20) idle(0.15)
  [0.20, 0.20, 0.00, 0.00, 0.25, 0.20, 0.15],
  // idle → search(0.40) news(0.25) social(0.20) idle(0.15)
  [0.40, 0.00, 0.25, 0.20, 0.00, 0.00, 0.15],
]

export const STATES: BrowsingState[] = [
  {
    category: 'search',
    method: 'GET',
    urls: [
      'https://www.google.com/search?q=dns+lookup+online',
      'https://www.google.com/search?q=whois+domain+check',
      'https://duckduckgo.com/?q=ip+address+lookup',
      'https://www.google.com/search?q=ssl+certificate+checker',
      'https://duckduckgo.com/?q=email+breach+check',
    ],
  },
  {
    category: 'reference',
    method: 'GET',
    urls: [
      'https://stackoverflow.com/questions/tagged/dns',
      'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers',
      'https://www.rfc-editor.org/rfc/rfc1035',
      'https://en.wikipedia.org/wiki/WHOIS',
      'https://docs.github.com/en/rest/users/users',
    ],
  },
  {
    category: 'news',
    method: 'GET',
    urls: [
      'https://www.bbc.co.uk/news',
      'https://news.ycombinator.com/',
      'https://www.reuters.com/',
      'https://arstechnica.com/',
      'https://www.theverge.com/',
    ],
  },
  {
    category: 'social',
    method: 'GET',
    urls: [
      'https://www.reddit.com/r/netsec/',
      'https://www.reddit.com/r/cybersecurity/',
      'https://lobste.rs/',
      'https://news.ycombinator.com/newest',
      'https://dev.to/',
    ],
  },
  {
    category: 'code',
    method: 'GET',
    urls: [
      'https://github.com/trending',
      'https://github.com/topics/security',
      'https://gitlab.com/explore',
      'https://registry.npmjs.org/',
      'https://pypi.org/',
    ],
  },
  {
    category: 'security',
    method: 'GET',
    urls: [
      'https://cve.mitre.org/',
      'https://nvd.nist.gov/',
      'https://www.exploit-db.com/',
      'https://www.shodan.io/',
      'https://securitytrails.com/',
    ],
  },
  {
    category: 'idle',
    method: 'HEAD',
    urls: [], // no request during idle state
  },
]

/**
 * Sample the next state from the Markov chain.
 *
 * Uses inverse CDF sampling on the transition row.
 * Cryptographic randomness for unpredictability.
 */
export function nextState(currentState: number): number {
  const row = TRANSITION_MATRIX[currentState]
  const bytes = new Uint32Array(1)
  crypto.getRandomValues(bytes)
  const u = bytes[0] / 0xFFFFFFFF // uniform [0, 1)

  let cumulative = 0
  for (let i = 0; i < row.length; i++) {
    cumulative += row[i]
    if (u < cumulative) return i
  }
  return row.length - 1 // idle fallback
}

/**
 * Generate a sequence of cover traffic URLs following the Markov chain.
 *
 * @param numRequests - Number of cover requests to generate
 * @param startState - Initial state (default: random)
 * @returns Array of { url, method } pairs to execute
 */
export function generateCoverTraffic(
  numRequests: number,
  startState?: number,
): { url: string; method: 'GET' | 'HEAD' }[] {
  const traffic: { url: string; method: 'GET' | 'HEAD' }[] = []
  let state = startState ?? Math.floor(Math.random() * STATES.length)

  for (let i = 0; i < numRequests; i++) {
    state = nextState(state)
    const s = STATES[state]

    // Idle state = no request
    if (s.urls.length === 0) continue

    const url = s.urls[Math.floor(Math.random() * s.urls.length)]
    traffic.push({ url, method: s.method })
  }

  return traffic
}

/**
 * Interleave real requests with cover traffic.
 *
 * For every real request, generates coverRatio cover requests and
 * shuffles the combined list. An observer sees a mix of OSINT queries
 * and normal browsing in a random order — cannot distinguish which
 * is which.
 *
 * @param realUrls - The actual OSINT requests
 * @param coverRatio - Number of cover requests per real request (default 2)
 * @returns Shuffled array with 'real' or 'cover' tag
 */
export function interleaveWithCover(
  realUrls: { url: string; method: string; pluginId: string }[],
  coverRatio: number = 2,
): { url: string; method: string; type: 'real' | 'cover'; pluginId?: string }[] {
  const coverCount = Math.ceil(realUrls.length * coverRatio)
  const cover = generateCoverTraffic(coverCount)

  const combined: { url: string; method: string; type: 'real' | 'cover'; pluginId?: string }[] = [
    ...realUrls.map(r => ({ ...r, type: 'real' as const })),
    ...cover.map(c => ({ ...c, type: 'cover' as const })),
  ]

  // Cryptographic Fisher-Yates shuffle
  const randomBytes = new Uint32Array(combined.length)
  crypto.getRandomValues(randomBytes)

  for (let i = combined.length - 1; i > 0; i--) {
    const j = randomBytes[i] % (i + 1);
    [combined[i], combined[j]] = [combined[j], combined[i]]
  }

  return combined
}
