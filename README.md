# threadr

[![CI](https://github.com/Giuseppe552/threadr/actions/workflows/ci.yml/badge.svg)](https://github.com/Giuseppe552/threadr/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

OSINT reconnaissance tool for security professionals. Maps relationships between digital identities to help defenders understand their attack surface, verify their own exposure, and investigate incidents.

Feed it an email, domain, or username. It queries public data sources and builds a graph of connected accounts, infrastructure, and metadata.

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

## cli

No browser needed. Scans run directly against Neo4j, bypassing the queue and API server.

```sh
# scan an email, output JSON
npm run cli -- scan user@example.com

# scan a domain with 3 levels of expansion, output GraphML
npm run cli -- scan example.com --depth 3 --format graphml > graph.xml

# scan with specific plugins only, suppress logs
npm run cli -- scan user@example.com --plugins dns,whois,crtsh -q | jq '.nodes[]'

# dump existing graph data
npm run cli -- graph example.com

# list all plugins
npm run cli -- plugins
```

Pipe into `jq`, `grep`, other tools. Automate with cron. Run from CI/CD.

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

13 plugins work without any API keys. 4 need keys you provide yourself (Shodan, VirusTotal, HIBP, SecurityTrails). Plugins without keys are silently skipped.

Writing your own plugin takes about 30 lines. See [CONTRIBUTING.md](CONTRIBUTING.md).

## no central server

threadr is 100% self-hosted. There is no threadr.com, no cloud service, no central API, no telemetry, no phone-home.

- **Your API keys stay on your machine.** They're stored in a local SQLite file, never transmitted anywhere except to the API they belong to (Shodan, GitHub, etc.).
- **Your scan data stays on your machine.** Neo4j runs locally in Docker. Nothing leaves your network.
- **There's nothing to pay for.** No subscription, no usage fees, no premium tier. The tool runs on your hardware, uses your bandwidth, queries APIs with your keys.
- **No rate limits from us** because there is no "us." The only rate limits are from the external APIs themselves (GitHub: 10 req/min unauthenticated, Shodan: depends on plan, etc.).
- **Tor proxies run locally.** The Docker Compose Tor instances are on your machine. Traffic exits through the Tor network, not through any threadr infrastructure.

If you clone this repo and run `docker compose up -d`, the only external connections are the ones your plugins make to their data sources. That's it.

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

## who this is for

- **Security teams** — map your organization's external attack surface. Find forgotten subdomains, exposed services, leaked credentials, misconfigured DNS.
- **Pentesters** — authorized reconnaissance during engagements. Document the OSINT phase with exportable graphs and reproducible data.
- **Incident responders** — during a breach, trace how an attacker might have discovered your infrastructure. Understand what's publicly visible.
- **Bug bounty hunters** — enumerate targets within authorized scope. The graph view makes it easy to spot overlooked assets.
- **Individuals** — check your own digital footprint. See what an attacker would find if they searched your email address.
- **Journalists** — verify source claims, investigate public-interest infrastructure. All data comes from public sources.

## responsible use

threadr queries publicly available data sources. It does not break into systems, bypass authentication, or access private data. Every data point it finds is already public.

That said, tools don't have intent — people do. This tool is built for defense: understanding exposure, securing infrastructure, responding to incidents. Using it to stalk, harass, or target individuals is not what it's for and is likely illegal in your jurisdiction.

If you discover someone's personal information through threadr, the right thing to do is tell them, not exploit it.

All plugins respect upstream API rate limits. In default mode, the tool identifies itself as `threadr/0.1` in User-Agent headers. In stealth mode (`--stealth`), it mimics a standard browser to avoid bot detection.

## data access

Every scan result is downloadable in two formats:

- **JSON** — full graph with nodes, edges, properties, timestamps. Pipe into `jq`, load into Python, feed into other tools.
- **GraphML** — standard graph format. Import directly into Gephi, yEd, Cytoscape, or any graph analysis tool.

From the web UI: export links are in the bottom bar of every scan. From the CLI: JSON goes to stdout by default, `--format graphml` for GraphML.

No accounts, no paywalls, no "export is a premium feature." You ran the scan on your machine. The data is yours.

## support

threadr is free and always will be. No paid tiers, no premium plugins, no limits.

If you find it useful, star the repo or [buy me a coffee](https://giuseppegiona.com).

## license

MIT. See [LICENSE](LICENSE).
