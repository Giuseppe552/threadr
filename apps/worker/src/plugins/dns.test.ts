import { describe, it, expect, vi, beforeEach } from 'vitest'
import dns from 'node:dns/promises'
import { dnsPlugin } from './dns'

vi.mock('node:dns/promises')

const seed = (domain: string) => ({ type: 'Domain' as const, key: 'name', value: domain })
const noKeys = { get: () => null, markBurned: () => {} }

beforeEach(() => { vi.resetAllMocks() })

describe('dns plugin', () => {
  it('has correct metadata', () => {
    expect(dnsPlugin.id).toBe('dns')
    expect(dnsPlugin.accepts).toContain('Domain')
    expect(dnsPlugin.requiresKey).toBe(false)
  })

  it('extracts MX records as Domain nodes with HAS_MX edges', async () => {
    vi.mocked(dns.resolveMx).mockResolvedValue([
      { exchange: 'mx1.google.com', priority: 10 },
      { exchange: 'mx2.google.com', priority: 20 },
    ])
    vi.mocked(dns.resolve4).mockRejectedValue(new Error('no A'))
    vi.mocked(dns.resolve6).mockRejectedValue(new Error('no AAAA'))
    vi.mocked(dns.resolveNs).mockRejectedValue(new Error('no NS'))
    vi.mocked(dns.resolveTxt).mockRejectedValue(new Error('no TXT'))
    vi.mocked(dns.resolveSoa).mockRejectedValue(new Error('no SOA'))
    vi.mocked(dns.resolveCname).mockRejectedValue(new Error('no CNAME'))

    const { nodes, edges } = await dnsPlugin.run(seed('example.com'), noKeys)

    expect(nodes).toHaveLength(2)
    expect(nodes[0].props.name).toBe('mx1.google.com')
    expect(nodes[0].props.mx_priority).toBe('10')
    expect(edges).toHaveLength(2)
    expect(edges[0].rel).toBe('HAS_MX')
    expect(edges[0].fromVal).toBe('example.com')
  })

  it('extracts A records as IP nodes with RESOLVES_TO edges', async () => {
    vi.mocked(dns.resolveMx).mockRejectedValue(new Error(''))
    vi.mocked(dns.resolve4).mockResolvedValue(['93.184.216.34', '93.184.216.35'])
    vi.mocked(dns.resolve6).mockRejectedValue(new Error(''))
    vi.mocked(dns.resolveNs).mockRejectedValue(new Error(''))
    vi.mocked(dns.resolveTxt).mockRejectedValue(new Error(''))
    vi.mocked(dns.resolveSoa).mockRejectedValue(new Error(''))
    vi.mocked(dns.resolveCname).mockRejectedValue(new Error(''))

    const { nodes, edges } = await dnsPlugin.run(seed('example.com'), noKeys)

    expect(nodes).toHaveLength(2)
    expect(nodes[0].label).toBe('IP')
    expect(nodes[0].props.address).toBe('93.184.216.34')
    expect(edges[0].rel).toBe('RESOLVES_TO')
  })

  it('parses SPF includes into Domain nodes', async () => {
    vi.mocked(dns.resolveMx).mockRejectedValue(new Error(''))
    vi.mocked(dns.resolve4).mockRejectedValue(new Error(''))
    vi.mocked(dns.resolve6).mockRejectedValue(new Error(''))
    vi.mocked(dns.resolveNs).mockRejectedValue(new Error(''))
    vi.mocked(dns.resolveTxt).mockResolvedValue([
      ['v=spf1 include:_spf.google.com include:spf.protection.outlook.com ~all'],
    ])
    vi.mocked(dns.resolveSoa).mockRejectedValue(new Error(''))
    vi.mocked(dns.resolveCname).mockRejectedValue(new Error(''))

    const { nodes } = await dnsPlugin.run(seed('example.com'), noKeys)

    const spfIncludes = nodes.filter(n => n.props.role === 'spf-include')
    expect(spfIncludes).toHaveLength(2)
    expect(spfIncludes[0].props.name).toBe('_spf.google.com')
    expect(spfIncludes[1].props.name).toBe('spf.protection.outlook.com')
  })

  it('detects DMARC and DKIM in TXT records', async () => {
    vi.mocked(dns.resolveMx).mockRejectedValue(new Error(''))
    vi.mocked(dns.resolve4).mockRejectedValue(new Error(''))
    vi.mocked(dns.resolve6).mockRejectedValue(new Error(''))
    vi.mocked(dns.resolveNs).mockRejectedValue(new Error(''))
    vi.mocked(dns.resolveTxt).mockResolvedValue([
      ['v=DMARC1; p=reject; rua=mailto:dmarc@example.com'],
      ['v=DKIM1; k=rsa; p=MIGfMA0GCS...'],
    ])
    vi.mocked(dns.resolveSoa).mockRejectedValue(new Error(''))
    vi.mocked(dns.resolveCname).mockRejectedValue(new Error(''))

    const { nodes } = await dnsPlugin.run(seed('example.com'), noKeys)

    const domainNode = nodes.find(n => n.props.dmarc)
    expect(domainNode).toBeDefined()
    expect(domainNode!.props.dmarc).toContain('p=reject')
    expect(domainNode!.props.dkim).toBe('present')
  })

  it('converts SOA hostmaster to email', async () => {
    vi.mocked(dns.resolveMx).mockRejectedValue(new Error(''))
    vi.mocked(dns.resolve4).mockRejectedValue(new Error(''))
    vi.mocked(dns.resolve6).mockRejectedValue(new Error(''))
    vi.mocked(dns.resolveNs).mockRejectedValue(new Error(''))
    vi.mocked(dns.resolveTxt).mockRejectedValue(new Error(''))
    vi.mocked(dns.resolveSoa).mockResolvedValue({
      nsname: 'ns1.example.com', hostmaster: 'admin.example.com',
      serial: 2024010101, refresh: 7200, retry: 3600, expire: 1209600, minttl: 300,
    })
    vi.mocked(dns.resolveCname).mockRejectedValue(new Error(''))

    const { nodes, edges } = await dnsPlugin.run(seed('example.com'), noKeys)

    const emailNode = nodes.find(n => n.label === 'Email')
    expect(emailNode).toBeDefined()
    expect(emailNode!.props.address).toBe('admin@example.com')
    expect(emailNode!.props.source).toBe('soa')
    expect(edges.some(e => e.rel === 'LINKED_TO')).toBe(true)
  })

  it('returns empty when all DNS queries fail', async () => {
    vi.mocked(dns.resolveMx).mockRejectedValue(new Error(''))
    vi.mocked(dns.resolve4).mockRejectedValue(new Error(''))
    vi.mocked(dns.resolve6).mockRejectedValue(new Error(''))
    vi.mocked(dns.resolveNs).mockRejectedValue(new Error(''))
    vi.mocked(dns.resolveTxt).mockRejectedValue(new Error(''))
    vi.mocked(dns.resolveSoa).mockRejectedValue(new Error(''))
    vi.mocked(dns.resolveCname).mockRejectedValue(new Error(''))

    const { nodes, edges } = await dnsPlugin.run(seed('nonexistent.invalid'), noKeys)
    expect(nodes).toHaveLength(0)
    expect(edges).toHaveLength(0)
  })
})
