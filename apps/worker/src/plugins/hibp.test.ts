import { describe, it, expect, vi, beforeEach } from 'vitest'
import { hibp } from './hibp'

const seed = (email: string) => ({ type: 'Email' as const, key: 'address', value: email })

function mockKeys(key: string | null) {
  const burned: string[] = []
  return {
    get: (id: string) => id === 'hibp' ? key : null,
    markBurned: (_id: string, k: string) => { burned.push(k) },
    burned,
  }
}

beforeEach(() => { vi.restoreAllMocks() })

describe('hibp plugin', () => {
  it('has correct metadata', () => {
    expect(hibp.id).toBe('hibp')
    expect(hibp.accepts).toContain('Email')
    expect(hibp.requiresKey).toBe(true)
  })

  it('returns empty when no API key provided', async () => {
    const { nodes, edges } = await hibp.run(seed('test@test.com'), mockKeys(null))
    expect(nodes).toHaveLength(0)
    expect(edges).toHaveLength(0)
  })

  it('creates Breach nodes with EXPOSED_IN edges', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ([
        { Name: 'Adobe', BreachDate: '2013-10-04', DataClasses: ['Email addresses', 'Passwords'] },
        { Name: 'LinkedIn', BreachDate: '2012-05-05', DataClasses: ['Email addresses'] },
      ]),
    }))

    const { nodes, edges } = await hibp.run(seed('pwned@test.com'), mockKeys('valid-key'))

    expect(nodes).toHaveLength(2)
    expect(nodes[0].label).toBe('Breach')
    expect(nodes[0].props.name).toBe('Adobe')
    expect(nodes[0].props.date).toBe('2013-10-04')
    expect(nodes[0].props.data_classes).toBe('Email addresses, Passwords')

    expect(edges).toHaveLength(2)
    expect(edges[0].rel).toBe('EXPOSED_IN')
    expect(edges[0].fromVal).toBe('pwned@test.com')
  })

  it('returns empty on 404 (no breaches)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))

    const { nodes } = await hibp.run(seed('clean@test.com'), mockKeys('valid-key'))
    expect(nodes).toHaveLength(0)
  })

  it('marks key as burned on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }))

    const keys = mockKeys('bad-key')
    await hibp.run(seed('test@test.com'), keys)
    expect(keys.burned).toContain('bad-key')
  })

  it('marks key as burned on 403', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }))

    const keys = mockKeys('expired-key')
    await hibp.run(seed('test@test.com'), keys)
    expect(keys.burned).toContain('expired-key')
  })

  it('sends correct headers', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 404 })
    vi.stubGlobal('fetch', mockFetch)

    await hibp.run(seed('test@test.com'), mockKeys('my-key'))

    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toContain(encodeURIComponent('test@test.com'))
    expect(opts.headers['hibp-api-key']).toBe('my-key')
  })
})
