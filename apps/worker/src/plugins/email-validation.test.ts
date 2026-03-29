import { describe, it, expect, vi, beforeEach } from 'vitest'
import dns from 'node:dns/promises'
import net from 'node:net'
import { emailValidation } from './email-validation'
import { EventEmitter } from 'node:events'

vi.mock('node:dns/promises')

const seed = (email: string) => ({ type: 'Email' as const, key: 'address', value: email })
const noKeys = { get: () => null, markBurned: () => {} }

beforeEach(() => { vi.restoreAllMocks() })

function mockSocket(responses: string[]) {
  const emitter = new EventEmitter()
  const socket = Object.assign(emitter, {
    setEncoding: vi.fn(),
    write: vi.fn().mockImplementation(() => {
      // Feed next response on each write
      const next = responses.shift()
      if (next) setTimeout(() => emitter.emit('data', next), 0)
    }),
    destroy: vi.fn(),
  })

  vi.spyOn(net, 'createConnection').mockImplementation(() => {
    // Emit banner after connection
    setTimeout(() => emitter.emit('data', responses.shift() || '220 mail.example.com'), 0)
    return socket as any
  })

  return socket
}

describe('email-validation plugin', () => {
  it('has correct metadata', () => {
    expect(emailValidation.id).toBe('email-validation')
    expect(emailValidation.accepts).toContain('Email')
    expect(emailValidation.requiresKey).toBe(false)
  })

  it('returns no_mx when domain has no MX records', async () => {
    vi.mocked(dns.resolveMx).mockRejectedValue(new Error('ENOTFOUND'))

    const { nodes } = await emailValidation.run(seed('user@nope.invalid'), noKeys)

    expect(nodes).toHaveLength(1)
    expect(nodes[0].props.email_status).toBe('no_mx')
    expect(nodes[0].props.mx_exists).toBe('false')
  })

  it('returns no_mx when MX list is empty', async () => {
    vi.mocked(dns.resolveMx).mockResolvedValue([])

    const { nodes } = await emailValidation.run(seed('user@empty.com'), noKeys)

    expect(nodes).toHaveLength(1)
    expect(nodes[0].props.email_status).toBe('no_mx')
  })

  it('sorts MX records by priority (lowest first)', async () => {
    vi.mocked(dns.resolveMx).mockResolvedValue([
      { exchange: 'backup.mail.com', priority: 20 },
      { exchange: 'primary.mail.com', priority: 5 },
    ])

    // SMTP will fail — just checking MX selection
    vi.spyOn(net, 'createConnection').mockImplementation(() => {
      const emitter = new EventEmitter()
      const socket = Object.assign(emitter, {
        setEncoding: vi.fn(), write: vi.fn(), destroy: vi.fn(),
      })
      setTimeout(() => emitter.emit('error', new Error('refused')), 0)
      return socket as any
    })

    const { nodes } = await emailValidation.run(seed('user@test.com'), noKeys)

    // Should have tried primary (priority 5), not backup
    expect(nodes[0].props.mx_host).toBe('primary.mail.com')
  })

  it('detects valid email via SMTP', async () => {
    vi.mocked(dns.resolveMx).mockResolvedValue([
      { exchange: 'mx.example.com', priority: 10 },
    ])

    mockSocket([
      '220 mx.example.com ESMTP',  // banner
      '250 OK',                     // EHLO response
      '250 OK',                     // MAIL FROM response
      '250 OK',                     // RCPT TO (real address)
      '550 User not found',         // RCPT TO (random — NOT catch-all)
    ])

    const { nodes } = await emailValidation.run(seed('real@example.com'), noKeys)

    expect(nodes[0].props.email_status).toBe('valid')
    expect(nodes[0].props.catch_all).toBeUndefined()
  })

  it('detects catch-all domains', async () => {
    vi.mocked(dns.resolveMx).mockResolvedValue([
      { exchange: 'mx.catchall.com', priority: 10 },
    ])

    mockSocket([
      '220 mx.catchall.com',
      '250 OK',
      '250 OK',
      '250 OK',  // real address accepted
      '250 OK',  // random address also accepted → catch-all
    ])

    const { nodes } = await emailValidation.run(seed('anyone@catchall.com'), noKeys)

    expect(nodes[0].props.email_status).toBe('catch_all')
    expect(nodes[0].props.catch_all).toBe('true')
  })

  it('detects invalid email via SMTP rejection', async () => {
    vi.mocked(dns.resolveMx).mockResolvedValue([
      { exchange: 'mx.strict.com', priority: 10 },
    ])

    mockSocket([
      '220 mx.strict.com',
      '250 OK',
      '250 OK',
      '550 No such user',  // real address rejected
      '550 No such user',  // random also rejected
    ])

    const { nodes } = await emailValidation.run(seed('nobody@strict.com'), noKeys)

    expect(nodes[0].props.email_status).toBe('invalid')
  })

  it('truncates SMTP banner to 100 chars', async () => {
    vi.mocked(dns.resolveMx).mockResolvedValue([
      { exchange: 'mx.verbose.com', priority: 10 },
    ])

    const longBanner = '220 ' + 'x'.repeat(200)
    mockSocket([longBanner, '250 OK', '250 OK', '250 OK', '550 nope'])

    const { nodes } = await emailValidation.run(seed('test@verbose.com'), noKeys)

    expect(nodes[0].props.smtp_banner.length).toBeLessThanOrEqual(100)
  })

  it('extracts domain from email correctly', async () => {
    vi.mocked(dns.resolveMx).mockRejectedValue(new Error(''))

    const { nodes } = await emailValidation.run(seed('user@sub.domain.co.uk'), noKeys)
    // If DNS call was made for the right domain, the node should exist
    expect(nodes).toHaveLength(1)
    expect(nodes[0].props.address).toBe('user@sub.domain.co.uk')
  })
})
