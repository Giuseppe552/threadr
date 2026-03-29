import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shodan } from './shodan'

const ipSeed = (ip: string) => ({ type: 'IP' as const, key: 'address', value: ip })
const domainSeed = (d: string) => ({ type: 'Domain' as const, key: 'name', value: d })

function mockKeys(key: string | null) {
  const burned: string[] = []
  return {
    get: (id: string) => id === 'shodan' ? key : null,
    markBurned: (_id: string, k: string) => { burned.push(k) },
    burned,
  }
}

beforeEach(() => { vi.restoreAllMocks() })

describe('shodan plugin', () => {
  it('has correct metadata', () => {
    expect(shodan.id).toBe('shodan')
    expect(shodan.accepts).toEqual(expect.arrayContaining(['IP', 'Domain']))
    expect(shodan.requiresKey).toBe(true)
  })

  it('returns empty when no API key', async () => {
    const { nodes } = await shodan.run(ipSeed('1.1.1.1'), mockKeys(null))
    expect(nodes).toHaveLength(0)
  })

  it('creates Org and Port nodes from IP scan', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({
        org: 'Cloudflare, Inc.',
        data: [
          { port: 443, transport: 'tcp', product: 'cloudflare', data: 'HTTP/1.1 200 OK\r\n', _shodan: { module: 'https' } },
          { port: 80, transport: 'tcp', product: null, data: '', _shodan: { module: 'http' } },
        ],
      }),
    }))

    const { nodes, edges } = await shodan.run(ipSeed('1.1.1.1'), mockKeys('key'))

    const org = nodes.find(n => n.label === 'Organization')
    expect(org).toBeDefined()
    expect(org!.props.name).toBe('Cloudflare, Inc.')

    const ports = nodes.filter(n => n.label === 'Port')
    expect(ports).toHaveLength(2)
    expect(ports[0].props.number).toBe('443')
    expect(ports[0].props.service).toBe('cloudflare')
    expect(ports[1].props.service).toBe('http') // fallback to _shodan.module

    expect(edges.filter(e => e.rel === 'OWNS')).toHaveLength(1)
    expect(edges.filter(e => e.rel === 'OPEN_PORT')).toHaveLength(2)
  })

  it('resolves domain to IP before scanning', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ 'example.com': '93.184.216.34' }),
      })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ org: null, data: [] }),
      })

    vi.stubGlobal('fetch', mockFetch)

    const { nodes, edges } = await shodan.run(domainSeed('example.com'), mockKeys('key'))

    // Should create IP node + RESOLVES_TO edge for domain input
    const ipNode = nodes.find(n => n.label === 'IP')
    expect(ipNode).toBeDefined()
    expect(ipNode!.props.address).toBe('93.184.216.34')
    expect(edges.some(e => e.rel === 'RESOLVES_TO')).toBe(true)
  })

  it('caps services at 15', async () => {
    const manySvcs = Array.from({ length: 25 }, (_, i) => ({
      port: 1000 + i, transport: 'tcp', product: `svc-${i}`, data: '', _shodan: {},
    }))

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ org: null, data: manySvcs }),
    }))

    const { nodes } = await shodan.run(ipSeed('10.0.0.1'), mockKeys('key'))
    expect(nodes.filter(n => n.label === 'Port')).toHaveLength(15)
  })

  it('truncates banners to 200 chars', async () => {
    const longBanner = 'A'.repeat(500)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({
        org: null,
        data: [{ port: 22, transport: 'tcp', product: 'ssh', data: longBanner, _shodan: {} }],
      }),
    }))

    const { nodes } = await shodan.run(ipSeed('10.0.0.1'), mockKeys('key'))
    const port = nodes.find(n => n.label === 'Port')
    expect(port!.props.banner).toHaveLength(200)
  })

  it('marks key as burned on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }))
    const keys = mockKeys('bad')
    await shodan.run(ipSeed('1.1.1.1'), keys)
    expect(keys.burned).toContain('bad')
  })

  it('throws on 429 rate limit', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }))
    await expect(shodan.run(ipSeed('1.1.1.1'), mockKeys('key'))).rejects.toThrow('rate limited')
  })

  it('returns empty when domain DNS resolution fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ 'example.com': null }),
    }))

    const { nodes } = await shodan.run(domainSeed('example.com'), mockKeys('key'))
    expect(nodes).toHaveLength(0)
  })
})
