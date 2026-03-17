/**
 * Target decoy system — k-anonymity for OSINT queries.
 *
 * Problem: even with per-plugin Tor circuit isolation, an observer
 * can correlate requests by TARGET. If 5 exit nodes all query data
 * related to "example.com" within 30 seconds, the target is obvious.
 *
 * Solution: for every real target, query k decoy targets of the
 * same type. The observer sees queries for k+1 targets and cannot
 * determine which is real.
 *
 * Mathematical guarantee: if k decoy targets are queried for every
 * real target, an observer's probability of identifying the real
 * target is at most 1/(k+1).
 *
 * k=2 → 33% identification probability
 * k=3 → 25%
 * k=5 → 16.7%
 *
 * Decoys are drawn from curated pools of real, resolvable, unremarkable
 * targets. Querying wikipedia.org or google.com is completely normal.
 */

/**
 * Pool of common domains that are unremarkable to query.
 * Drawn from Tranco top 1000 — these domains receive billions
 * of DNS/HTTP queries daily. One more is invisible.
 */
const DOMAIN_POOL = [
  'google.com', 'youtube.com', 'facebook.com', 'amazon.com', 'wikipedia.org',
  'twitter.com', 'instagram.com', 'linkedin.com', 'reddit.com', 'netflix.com',
  'microsoft.com', 'apple.com', 'yahoo.com', 'ebay.com', 'bing.com',
  'twitch.tv', 'whatsapp.com', 'zoom.us', 'github.com', 'stackoverflow.com',
  'bbc.co.uk', 'cnn.com', 'nytimes.com', 'reuters.com', 'theguardian.com',
  'cloudflare.com', 'mozilla.org', 'wordpress.org', 'medium.com', 'tumblr.com',
  'shopify.com', 'squarespace.com', 'wix.com', 'godaddy.com', 'namecheap.com',
  'digitalocean.com', 'heroku.com', 'vercel.com', 'netlify.com', 'aws.amazon.com',
  'stripe.com', 'paypal.com', 'dropbox.com', 'slack.com', 'discord.com',
  'spotify.com', 'soundcloud.com', 'pinterest.com', 'tiktok.com', 'snapchat.com',
]

/**
 * Pool of well-known public IPs that are unremarkable to query.
 * Mix of DNS resolvers, CDN nodes, and major infrastructure.
 */
const IP_POOL = [
  '8.8.8.8', '8.8.4.4',           // Google DNS
  '1.1.1.1', '1.0.0.1',           // Cloudflare DNS
  '208.67.222.222', '208.67.220.220', // OpenDNS
  '9.9.9.9', '149.112.112.112',   // Quad9
  '76.76.2.0', '76.76.10.0',      // Control D
  '94.140.14.14', '94.140.15.15', // AdGuard
  '185.228.168.9',                 // CleanBrowsing
  '64.6.64.6', '64.6.65.6',       // Verisign
  '104.16.0.0', '104.18.0.0',     // Cloudflare CDN ranges
  '151.101.1.140', '151.101.65.140', // Fastly CDN
  '13.107.42.14', '204.79.197.200', // Microsoft
  '142.250.80.46', '172.217.14.206', // Google
]

/**
 * Pool of common email patterns at major providers.
 * Generic enough to be unremarkable, real enough to resolve.
 */
const EMAIL_POOL = [
  'info@google.com', 'support@microsoft.com', 'help@apple.com',
  'contact@amazon.com', 'info@github.com', 'security@cloudflare.com',
  'admin@mozilla.org', 'info@wordpress.org', 'hello@stripe.com',
  'support@digitalocean.com', 'info@netlify.com', 'contact@vercel.com',
  'security@facebook.com', 'abuse@google.com', 'postmaster@yahoo.com',
  'noc@cloudflare.com', 'admin@github.com', 'info@stackoverflow.com',
  'contact@medium.com', 'support@slack.com', 'info@discord.com',
  'hello@spotify.com', 'support@dropbox.com', 'info@reddit.com',
]

/**
 * Pool of common usernames on major platforms.
 */
const USERNAME_POOL = [
  'admin', 'test', 'user', 'support', 'info', 'contact',
  'developer', 'dev', 'api', 'bot', 'system', 'root',
  'webmaster', 'security', 'noc', 'abuse', 'postmaster',
  'marketing', 'sales', 'hr', 'ceo', 'cto', 'ops',
]

type SeedType = 'Email' | 'Domain' | 'IP' | 'Username'

const POOLS: Record<SeedType, string[]> = {
  Domain: DOMAIN_POOL,
  IP: IP_POOL,
  Email: EMAIL_POOL,
  Username: USERNAME_POOL,
}

/**
 * Generate k decoy targets of the same type as the real target.
 *
 * Decoys are selected WITHOUT replacement from the pool, and
 * the real target is excluded. Uses cryptographic randomness.
 *
 * @param realTarget - The actual scan target
 * @param seedType - Type of the target (Email, Domain, IP, Username)
 * @param k - Number of decoys to generate
 * @returns Array of decoy target strings
 */
export function generateDecoys(realTarget: string, seedType: SeedType, k: number): string[] {
  const pool = POOLS[seedType]
  if (!pool || pool.length === 0) return []

  // Filter out the real target from the pool
  const available = pool.filter(t => t.toLowerCase() !== realTarget.toLowerCase())
  if (available.length === 0) return []

  const count = Math.min(k, available.length)
  const decoys: string[] = []
  const used = new Set<number>()

  // Cryptographic random selection
  const randomBytes = new Uint32Array(count)
  crypto.getRandomValues(randomBytes)

  for (let i = 0; i < count; i++) {
    let idx = randomBytes[i] % available.length
    let attempts = 0
    while (used.has(idx) && attempts < available.length) {
      idx = (idx + 1) % available.length
      attempts++
    }
    if (!used.has(idx)) {
      used.add(idx)
      decoys.push(available[idx])
    }
  }

  return decoys
}

/**
 * Interleave real targets with decoys, then shuffle.
 *
 * Returns an array of { target, type, isReal } objects in random order.
 * The executor runs all of them — real and decoy — through the same
 * plugin pipeline. Decoy results are discarded.
 *
 * @param realTargets - Array of real scan targets
 * @param seedType - Type of all targets
 * @param k - Decoy ratio (decoys per real target)
 */
export function interleaveTargets(
  realTargets: { value: string; key: string }[],
  seedType: SeedType,
  k: number,
): { value: string; key: string; isReal: boolean }[] {
  const items: { value: string; key: string; isReal: boolean }[] = []

  for (const target of realTargets) {
    items.push({ ...target, isReal: true })

    const decoys = generateDecoys(target.value, seedType, k)
    for (const d of decoys) {
      items.push({ value: d, key: target.key, isReal: false })
    }
  }

  // Cryptographic Fisher-Yates shuffle
  const randomBytes = new Uint32Array(items.length)
  crypto.getRandomValues(randomBytes)

  for (let i = items.length - 1; i > 0; i--) {
    const j = randomBytes[i] % (i + 1);
    [items[i], items[j]] = [items[j], items[i]]
  }

  return items
}

/**
 * Calculate the k-anonymity probability for a given decoy ratio.
 *
 * @param k - Number of decoys per real target
 * @returns Probability that an observer correctly identifies the real target
 */
export function identificationProbability(k: number): number {
  return 1 / (k + 1)
}
