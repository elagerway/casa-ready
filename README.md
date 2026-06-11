# CASA Ready

> The Claude Code plugin (and bundled CLI) that helps developers pass Google's CASA Tier 2 security assessment without paying a security consulting firm.

**Status:** `triage-findings` skill + `casa-ready triage` CLI shipped (see [CHANGELOG](CHANGELOG.md) for the current version). Built in the open, exercised against real applications.

## How it works

CASA Ready is a Claude Code plugin that walks you through CASA prep, with a bundled CLI for the actual scanning work.

**You stay in Claude Code.** Ask "help me get CASA certified" — the plugin's skills do the rest:

- `casa-ready:triage-findings` (V0.5.0, this release) — reads scan output, classifies findings, drafts patches for Actionable items, produces SAQ-ready answer text
- `casa-ready:complete-saq` (V0.6.0, planned) — walks through the SAQ portal question-by-question
- `casa-ready:run-scan`, `casa-ready:configure-scan`, `casa-ready:submit-to-tac`, `casa-ready:annual-recert` — coming in V0.6.0+

The plugin shells out to a CLI (`casa-ready scan`, `casa-ready triage`) that does the deterministic work — Docker orchestration, ZAP config, finding classification — while skills do the per-codebase judgment work (read your code, draft patches, personalize SAQ text).

## Install

Prerequisites: [Claude Code](https://claude.com/claude-code), Node 20+, Docker.

```bash
# 1. Install the plugin
claude plugin install https://github.com/elagerway/casa-ready

# 2. Install the bundled CLI
npm install -g casa-ready
```

## Quick start (in Claude Code)

```bash
# 1. Scaffold a config in your project
casa-ready init

# 2. Set credentials (never put these in the config file)
export CASA_READY_USER=your-test-user@example.com
export CASA_READY_PASS=your-test-password

# 3. Scan — Claude can drive this for you, or run it yourself
casa-ready scan

# 4. Triage — same: Claude can drive, or run it yourself
casa-ready triage

# 5. Open Claude Code and ask: "triage my CASA findings"
#    The casa-ready:triage-findings skill takes it from there.
```

## Using the CLI standalone in CI

If you don't use Claude Code, the CLI works on its own. It produces TAC-portal-ready artifacts and exits with code 1 when Actionable findings are present (so it gates CI cleanly):

```bash
npm install -g casa-ready          # or use as a dev dep + npx
casa-ready scan
casa-ready triage                  # exits 1 if Actionable findings present
```

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
method: [GET, POST]             # optional; default GET. POST = response_mode=form_post
callbackParams:                 # required when scan: oauth-callback
  state: test-state-token
  code: test-authorization-code
  redirect_uri: https://your-app.example/dashboard
```

For Supabase apps, the one-line addition is `seedDir: ./supabase/functions` on your existing `api` target. ZAP's spider then discovers all your Edge Functions automatically.

**OAuth callback active-scanning** (since `v0.6.0`) runs `zap-full-scan.py` against the exact callback URL with a custom `--hook` that seeds the parameterized request(s) into ZAP's Sites tree, so `callbackParams` become real injection points. The optional `method` field accepts `GET`, `POST`, or `[GET, POST]` (default `GET`); `POST` sends the params as an `application/x-www-form-urlencoded` body for OAuth `response_mode=form_post` callbacks. ZAP's External Redirect rule covers open-redirect on `redirect_uri`.

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

Every feature is grounded in a real pain point hit while scanning live applications — nothing here is speculative tooling.

### Roadmap

| Version | Scope | Triggered by |
|---|---|---|
| **V1** ✓ | `casa-ready scan` — anonymous + form-auth OWASP ZAP scan against the primary origin with the CASA-mapped CWE policy | Shipped 2026-04-29 in `v0.1.0` |
| **V1.1** ✓ | Multi-target scanning (`targets[]`) + `supabase-jwt` auth with JWT refresh | Shipped 2026-04-29 in `v0.2.0` |
| **V1.2** ✓ | YAML config + `init` command + JSON Schema + TS types — OSS launch quality | Shipped 2026-05-01 in `v0.3.0` |
| **V2** ✓ | Endpoint seeding (`seedDir`/`seedUrls`) + OAuth callback active-scanning | `v0.4.0`–`v0.4.4` 2026-05-01 |
| **V2.1** ✓ | OAuth callback active scan rewrite — custom `--hook` on `zap-full-scan.py` (GET + POST, open-redirect on `redirect_uri`); replaces the experimental `zap-api-scan.py` path | Shipped 2026-06-11 in `v0.6.0` |
| **V0.5.0** ✓ | `triage-findings` skill + `casa-ready triage` CLI — the first piece of the casa-ready Claude Code plugin | Shipped 2026-05-01 |
| **V0.6.0** | `complete-saq` skill — SAQ Copilot drafting answers from triage findings + repo context | Next |
| later | `casa-ready precheck` — Top-20 CWE pre-fix snippets for common stacks | After we see which CWEs contributors' apps actually trip |

## License

MIT. Use it, fork it, sell services around it.
