import { describe, it, expect, vi, beforeEach } from 'vitest'
import { github } from './github'

const seed = (email: string) => ({ type: 'Email' as const, key: 'address', value: email })
const noKeys = { get: () => null, markBurned: () => {} }

beforeEach(() => { vi.restoreAllMocks() })

describe('github plugin', () => {
  it('has correct metadata', () => {
    expect(github.id).toBe('github')
    expect(github.accepts).toContain('Email')
    expect(github.requiresKey).toBe(false)
  })

  it('creates Username and Repository nodes from search results', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          total_count: 1,
          items: [{
            login: 'octocat',
            html_url: 'https://github.com/octocat',
            avatar_url: 'https://avatars.githubusercontent.com/u/1',
            repos_url: 'https://api.github.com/users/octocat/repos',
          }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ([
          { full_name: 'octocat/hello-world', html_url: 'https://github.com/octocat/hello-world' },
          { full_name: 'octocat/spoon-knife', html_url: 'https://github.com/octocat/spoon-knife' },
        ]),
      })
    )

    const { nodes, edges } = await github.run(seed('octocat@github.com'), noKeys)

    const userNode = nodes.find(n => n.label === 'Username')
    expect(userNode).toBeDefined()
    expect(userNode!.props.name).toBe('octocat')
    expect(userNode!.props.platform).toBe('github')

    const repos = nodes.filter(n => n.label === 'Repository')
    expect(repos).toHaveLength(2)
    expect(repos[0].props.name).toBe('octocat/hello-world')

    expect(edges.filter(e => e.rel === 'USES')).toHaveLength(1)
    expect(edges.filter(e => e.rel === 'COMMITTED_TO')).toHaveLength(2)
  })

  it('limits repos to 5 per user', async () => {
    const manyRepos = Array.from({ length: 12 }, (_, i) => ({
      full_name: `user/repo-${i}`, html_url: `https://github.com/user/repo-${i}`,
    }))

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          total_count: 1,
          items: [{ login: 'user', html_url: '', avatar_url: '', repos_url: 'http://x' }],
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => manyRepos })
    )

    const { nodes } = await github.run(seed('user@test.com'), noKeys)
    const repos = nodes.filter(n => n.label === 'Repository')
    expect(repos).toHaveLength(5)
  })

  it('returns empty on API failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }))

    const { nodes, edges } = await github.run(seed('nobody@test.com'), noKeys)
    expect(nodes).toHaveLength(0)
    expect(edges).toHaveLength(0)
  })

  it('returns empty when no users match', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ total_count: 0, items: [] }),
    }))

    const { nodes, edges } = await github.run(seed('nobody@test.com'), noKeys)
    expect(nodes).toHaveLength(0)
    expect(edges).toHaveLength(0)
  })

  it('handles missing avatar gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          total_count: 1,
          items: [{ login: 'ghost', html_url: '', avatar_url: null, repos_url: 'http://x' }],
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
    )

    const { nodes } = await github.run(seed('ghost@test.com'), noKeys)
    expect(nodes[0].props.avatar).toBe('')
  })
})
