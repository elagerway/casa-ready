# ZAP Pre-Scan Kit — V1 Design Spec

**Status:** Draft, pending user review
**Date:** 2026-04-29
**Owner:** Erik (`elagerway`) / Snapsonic
**Forcing function:** Magpipe CASA Tier 2 deadline 2026-07-23

## Problem

Magpipe (commercial SaaS at [magpipe.ai](https://magpipe.ai)) uses Gmail API restricted scopes for support-ticket and inbox features, which triggered a Google CASA Tier 2 assessment. Self-scan is deprecated; the only sanctioned path is paying TAC Security ($720 Premium plan) or another authorized lab.

Per the [Reddit r/googlecloud thread](https://www.reddit.com/r/googlecloud/comments/18gbu2a/), the lab process has well-known foot-guns:

- TAC drops you in a portal with no instructions
- The official OWASP ZAP / Fluid Attacks setup docs are described by practitioners as "god awful"
- The first 7 days are typically lost waiting for support to send guides
- Most submissions fail the first scan on the same daniel.es-class issues: missing security headers, no HSTS, weak CSP, insecure cookie flags

The goal of this V1 component is to **let a developer pre-scan their deployed app with an opinionated, pre-configured OWASP ZAP run that produces TAC-acceptable artifacts in one command**, so they walk into the TAC portal already scan-clean and skip the multi-week iteration loop.

## Goals (V1)

1. `casa-ready scan` runs a CASA-tuned OWASP ZAP scan against a deployed Magpipe-shaped app and emits the artifacts TAC accepts (`.txt`, `.xml`).
2. Default to **staging** scans; **production** scans require explicit `--confirm-prod`.
3. Authenticated scan via ZAP's auth context (form login) — broader coverage than anonymous.
4. Output also includes a markdown triage summary so a human can quickly tell what's a real finding vs. a false positive (the Reddit thread shows ~50% of ZAP findings are arguable as NA).
5. Ship a `.github/workflows/casa-scan.yml.example` template for the annual recert use case.
6. Ship before 2026-07-23.

## Non-goals (V1)

- Scanning Supabase Edge Function endpoints as a separate target (deferred to **V1.1**, tracked as task #13)
- OAuth-flow-aware scanning of Gmail-restricted user paths (deferred to **V2**, tracked as task #14)
- The SAQ Copilot, CWE pre-fix library (deferred — see `README.md` roadmap)
- Multi-framework support (SOC 2, ISO 27001, etc.)
- Hosted/managed service
- Tier 3 assessments

## Decisions log

| # | Question | Decision | Rationale |
|---|---|---|---|
| 1 | First V1 component | **`casa-ready scan <url>`** (ZAP pre-scan kit) | Unblocks SAQ Copilot + pre-fix lib; closest to the artifact TAC actually wants |
| 2 | Scan target strategy | **Single-origin** (e.g., `magpipe.ai`) for V1 | 80% of Reddit failure modes live on the public surface; broader targets deferred |
| 3 | Run location | **Local Docker primary** + opt-in `.github/workflows/casa-scan.yml.example` | Matches Reddit ground truth; cron-friendly for annual recert |
| 4 | Environment model | **Two-target** (`--env staging` / `--env prod`); prod requires `--confirm-prod` | Maps to stripe-cli/vercel/supabase patterns; keeps dev/prod boundary explicit |
| 5 | Auth posture | **Form-based login via ZAP auth context** | Genuine app-surface coverage; pays a coupling cost with Supabase Auth specifics, accepted |
| 6 | Scan flavor | **Both `casa` and `baseline`; default `casa`** | Real product is the CASA-tuned scan; baseline is dev speed shortcut, not the default |
| 7 | Distribution | **npm + npx** (same package.json) | Standard, zero added work, lets users choose |

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                      casa-ready (Node CLI)                       │
│                                                                  │
│  bin/casa-ready.js                                               │
│      │                                                           │
│      ├─ parseArgs (subcommand: scan, future: saq, precheck)      │
│      │                                                           │
│      └─ cli/commands/scan.js                                     │
│             │                                                    │
│             ├─ cli/lib/config.js     (loads casa-ready.config.js)│
│             ├─ cli/lib/zap-context.js (generates auth XML)       │
│             ├─ cli/lib/docker.js     (spawns ZAP container)      │
│             └─ cli/lib/summarize.js  (post-processes JSON→MD)    │
│                                                                  │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                               ▼
              docker run zaproxy/zap-stable
                  zap-full-scan.py
                    -t <env-resolved URL>
                    -c configs/zap/casa-tier2.policy
                    -n /tmp/context.xml
                    -J results.json -x results.xml -r results.html
                               │
                               ▼
              ./scan-output/<env>/<ISO-timestamp>/
                  ├── results.txt    ← TAC submission artifact
                  ├── results.xml
                  ├── results.html   ← human review
                  ├── results.json
                  └── summary.md     ← CASA Ready triage layer
```

## Components

| Path | Purpose |
|---|---|
| `bin/casa-ready.js` | CLI entrypoint; arg parsing via `node:util parseArgs`; routes to subcommands |
| `cli/commands/scan.js` | Orchestrates a single scan invocation end-to-end |
| `cli/lib/config.js` | Loads + validates `casa-ready.config.js`; resolves `--env` to URL |
| `cli/lib/zap-context.js` | Generates ZAP context XML for auth + scope from a Mustache-style template |
| `cli/lib/docker.js` | Thin `child_process.spawn` wrapper around `docker run zaproxy/zap-stable`; tails logs |
| `cli/lib/summarize.js` | Reads ZAP `results.json`, emits `summary.md` (top findings, CWE map, NA candidates) |
| `configs/zap/casa-tier2.policy` | Vendored ADA-mapped scan policy file |
| `configs/zap/context-template.xml` | Mustache template for the per-run auth context XML |
| `.github/workflows/casa-scan.yml.example` | Opt-in CI workflow template for annual recert |

## Configuration

`casa-ready.config.js` at the repo root:

```javascript
export default {
  app: 'magpipe',
  envs: {
    staging: 'https://magpipe-staging-snapsonic.vercel.app',
    prod: 'https://magpipe.ai',
  },
  auth: {
    type: 'form',
    loginUrl: 'https://magpipe-staging-snapsonic.vercel.app/login',
    loginRequestBody: 'email={%username%}&password={%password%}',
    usernameField: 'email',
    passwordField: 'password',
    loggedInIndicator: 'Sign out|/dashboard',
  },
};
```

Credentials read from environment variables only (`CASA_READY_USER`, `CASA_READY_PASS`) — never persisted to config or output.

## Data flow

1. User runs `casa-ready scan` (defaults to staging) or `casa-ready scan --env prod --confirm-prod`.
2. `config.js` loads `casa-ready.config.js`; resolves `--env` to URL; reads auth credentials from env.
3. `zap-context.js` renders `context-template.xml` to `/tmp/casa-ready-context-<run-id>.xml` with login URL + indicator regex.
4. `docker.js` runs `docker run --rm zaproxy/zap-stable zap-full-scan.py …` with mounts:
   - `./configs/zap` → `/zap/configs` (read-only)
   - `./scan-output/<env>/<timestamp>` → `/zap/wrk` (write)
5. ZAP performs the CASA-tuned full scan; container stdout/stderr tailed to terminal.
6. On exit-zero from ZAP, `summarize.js` post-processes `results.json` → `summary.md`.
7. CLI prints a footer: where the artifacts are, which file to upload to TAC, where the human triage summary lives.

## Error handling

| Failure mode | Behavior |
|---|---|
| Docker not installed | Exit 1; print install instructions for macOS/Linux/Windows |
| `--env prod` without `--confirm-prod` | Exit 1; print warning explaining active-scan risk |
| `casa-ready.config.js` missing or invalid | Exit 1; print first validation error with line number |
| Auth env vars missing | Exit 1; print which vars are required |
| Target URL unreachable (DNS/5xx) | Retry once after 3s; on second failure exit 1 with the URL we tried |
| ZAP `loggedInIndicator` regex never matches | Exit 1; print the regex and the response body's first 500 chars |
| ZAP container exits non-zero | Preserve exit code; print last 50 lines of container logs |
| Output directory not writable | Exit 1 *before* docker invocation |
| Successful scan, findings present | **Exit 0**; let the human triage. CI gating is opt-in via `--fail-on <severity>` (deferred to V1.1) |

## Testing strategy

**Unit tests (Vitest):**
- `config.js` — env resolution, validation errors, missing fields
- `zap-context.js` — snapshot test for generated XML against fixtures
- `summarize.js` — snapshot test for markdown output from a captured `results.json` fixture
- `docker.js` — mocked `child_process` to verify command construction

**Integration tests (Vitest, opt-in):**
- One test runs against [`bkimminich/juice-shop`](https://github.com/bkimminich/juice-shop) container in CI; asserts artifact files exist and `summary.md` non-empty. Skipped in local `npm test` unless `RUN_INTEGRATION=1`.

**Manual verification:**
- `casa-ready scan --env staging` against the Vercel staging alias once it's set up
- `casa-ready scan --env prod --confirm-prod` exactly once, in the lead-up to the TAC submission

## Open dependencies (must be resolved before implementation)

1. **Stable Vercel staging alias for Magpipe.** Current URL `magpipe-29sla5r4s-snapsonic.vercel.app` is a per-deployment hash; needs a branch alias (e.g., `magpipe-staging-snapsonic.vercel.app`) or a custom domain (`staging.magpipe.ai`). Tracked separately from CASA Ready work.
2. **The official ADA CASA-tuned ZAP policy file.** Need to download + commit to `configs/zap/casa-tier2.policy`. Source location may have moved (legacy `appdefensealliance-dev/ASA` → current `appdefensealliance/ASA-WG`). To be confirmed during implementation.
3. **A staging test user for Magpipe** with a stable email/password pair. Stored in `.env.local` (already gitignored), surfaced as `CASA_READY_USER` / `CASA_READY_PASS`.

## Cost-of-being-wrong analysis

| Decision | If wrong, what happens? | Mitigation |
|---|---|---|
| 5=B (form auth) | Supabase Auth specifics drift, breaks our auth context | Auth config lives in `casa-ready.config.js` so the user can adjust without code changes |
| Single-origin scan | Misses Edge Function vulns TAC flags | V1.1 in roadmap; user can manually re-run scan against function URL |
| Default exit 0 on findings | CI doesn't gate on findings | `--fail-on <severity>` planned for V1.1 |
| Vendored policy file | Goes stale vs. ADA updates | Document update process; consider `casa-ready update-policy` command later |

## Cut from V1 (explicitly deferred)

- `--fail-on <severity>` for CI gating
- Incremental scans (re-run only on changed routes)
- Multiple concurrent target scans
- Custom report templates beyond the bundled `summary.md`
- Slack/email notification on completion
- Web UI / dashboard

## References

- [Research findings doc](../../research-findings.md) — full context, Reddit thread synthesis, OSS landscape
- [App Defense Alliance ASA-WG (official spec)](https://github.com/appdefensealliance/ASA-WG)
- [CASA Tier 2 tooling matrix](https://appdefensealliance.dev/casa/tier-2/tooling-matrix)
- [daniel.es CASA Tier 2 walkthrough](https://daniel.es/blog/publishing-your-google-cloud-project-app-get-the-casa-tier-2-certification/)
- [DEV: rem4ik4ever — My SaaS passed CASA Tier 2](https://dev.to/rem4ik4ever/my-saas-passed-casa-tier-2-assessment-and-yours-can-to-here-is-how-1b20)
- [OWASP ZAP](https://www.zaproxy.org/) | [`zap-full-scan.py` docs](https://www.zaproxy.org/docs/docker/full-scan/)
