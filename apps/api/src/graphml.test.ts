import { describe, it, expect } from 'vitest'
import { toGraphML, detectSeedType } from './graphml.js'

describe('detectSeedType', () => {
  it('detects email addresses', () => {
    expect(detectSeedType('user@example.com')).toBe('email')
    expect(detectSeedType('admin@corp.internal')).toBe('email')
  })

  it('detects domains', () => {
    expect(detectSeedType('example.com')).toBe('domain')
    expect(detectSeedType('sub.domain.co.uk')).toBe('domain')
  })

  it('detects usernames', () => {
    expect(detectSeedType('johndoe')).toBe('username')
    expect(detectSeedType('h4cker_99')).toBe('username')
  })

  it('prefers email over domain when @ is present', () => {
    expect(detectSeedType('user@host.com')).toBe('email')
  })
})

describe('toGraphML', () => {
  it('produces valid GraphML structure', () => {
    const xml = toGraphML(
      [{ id: 'n1', label: 'Email', props: { address: 'test@example.com' } }],
      [{ from: 'n1', to: 'n2', type: 'OWNS' }]
    )
    expect(xml).toContain('<?xml version="1.0"')
    expect(xml).toContain('<graphml')
    expect(xml).toContain('<node id="n1">')
    expect(xml).toContain('<data key="label">Email</data>')
    expect(xml).toContain('<data key="address">test@example.com</data>')
    expect(xml).toContain('<edge id="e0" source="n1" target="n2">')
    expect(xml).toContain('<data key="type">OWNS</data>')
    expect(xml).toContain('</graphml>')
  })

  it('handles empty graph', () => {
    const xml = toGraphML([], [])
    expect(xml).toContain('<graph id="G"')
    expect(xml).not.toContain('<node')
    expect(xml).not.toContain('<edge')
  })

  it('escapes XML entities in values', () => {
    const xml = toGraphML(
      [{ id: 'n1', label: 'Person', props: { name: 'O\'Brien & "Friends" <test>' } }],
      []
    )
    expect(xml).toContain('O\'Brien &amp; &quot;Friends&quot; &lt;test&gt;')
  })

  it('collects all property keys from nodes', () => {
    const xml = toGraphML(
      [
        { id: 'n1', label: 'Email', props: { address: 'a@b.com' } },
        { id: 'n2', label: 'Person', props: { name: 'John', avatar: 'hash123' } },
      ],
      []
    )
    expect(xml).toContain('attr.name="address"')
    expect(xml).toContain('attr.name="name"')
    expect(xml).toContain('attr.name="avatar"')
  })

  it('numbers edges sequentially', () => {
    const xml = toGraphML(
      [],
      [
        { from: 'a', to: 'b', type: 'OWNS' },
        { from: 'b', to: 'c', type: 'USES' },
        { from: 'c', to: 'd', type: 'RESOLVES_TO' },
      ]
    )
    expect(xml).toContain('edge id="e0"')
    expect(xml).toContain('edge id="e1"')
    expect(xml).toContain('edge id="e2"')
  })
})
