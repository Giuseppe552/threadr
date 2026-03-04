import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { Plugin, PluginResult } from '@threadr/shared'

const exec = promisify(execFile)

const NOREPLY = /noreply|users\.noreply|localhost|example\.com/i

export const gitEmails: Plugin = {
  id: 'git-emails',
  name: 'Git Email Scraper',
  accepts: ['Repository'],
  requiresKey: false,
  rateLimit: { requests: 3, windowMs: 60_000 },

  async run(seed, _keys): Promise<PluginResult> {
    const nodes: PluginResult['nodes'] = []
    const edges: PluginResult['edges'] = []
    const repoUrl = seed.value

    // need a clone-able url
    const url = repoUrl.startsWith('http')
      ? repoUrl
      : `https://github.com/${repoUrl}`

    let tmp: string | null = null
    try {
      tmp = await mkdtemp(path.join(tmpdir(), 'threadr-git-'))

      console.log(`[*] git-emails: cloning ${url}`)
      await exec('git', ['clone', '--bare', '--depth=50', url, tmp], { timeout: 30_000 })

      const { stdout } = await exec('git', ['log', '--format=%ae|%an', '--all'], { cwd: tmp, timeout: 10_000 })

      const seen = new Set<string>()
      for (const line of stdout.split('\n')) {
        const [email, name] = line.split('|')
        if (!email || seen.has(email) || NOREPLY.test(email)) continue
        seen.add(email)

        console.log(`[+] git-emails: ${email} (${name})`)

        nodes.push({ label: 'Email', key: 'address', props: { address: email } })
        edges.push({
          fromLabel: 'Email', fromKey: 'address', fromVal: email,
          toLabel: 'Repository', toKey: 'name', toVal: repoUrl, rel: 'COMMITTED_TO',
        })

        if (name) {
          nodes.push({ label: 'Person', key: 'name', props: { name, source: 'git-log' } })
          edges.push({
            fromLabel: 'Email', fromKey: 'address', fromVal: email,
            toLabel: 'Person', toKey: 'name', toVal: name, rel: 'LINKED_TO',
          })
        }
      }
    } catch (err) {
      console.log(`[!] git-emails: ${(err as Error).message}`)
    } finally {
      if (tmp) await rm(tmp, { recursive: true, force: true }).catch(() => {})
    }

    return { nodes, edges }
  },
}
