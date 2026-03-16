# threadr

OSINT reconnaissance tool that maps relationships between digital identities. Feed it an email, domain, or username and it builds a graph of connected accounts, infrastructure, and metadata.

Free. Open source. Self-hosted. No cloud, no accounts, no tracking.

```
                  ┌─────────┐
                  │  web ui │ :80
                  │ (react) │
                  └────┬────┘
                       │ /api/
                  ┌────▼────┐
                  │   api   │ :3001
                  │ (hono)  │
                  └──┬───┬──┘
              ┌──────┘   └──────┐
         ┌────▼────┐       ┌────▼────┐
         │ sqlite  │       │  redis  │
         │ (scans) │       │ (queue) │
         └─────────┘       └────┬────┘
                           ┌────▼────┐
                           │ worker  │
                           │(bullmq) │
                           └────┬────┘
                           ┌────▼────┐
                           │  neo4j  │
                           │ (graph) │
                           └─────────┘
```

## quick start

```sh
git clone https://github.com/Giuseppe552/threadr.git
cd threadr
docker compose up -d
open http://localhost
```

Three commands. Neo4j, Redis, and SQLite are handled by the compose file.

## development

```sh
npm install
docker compose up neo4j redis -d   # just the databases
npm run build
npm run dev                         # starts api + worker + web
```

## what it does

Enter an email address. threadr queries 17 data sources simultaneously, discovers linked accounts, infrastructure, and metadata, then builds a force-directed graph of relationships.

Enter a domain. It pulls certificate transparency logs, full DNS enumeration (A/AAAA/MX/NS/TXT/SOA/CNAME), WHOIS data, HTTP fingerprinting, open ports, historical DNS records, and associated domains. Every subdomain, every nameserver, every SPF include — mapped.

Enter a username. It checks 8 social platforms, finds linked emails, follows the trail across GitHub repos and PGP keyservers.

Enter an IP. It does reverse DNS, reverse IP (all domains on that IP), geolocation (country/city/ASN/ISP), and port scanning.

Everything links together. An email leads to a GitHub account, which leads to commit emails, which lead to domains, which lead to subdomains, which lead to IPs, which lead to other domains sharing that IP. threadr follows the graph.

## plugins

| plugin | input | api key | what it does |
|--------|-------|---------|-------------|
| github | Email | no | finds github accounts, grabs repos |
| crt.sh | Domain | no | certificate transparency → subdomains |
| dns | Domain | no | full enumeration: A/AAAA/MX/NS/TXT/SOA/CNAME, SPF parsing, SOA hostmaster extraction |
| gravatar | Email | no | profile lookup via md5 hash |
| social | Username | no | HEAD checks across 8 platforms |
| shodan | IP, Domain | yes | open ports, banners, org info |
| git-emails | Repository | no | scrapes committer emails from git log |
| whois | Domain | no | raw TCP to port 43, registrar/registrant |
| virustotal | Domain, IP | yes | malicious score from VT community |
| pgp | Email | no | HKP keyserver lookup |
| hibp | Email | yes | breach history from haveibeenpwned |
| reverse-dns | IP | no | PTR record lookup — hostname from IP |
| reverse-ip | IP | no | all domains hosted on the same IP |
| geoip | IP | no | country, city, ISP, ASN, coordinates |
| http-fingerprint | Domain | no | web server, framework, CDN, CMS, security headers |
| email-validation | Email | no | MX check + SMTP RCPT TO probe + catch-all detection |
| securitytrails | Domain, IP | yes | passive DNS history, subdomains, associated domains |

13 plugins work without any API keys. Add Shodan, VirusTotal, HIBP, or SecurityTrails keys in the settings page for deeper coverage. Plugins that need keys are skipped when none are configured.

Writing your own plugin takes about 30 lines. See [CONTRIBUTING.md](CONTRIBUTING.md).

## entity resolution

After plugins run, the resolver compares all `Person` nodes pairwise using Jaro-Winkler string similarity with Fellegi-Sunter probabilistic scoring. Fields compared: emails, usernames, avatar hashes, names.

- Score ≥ 0.85 → auto-linked with `PROBABLY_IS` edge
- Score 0.6–0.84 → suggested for manual review
- Score < 0.3 → ignored

This catches cases where the same person appears across multiple platforms with slightly different usernames or display names. Merge suggestions show up in the scan view.

## monitoring

Create monitors on any scan to re-run it on a schedule (hourly, daily, weekly). The worker takes graph snapshots before and after each re-scan, diffs them, and generates alerts:

- **critical** — breach exposure detected
- **high** — new open ports
- **medium** — new subdomains, cert changes, WHOIS changes
- **low** — new social profiles, usernames

Set up a monitor on a target, walk away. threadr tells you when something changes.

## vs other tools

| | threadr | maltego | spiderfoot |
|---|---|---|---|
| open source | MIT | no | yes (LGPLv3) |
| graph ui | force-directed | yes | table-based |
| entity resolution | automatic | manual | no |
| monitoring/alerts | yes | no | limited |
| self-hosted | docker compose | desktop app | docker |
| price | free | starts at €999/yr | free/paid |
| plugins | 17 (extensible) | 300+ (marketplace) | 200+ (built-in) |

threadr has fewer data sources than Maltego or SpiderFoot. What it has is automatic entity resolution, continuous monitoring, and a clean graph UI — in a self-hosted package you can run in three commands.

## limitations

- Social profile detection uses HEAD requests — false positives happen (LinkedIn especially)
- WHOIS parsing is best-effort since every registrar formats output differently
- Entity resolution is O(n²) on person nodes — fine for typical scans, needs optimization for huge datasets
- crt.sh can be slow or rate limit aggressively
- No authentication on the web UI — run behind a reverse proxy if exposing to a network

## stack

- **web**: React + Vite + Tailwind + react-force-graph-2d
- **api**: Hono on Node.js
- **worker**: BullMQ + Node.js
- **graph db**: Neo4j
- **queue**: Redis
- **metadata**: SQLite (better-sqlite3, WAL mode)

## support

threadr is free and always will be. No paid tiers, no premium plugins, no limits.

If you find it useful, star the repo or [buy me a coffee](https://giuseppegiona.com).

## license

MIT. See [LICENSE](LICENSE).
