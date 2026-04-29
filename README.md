# CASA Ready

> An open-source toolkit to help developers pass Google's CASA Tier 2 security assessment without paying $15K–$40K to consulting firms.

**Status:** V1 (`v0.1.0`) — first usable release. Built in the open while passing CASA for [Magpipe](https://magpipe.ai).

## Why this exists

If your app uses restricted Google API scopes (full Gmail, Drive, Calendar), Google requires an annual [CASA Tier 2 assessment](https://appdefensealliance.dev/casa). The official self-scan path was deprecated in 2025 — your only options now are the [TAC Security](https://tacsecurity.com) lab ($540–$1,800) or a big firm ($15K–$40K).

The bottleneck isn't the money. It's:

1. **No public guide.** TAC drops you in a portal with no instructions.
2. **A 50+ question Self-Assessment Questionnaire** that takes most of the time.
3. **OWASP ZAP / Fluid Attacks setup** the App Defense Alliance's own docs make harder than it needs to be.
4. **Annual recert** that resets the pain.

CASA Ready closes those gaps so an indie dev can get to a Letter of Validation in days, not months.

## Planned V1

| Component | What it does |
|---|---|
| `casa-ready scan` | Runs OWASP ZAP in Docker against your deployed app with the CASA-mapped CWE policy preloaded; emits the `.txt` artifacts the portal accepts. Target URL comes from `casa-ready.config.js`. |
| `casa-ready saq` | SAQ Copilot — drafts answers to the 50+ Self-Assessment Questionnaire items from your repo + cloud config, with the "cloud provider handles that" / NA patterns built in |
| `casa-ready precheck` | Top-20 CWE pre-fix snippets (security headers, HSTS, CSP, secure cookies, CORS lockdown) for common stacks — get scan-clean before you ever pay TAC |
| `docs/playbook.md` | The missing TAC dashboard manual, step-by-step |

## Out of scope (deliberately)

- Multi-framework support (SOC 2, ISO 27001) — see [Probo](https://github.com/getprobo/probo) or [Comp AI](https://github.com/trycompai/comp)
- Cloud infra scanning (AWS/Azure config checks) — see [Shasta](https://github.com/transilienceai/shasta)
- Hosted/managed service — this is a free toolkit, not a SaaS replacement for TAC

## Project layout

```
casa-ready/
├── README.md           ← you are here
├── LICENSE             ← MIT
├── package.json
├── bin/                ← CLI entrypoint
├── cli/                ← command implementations
│   └── commands/
├── configs/
│   └── zap/            ← OWASP ZAP CWE policy files (ADA-mapped)
└── docs/
    ├── research-findings.md   ← living research log
    └── playbook.md            ← TAC submission walkthrough (coming)
```

## Using `casa-ready scan`

### Quick start

```bash
# 1. Install (pick one)
npm install -g casa-ready                              # global install
# OR
npm install --save-dev casa-ready                      # local dev dep (recommended for CI)
# OR run via npx (no install — slower per invocation, always latest)

# 2. Get the example config
#    Global install:
cp $(npm root -g)/casa-ready/casa-ready.config.example.js casa-ready.config.js
#    Local dev dep:
cp node_modules/casa-ready/casa-ready.config.example.js casa-ready.config.js
#    npx (no install) — download directly:
curl -O https://raw.githubusercontent.com/elagerway/casa-ready/main/casa-ready.config.example.js
mv casa-ready.config.example.js casa-ready.config.js

# 3. Edit casa-ready.config.js: set your app URLs and login form details

# 4. Set creds (never put these in the config file)
export CASA_READY_USER=your-test-user@example.com
export CASA_READY_PASS=your-test-password

# 5. Scan staging (default)
casa-ready scan          # or: npx casa-ready scan

# 6. Scan prod (requires explicit confirmation)
casa-ready scan --env prod --confirm-prod
```

### Output

Each scan writes to `scan-output/<env>/<timestamp>/`:

- `results.txt` — text artifact for TAC portal upload
- `results.xml` — ZAP machine-readable output
- `results.html` — human-readable ZAP report
- `results.json` — raw findings (JSON)
- `summary.md` — CASA Ready triage summary, grouped by severity, with "likely NA" hints

### Requirements

- Node 20 or later
- Docker (the official `zaproxy/zap-stable` image is pulled on first run)

### Running the integration smoke test

The unit suite (`npm test`) skips the end-to-end smoke test by default. To exercise the full pipeline against a real ZAP container hitting [OWASP Juice Shop](https://github.com/bkimminich/juice-shop):

```bash
# Terminal 1 — start juice-shop locally
docker run --rm -p 3000:3000 bkimminich/juice-shop

# Terminal 2 — run the smoke test
RUN_INTEGRATION=1 npm run test:integration
```

First run pulls the ~900 MB `zaproxy/zap-stable` image; allow up to 10 minutes. Subsequent runs are faster. Successful smoke produces `scan-output/staging/<timestamp>/` containing `results.json`, `results.txt`, `results.xml`, `results.html`, and `summary.md`.

### Known V1 limitations

- **Form-based auth only.** ZAP's form-auth (type=2) is the only auth path supported in V1. JSON-body login endpoints (e.g. Supabase Auth's `POST /auth/v1/token`) need ZAP's script-based auth (type=4) — tracked as a follow-up.
- **Single `loginUrl` for all envs.** Both staging and prod scans use the one `auth.loginUrl` from your config. If your prod login URL differs, edit the config before scanning prod.
- **Single origin.** V1 scans the primary URL you point it at. Multi-origin (e.g. SPA + separate API host) is V1.1.
- **Anonymous + authenticated coverage.** ZAP only walks the surfaces it can reach with the supplied credentials. OAuth-gated pages (e.g. Gmail-restricted user paths) require V2's authenticated-flow scanning.

## Status & roadmap

V1 must ship before **2026-07-23** — Magpipe's CASA deadline. Built in lockstep with that submission so every feature is grounded in a real pain point we hit.

### Roadmap

| Version | Scope | Triggered by |
|---|---|---|
| **V1** (in design) | `casa-ready scan` — anonymous + form-auth OWASP ZAP scan against the primary origin (e.g., `magpipe.ai`) with the CASA-mapped CWE policy | The 2026-07-23 deadline |
| **V1.1** | Adds Supabase / API endpoints as a second scan target with API-tuned config | V1 ships clean + we have an endpoint manifest |
| **V2** | Authenticated scan: ZAP context with session replay + OAuth flows | V1.1 ships + TAC findings reveal coverage gaps anonymous scans can't catch |
| later | `casa-ready saq` — SAQ Copilot drafting from repo + cloud config | After V1 produces real scan output to feed it |
| later | `casa-ready precheck` — Top-20 CWE pre-fix snippets for common stacks | After we see which CWEs Magpipe (and contributors' apps) actually trip |

## License

MIT. Use it, fork it, sell services around it.
