# CASA Ready

> An open-source toolkit to help developers pass Google's CASA Tier 2 security assessment without paying a security consulting firm.

**Status:** V2 (`v0.4.4`) — endpoint seeding (`seedDir`/`seedUrls`) shipped; OAuth callback active-scanning experimental (V2.1 work). Built in the open while passing CASA for [Magpipe](https://magpipe.ai).

## Why this exists

If your app uses restricted Google API scopes (full Gmail, Drive, Calendar), Google requires an annual [CASA Tier 2 assessment](https://appdefensealliance.dev/casa). The official self-scan path was deprecated in 2025 — your two options now are [TAC Security](https://tacsecurity.com)'s official lab ($540–$1,800/year) or a pen-test from a security consultancy (typically thousands to tens of thousands of dollars, plus weeks of back-and-forth).

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

# 2. Generate your config interactively (recommended)
casa-ready init                                # walks you through the prompts
# OR copy the YAML example and hand-edit
curl -O https://raw.githubusercontent.com/elagerway/casa-ready/main/casa-ready.yml.example
mv casa-ready.yml.example casa-ready.yml

# 3. Edit casa-ready.yml — VS Code with the YAML extension installed gives you
#    inline autocomplete + schema validation thanks to the published JSON Schema

# 4. Set creds (never put these in the config file)
export CASA_READY_USER=your-test-user@example.com
export CASA_READY_PASS=your-test-password

# 5. Scan staging — runs all configured targets sequentially
casa-ready scan                                # all targets in staging
casa-ready scan --target spa                   # just the 'spa' target

# 6. Scan prod — requires explicit confirmation
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

## Migrating from v0.1.0 → v0.2.0 (V1.1)

V1.1 introduces multi-target scanning, which is a breaking config change. The single `auth` block per env is replaced by a `targets[]` array, and each target has its own URL + auth type.

**Before (v0.1.0 single-target form auth):**

```javascript
export default {
  app: 'your-app',
  envs: {
    staging: 'https://staging.your-app.com',
    prod: 'https://your-app.com',
  },
  auth: {
    type: 'form',
    loginUrl: '...',
    loginRequestBody: 'email={%username%}&password={%password%}',
    // ...
  },
};
```

**After (v0.2.0 multi-target):**

```javascript
export default {
  app: 'your-app',
  envs: {
    staging: {
      targets: [
        {
          name: 'spa',
          url: 'https://staging.your-app.com',
          auth: { type: 'form', /* same fields as before */ },
        },
        // Add additional targets (e.g. Supabase API) here.
      ],
    },
    prod: { targets: [/* same shape */] },
  },
};
```

See `casa-ready.yml.example` for a worked example with both `form` and `supabase-jwt` auth.

## Migrating from v0.2.x → v0.3.0

V0.3.0 replaces the JS config with YAML. Easiest path: `rm casa-ready.config.js && casa-ready init`. See [MIGRATION.md](./MIGRATION.md) for a side-by-side translation.

## v0.3.x → v0.4.0

V0.4.0 is fully backward-compatible. New optional fields on `targets[]`:

```yaml
seedDir: ./supabase/functions   # Supabase shortcut: glob subdirs into seed URLs
seedUrls: ['/functions/v1/legacy-endpoint']   # explicit list (full URLs or paths)
scan: oauth-callback            # per-target scan flavor (only oauth-callback for now)
auth: { type: none }            # for genuinely public endpoints
callbackParams:                 # required when scan: oauth-callback
  state: test-state-token
  code: test-authorization-code
```

For Supabase apps, the one-line addition is `seedDir: ./supabase/functions` on your existing `api` target. ZAP's spider then discovers all your Edge Functions automatically.

**OAuth callback active-scanning is experimental in v0.4.x** — see the CHANGELOG `[0.4.4]` entry for the known `URL_NOT_IN_CONTEXT` failure mode and the V2.1 tracking note. The schema accepts the shape today; only the implementation is broken. The seedDir-based passive scan above DOES exercise OAuth callback endpoints — just without active param fuzzing.

### IDE autocomplete

VS Code with the [YAML extension](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml) installed picks up CASA Ready's published JSON Schema automatically (via the `# yaml-language-server: $schema=...` directive that `casa-ready init` writes at the top of your config). You get inline field validation, autocomplete on every key, and schema-aware error messages.

### New auth type: `supabase-jwt`

For Supabase-backed apps, the `supabase-jwt` auth type performs the JSON-body Supabase login, extracts the JWT, and includes it on subsequent requests. It also wires ZAP's periodic re-auth so long scans don't fail when the 1-hour JWT expires.

### Known V1 limitations

- **Scan policy is a permissive fallback, not the official ADA-tuned policy.** The App Defense Alliance distributes its CASA-tuned ZAP policy via the [Tier 2 tooling matrix](https://appdefensealliance.dev/casa/tier-2/tooling-matrix), not in their public GitHub repo. V1 ships with a `MEDIUM`/`HIGH` OWASP Top 10 fallback in `configs/zap/casa-tier2.policy`. Replacing it with the official policy is the first V1.1 improvement (see `configs/zap/README.md`).
- **Two auth types: `form` and `supabase-jwt`.** Other JSON-API auth providers (Auth0, Firebase, custom) need a new auth module — generic `json-script` is a future addition.
- **Single `loginUrl` for all envs.** Both staging and prod scans use the one `auth.loginUrl` from your config. If your prod login URL differs, edit the config before scanning prod.
- **Anonymous + authenticated coverage.** ZAP only walks the surfaces it can reach with the supplied credentials. OAuth-gated pages (e.g. Gmail-restricted user paths) require V2's authenticated-flow scanning.

## Status & roadmap

V1 must ship before **2026-07-23** — Magpipe's CASA deadline. Built in lockstep with that submission so every feature is grounded in a real pain point we hit.

### Roadmap

| Version | Scope | Triggered by |
|---|---|---|
| **V1** (in design) | `casa-ready scan` — anonymous + form-auth OWASP ZAP scan against the primary origin (e.g., `magpipe.ai`) with the CASA-mapped CWE policy | The 2026-07-23 deadline |
| **V1.1** ✓ | Multi-target scanning (`targets[]`) + `supabase-jwt` auth with JWT refresh | Shipped 2026-04-29 in `v0.2.0` |
| **V1.2** ✓ | YAML config + `init` command + JSON Schema + TS types — OSS launch quality | Shipped 2026-05-01 in `v0.3.0` |
| **V2** ◐ | Endpoint seeding (`seedDir`/`seedUrls`) ✓ shipped; OAuth callback active-scanning experimental | `v0.4.0`–`v0.4.4` 2026-05-01 |
| **V2.1** | OAuth callback active-scan rewrite — custom `--hook` bypassing `zap-api-scan.py` host-root normalization | Next |
| later | `casa-ready saq` — SAQ Copilot drafting from repo + cloud config | After V1 produces real scan output to feed it |
| later | `casa-ready precheck` — Top-20 CWE pre-fix snippets for common stacks | After we see which CWEs Magpipe (and contributors' apps) actually trip |

## License

MIT. Use it, fork it, sell services around it.
