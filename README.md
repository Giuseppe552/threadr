# threadr

OSINT reconnaissance tool that maps relationships between digital identities. Feed it an email, domain, or username and it builds a graph of connected accounts, infrastructure, and metadata.

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
docker compose up -d
open http://localhost
```

Needs Docker and Docker Compose. Neo4j, Redis, and SQLite are handled by the compose file.

## development

```sh
npm install
docker compose up neo4j redis -d   # just the databases
npm run build
npm run dev                         # starts api + worker + web
```

## plugins

| plugin | input | api key | what it does |
|--------|-------|---------|-------------|
| github | Email | no | finds github accounts, grabs repos |
| crt.sh | Domain | no | certificate transparency → subdomains |
| dns | Domain | no | MX + TXT records |
| gravatar | Email | no | profile lookup via md5 hash |
| social | Username | no | HEAD checks across 8 platforms |
| shodan | IP, Domain | yes | open ports, banners, org info |
| git-emails | Repository | no | scrapes committer emails from git log |
| whois | Domain | no | raw TCP to port 43, registrar/registrant |
| virustotal | Domain, IP | yes | malicious score from VT community |
| pgp | Email | no | HKP keyserver lookup |
| hibp | Email | yes | breach history from haveibeenpwned |

API keys are managed in the settings page. Plugins that need keys are skipped when no key is configured.

## entity resolution

After plugins run, the resolver compares all `Person` nodes pairwise using Jaro-Winkler string similarity with Fellegi-Sunter probabilistic scoring. Fields compared: emails, usernames, avatar hashes, names.

- Score ≥ 0.85 → auto-linked with `PROBABLY_IS` edge
- Score 0.6–0.84 → suggested for manual review
- Score < 0.3 → ignored

Merge suggestions show up in the scan view.

## monitoring

Create monitors on any scan to re-run it on a schedule (hourly, daily, weekly). The worker takes graph snapshots before and after each re-scan, diffs them, and generates alerts for new nodes/edges.

Severity levels:
- **critical** — breach exposure
- **high** — new open ports
- **medium** — new subdomains, cert changes, whois changes
- **low** — new social profiles, usernames

## limitations

- Social profile detection uses HEAD requests — false positives happen (linkedin especially)
- WHOIS parsing is best-effort since every registrar formats output differently
- Entity resolution is O(n²) on person nodes — works fine for typical scans but would need optimization for huge datasets
- crt.sh can be slow or rate limit aggressively
- No authentication on the web UI — run behind a reverse proxy if exposed

## vs other tools

| | threadr | maltego | spiderfoot |
|---|---|---|---|
| open source | yes | no | yes |
| graph ui | yes | yes | table-based |
| entity resolution | automatic | manual | no |
| monitoring/alerts | yes | no | limited |
| self-hosted | docker compose | desktop app | docker |
| price | free | expensive | free/paid |

## stack

- **web**: React + Vite + Tailwind + react-force-graph-2d
- **api**: Hono on Node.js
- **worker**: BullMQ + Node.js
- **graph db**: Neo4j
- **queue**: Redis
- **metadata**: SQLite (better-sqlite3)
