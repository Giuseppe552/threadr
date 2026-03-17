import dns from 'node:dns/promises'
import net from 'node:net'
import type { Plugin, PluginResult } from '@threadr/shared'

/**
 * Email validation — checks if an email address actually receives mail.
 *
 * Three checks:
 * 1. MX record exists for domain
 * 2. SMTP connection to MX server succeeds
 * 3. RCPT TO accepted (without sending)
 *
 * Does NOT send any email. The SMTP conversation stops after RCPT TO.
 * Some servers accept all RCPT TO (catch-all), which is detected.
 */
export const emailValidation: Plugin = {
  id: 'email-validation',
  name: 'Email Validation',
  accepts: ['Email'],
  requiresKey: false,
  rateLimit: { requests: 5, windowMs: 60_000 },

  async run(seed, _keys): Promise<PluginResult> {
    const nodes: PluginResult['nodes'] = []
    const edges: PluginResult['edges'] = []
    const email = seed.value
    const domain = email.split('@')[1]

    const result: Record<string, string> = { address: email }

    // Step 1: MX lookup
    let mxHost: string | null = null
    try {
      const mx = await dns.resolveMx(domain)
      if (mx.length > 0) {
        mx.sort((a, b) => a.priority - b.priority)
        mxHost = mx[0].exchange
        result.mx_host = mxHost
        result.mx_exists = 'true'
      }
    } catch {
      result.mx_exists = 'false'
      result.email_status = 'no_mx'
      console.log(`[-] email-validate: no MX for ${domain}`)
      nodes.push({ label: 'Email', key: 'address', props: result })
      return { nodes, edges }
    }

    if (!mxHost) {
      result.email_status = 'no_mx'
      nodes.push({ label: 'Email', key: 'address', props: result })
      return { nodes, edges }
    }

    // Step 2+3: SMTP RCPT TO check
    try {
      const smtpResult = await smtpCheck(mxHost, email)
      result.smtp_banner = smtpResult.banner.slice(0, 100)
      result.email_status = smtpResult.status
      if (smtpResult.catchAll) result.catch_all = 'true'
      console.log(`[+] email-validate: ${email} → ${smtpResult.status}`)
    } catch (e) {
      result.email_status = 'smtp_error'
      console.log(`[-] email-validate: SMTP failed for ${email}: ${(e as Error).message}`)
    }

    nodes.push({ label: 'Email', key: 'address', props: result })
    return { nodes, edges }
  },
}

interface SmtpResult {
  banner: string
  status: 'valid' | 'invalid' | 'catch_all' | 'unknown'
  catchAll: boolean
}

function smtpCheck(host: string, email: string): Promise<SmtpResult> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(25, host)
    let banner = ''
    let step = 0
    let mainResponse = ''
    let catchAllResponse = ''
    const timeout = setTimeout(() => { socket.destroy(); reject(new Error('timeout')) }, 10_000)

    socket.setEncoding('utf8')

    socket.on('data', (data: string) => {
      const lines = data.trim()

      if (step === 0) {
        // Banner
        banner = lines
        // Generic EHLO — don't identify as threadr
        socket.write('EHLO mail.local\r\n')
        step = 1
      } else if (step === 1) {
        // EHLO response
        socket.write(`MAIL FROM:<postmaster@mail.local>\r\n`)
        step = 2
      } else if (step === 2) {
        // MAIL FROM response
        socket.write(`RCPT TO:<${email}>\r\n`)
        step = 3
      } else if (step === 3) {
        // RCPT TO response for real address
        mainResponse = lines
        // Test catch-all with random address
        const random = `check-${Date.now()}@${email.split('@')[1]}`
        socket.write(`RCPT TO:<${random}>\r\n`)
        step = 4
      } else if (step === 4) {
        // RCPT TO response for random address (catch-all detection)
        catchAllResponse = lines
        socket.write('QUIT\r\n')
        clearTimeout(timeout)

        const mainOk = mainResponse.startsWith('250')
        const catchAllOk = catchAllResponse.startsWith('250')

        if (mainOk && catchAllOk) {
          resolve({ banner, status: 'catch_all', catchAll: true })
        } else if (mainOk) {
          resolve({ banner, status: 'valid', catchAll: false })
        } else {
          resolve({ banner, status: 'invalid', catchAll: false })
        }

        socket.destroy()
      }
    })

    socket.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })
}
