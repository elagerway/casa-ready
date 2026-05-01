# V2 — Authenticated OAuth scan + endpoint seeding

**Status:** Brainstormed and approved 2026-05-01. Ready for implementation planning.
**Target version:** `v0.4.0` (minor bump, fully backward-compatible).
**Forcing function:** Magpipe's CASA Tier 2 deadline (2026-07-23). The current `v0.3.1` scan can authenticate against `${SUPABASE_URL}/functions/v1` but can't *find* the 60+ Edge Functions behind it because Supabase has no directory listing. CASA reviewers will ask for evidence that the Gmail-touching endpoints have been scanned. They haven't been.

## Goal

Close two coverage gaps in the current scanner:

1. **Endpoint discovery for authenticated APIs.** ZAP's spider can't enumerate Supabase Edge Functions (or any API behind a directory-listing-less host). Users currently have no way to tell CASA Ready "here's the list of authenticated endpoints to scan."
2. **OAuth callback handler scanning.** The `/auth/google/callback`-style URLs that receive Google's redirect are public, take query parameters (`state`, `code`, `redirect_uri`), and are a common source of vulnerabilities (state-token bypass, code replay, open redirect via `redirect_uri`, info leaks in error responses). The current scan flavors (`baseline`, `casa`) don't actively probe parameter mutations.

## What we explicitly are NOT doing

These came up during brainstorming and were intentionally cut:

- **Browser automation / Playwright session replay.** The CHANGELOG's V2 framing ("session replay + OAuth flows") implied driving a real Chrome through the Sign-in-with-Google dance. Investigation showed Magpipe doesn't need this — its OAuth flow produces a Supabase JWT (which the existing `supabase-jwt` auth path covers) and stores Gmail access tokens server-side (the endpoints that USE them just take a regular Bearer header). Browser automation would be necessary only if the app required an active OAuth browser session to access endpoints. No external customer has been identified with that need either; we're not designing for speculation.
- **Per-target `casa`/`baseline` flavor.** Listed as a deferred V1.2 limitation. Only `oauth-callback` is added as a per-target flavor in V2. Generalized per-target flavors can come in v0.4.1 — the architecture supports it.
- **OpenAPI import.** Different feature. Users with OpenAPI specs can derive a `seedUrls` list themselves.
- **Real ADA-tuned ZAP policy file.** Still using the OWASP Top 10 fallback. Carries forward; sourcing the official policy is its own initiative.
- **Mock OAuth provider for the callback scan.** The `callbackParams` are fuzz inputs, not valid Google credentials. ZAP's active scanner mutates the values to find vulnerabilities; it doesn't need them to be acceptable to the app's logic. Apps that want a deeper "happy path" callback test should write that as an app-side integration test.

## User-facing changes

All additions are optional and backward-compatible. Existing `casa-ready.yml` files continue to work unchanged.

### Schema additions (`cli/lib/schema.js`)

Three new optional fields on `TargetSchema`:

| Field | Type | Purpose |
|---|---|---|
| `seedUrls` | `string[]` | Explicit URLs fed to ZAP's spider as additional starting points (in addition to `target.url`). |
| `seedDir` | `string` (path) | Supabase-aware shortcut. Globs subdirectories of this path; appends each subdir name to `target.url`. For Magpipe: `seedDir: ./supabase/functions` covers all Edge Functions in one line. |
| `scan` | `'casa' \| 'baseline' \| 'oauth-callback'` | Per-target scan flavor override. Currently only `oauth-callback` triggers different behavior; the others fall through to the global `--scan` flag for backward compat. |

One new sub-schema for OAuth callback targets:

| Field | Type | Purpose |
|---|---|---|
| `callbackParams` | `Record<string, string>` | Required when `scan: oauth-callback`. Query params used as fuzz starting input. Values do NOT need to be valid Google credentials. |

One addition to `AuthSchema`'s discriminated union:

```javascript
const NoAuthSchema = z.object({ type: z.literal('none') }).strict();
```

For genuinely public endpoints (callback handlers, marketing pages). Skips Node-side login and skips replacer headers.

### Schema cross-field constraints (Zod `superRefine`)

- `scan: oauth-callback` requires `callbackParams` (non-empty)
- `scan: oauth-callback` requires `auth.type: none` (the callback is always public-fronted)
- `seedDir` and `seedUrls` may both be present; results are concatenated and deduped

### Example YAML

```yaml
app: magpipe

envs:
  prod:
    targets:
      # Existing supabase-jwt target, now seeded with all Edge Functions.
      - name: api
        url: https://x.supabase.co/functions/v1
        auth:
          type: supabase-jwt
          loginUrl: https://x.supabase.co/auth/v1/token?grant_type=password
          apiKey: ${SUPABASE_ANON_KEY}
        # NEW: glob ./supabase/functions/*/ → seed each as ${url}/{subdir}.
        seedDir: ./supabase/functions
        # NEW: optional explicit additions (e.g. routes outside /supabase/functions/).
        seedUrls:
          - /functions/v1/legacy-endpoint

      # NEW target type: OAuth callback active scan.
      - name: oauth-callback
        url: https://magpipe.ai/auth/google/callback
        auth:
          type: none
        scan: oauth-callback
        callbackParams:
          state: test-state-token
          code: test-authorization-code
          redirect_uri: https://magpipe.ai/dashboard
```

## Internal architecture

### Module layout

```
cli/
├── lib/
│   ├── schema.js                  ← MODIFY: add seedUrls, seedDir, NoAuthSchema, scan, callbackParams + cross-field rules
│   ├── seed-urls.js               ← NEW (pure): resolveSeedUrls(target, cwd) → string[]
│   ├── docker.js                  ← MODIFY: buildZapArgs delegates to scan-flavor adapter; mounts hook file when seeds present
│   ├── auth/
│   │   ├── index.js               ← MODIFY: add 'none' to RENDERERS dispatcher
│   │   └── none.js                ← NEW: getContext returns scope-only XML, no headers
│   └── scan-flavors/              ← NEW: per-flavor argv adapters
│       ├── index.js               ← dispatcher (matches auth/index.js pattern)
│       ├── baseline.js            ← extracted from current docker.js (zap-baseline.py)
│       ├── casa.js                ← extracted (zap-full-scan.py)
│       └── oauth-callback.js      ← NEW (zap-api-scan.py with callbackParams as inputs)
└── commands/
    └── scan.js                    ← MODIFY: pass per-target flavor + resolved seed URLs through

configs/zap/
├── none-context-template.xml      ← NEW: scope-only context (no auth blocks)
└── seed-spider-hook.py            ← NEW: Python hook reading seed URLs from a mounted file, calling zap.spider.scan per URL
```

### Data flow per target

```
for each target in env:

  1. resolveSeedUrls(target, cwd)
     - Globs target.seedDir if present (subdirectories only)
     - Concats with target.seedUrls
     - Prefixes relative URLs with target.url
     - Dedupes
     → ['<target.url>',
        '<target.url>/gmail-inbox',
        '<target.url>/gmail-send', …]

  2. authDispatcher.getContext(target)
     → form / supabase-jwt / none — returns { contextXml, replacerHeaders }

  3. flavor = target.scan ?? opts.flavor   // per-target override of --scan

  4. scanFlavors[flavor].buildArgs({ contextPath, replacerHeaders, seedUrls,
                                     callbackParams, … })
     → docker argv:
        baseline: ['run', ..., 'zaproxy/zap-stable', 'zap-baseline.py', '-t', url,
                   '-n', context, ..., '--hook', '/zap/configs/seed-spider-hook.py']
        casa:     same shape, zap-full-scan.py
        oauth-callback:
                  ['run', ..., '-v', '<temp synthetic OpenAPI YAML>:/zap/wrk/openapi.yaml:ro',
                   'zaproxy/zap-stable', 'zap-api-scan.py',
                   '-t', '/zap/wrk/openapi.yaml',
                   '-f', 'openapi', ...]

  5. runZap(args)
  6. summarize, write per-target outputs
```

### Spider seeding mechanism

`zap-baseline.py` and `zap-full-scan.py` hardcode `zap.spider.scan(target_url)` once. They do not expose extra seed URLs as a CLI flag. Two paths:

1. ZAP daemon `-config` flags — investigated, ZAP doesn't read `spider.seedUrls` from config.
2. **`--hook` file** with a `zap_started_handler(zap, target)` that reads extra seeds from a mounted file and calls `zap.spider.scan(URL)` per entry. This works.

V2 ships `configs/zap/seed-spider-hook.py` that:
- Reads from `/zap/configs/seed-urls.txt` (one URL per line, mounted by the orchestrator)
- For each, calls `zap.spider.scan(url, contextname=<context>)`
- No-op if the file is empty or missing (so existing scans without seed URLs are unaffected)

The orchestrator writes `seed-urls.txt` to a temp directory alongside `context.xml`, mounts both into the container.

### `oauth-callback` flavor mechanics

`zap-api-scan.py` is ZAP's wrapper for active-scanning APIs from an OpenAPI/SOAP/GraphQL spec. We're not feeding it a real spec — instead, we feed it a synthetic single-endpoint OpenAPI document generated from `callbackParams`:

```yaml
openapi: 3.0.0
info: { title: oauth-callback, version: '1' }
paths:
  /auth/google/callback:
    get:
      parameters:
        - { name: state, in: query, required: true, schema: { type: string }, example: test-state-token }
        - { name: code, in: query, required: true, schema: { type: string }, example: test-authorization-code }
        - { name: redirect_uri, in: query, required: true, schema: { type: string }, example: https://... }
      responses: { '200': { description: ok } }
```

The orchestrator generates this OpenAPI YAML to a temp file, mounts it, points `zap-api-scan.py -t <openapi_file> -f openapi`. ZAP reads the example values, then its active scanner mutates them looking for vulnerabilities.

### Refactor: extract scan flavors

`cli/lib/docker.js`'s `buildZapArgs` is currently 130 lines and branches on `flavor` inside. Adding a third flavor with materially different ZAP CLI invocation (`zap-api-scan.py` vs `zap-baseline.py`, different required args, OpenAPI generation, different output naming) tips it past readable.

Extract `cli/lib/scan-flavors/{baseline,casa,oauth-callback}.js` — each owns its argv-construction logic. `buildZapArgs` becomes orchestration-only: resolve flavor → call `scanFlavors[flavor].buildArgs(opts)` → return argv. Same dispatcher pattern as `cli/lib/auth/`.

This is a targeted refactor (file we're already modifying, complexity tipping point), not opportunistic cleanup.

## Error handling

| Condition | Behavior |
|---|---|
| `seedDir` path doesn't exist | Throw with the resolved absolute path |
| `seedDir` glob returns 0 entries | Warn (not throw) — directory might be empty in early dev. Fall back to `seedUrls` only. |
| `scan: oauth-callback` without `callbackParams` | Schema rejects via Zod `superRefine` |
| `scan: oauth-callback` with `auth.type !== 'none'` | Schema rejects (callback always public-fronted) |
| `seedUrls` contains a URL not on the same origin as `target.url` | Warn (not throw) — ZAP's `<incregexes>` will exclude it from the in-scope crawl, but having it as a seed is still useful for the request log |
| Hook file fails to load inside ZAP | ZAP logs the error; scan continues (target.url is still spidered). Surfaced in the per-target summary. |

## Testing strategy

| Module | Tests | Approx. count |
|---|---|---|
| `cli/lib/seed-urls.js` | Pure module, full coverage — globs nonexistent dir, empty dir (warn), seedUrls-only, seedDir-only, both, dedup, prefix-with-slash handling, absolute vs relative URL handling | 8-10 |
| `cli/lib/auth/none.js` | Returns scope-only XML (no `<authentication>`, `<users>`, `<session>`), no `replacerHeaders`, no `scriptPath`. Mirror existing form/supabase-jwt test shape. | 3-4 |
| `cli/lib/scan-flavors/*.js` | Per-flavor argv assertion. `oauth-callback` test verifies `zap-api-scan.py` is invoked with the right OpenAPI mount and that `callbackParams` flow into the synthetic spec. | 6-8 (2-3 per flavor) |
| `cli/lib/schema.js` | New cases — `seedUrls`/`seedDir` accepted, `auth.type: none` accepted, `scan: oauth-callback` requires `callbackParams`, `scan: oauth-callback` rejects `auth.type !== 'none'`, dedup invariants | 6-8 |
| `cli/lib/docker.js` | Update existing tests for the new flavor-dispatch shape. Add a test that hook file gets mounted when seeds are present. | 3-4 |
| `cli/commands/scan.js` | Existing tests stay. Add one that exercises a multi-target run with mixed flavors (supabase-jwt + oauth-callback). | 1-2 |
| Integration smoke | Add a `juice-shop oauth-callback` smoke target hitting `/rest/user/login` with fake state/code params (juice-shop accepts random params and returns useful errors — proves zap-api-scan + active-scan flow works end-to-end). | 1 |

Suite goes from ~109 tests to ~135-140.

## Documentation deltas

- **`README.md`** — new "OAuth callback scanning" mini-section under "What you get", with the YAML example. Update the V2 row in the Roadmap table to "✓ Shipped 2026-05-XX in `v0.4.0`".
- **`casa-ready.yml.example`** — add a third target showing the OAuth callback pattern with comments about `callbackParams` being fuzz inputs (not valid Google creds), and a comment showing the `seedDir` Supabase shortcut.
- **`MIGRATION.md`** — short "v0.3.x → v0.4.0" section. No breaking changes (everything additive). Highlight the `seedDir` one-liner for Supabase users.
- **`CHANGELOG.md`** — `[0.4.0]` entry. Added section covers all the user-facing additions; no Changed/Removed.
- **`CONTRIBUTING.md`** — update "how to add a new auth type" to mention the new `cli/lib/scan-flavors/` extension point. Document how to add a new flavor with the same pattern.
- **Website (`website/src/pages/index.astro`)** — update the V2 row in the roadmap table to ✓. Add a feature card for "OAuth callback scanning" in the features grid.

## Release shape

- Ships as `v0.4.0` (minor — additive features, fully backward-compatible)
- Implementation in a `v0.4.0-impl` worktree off main (per `superpowers:using-git-worktrees`)
- Atomic commits per task (mirrors V1.2 pattern that worked well)
- Subagent-driven OR inline TDD execution; recommend inline given session momentum, like V1.2 Tasks 3-11
- Single PR off main, rebase merge to preserve atomic commits
- Tag `v0.4.0` on the post-merge `main` HEAD; push tag
- Re-publish to npm with the existing bypass-2FA token

## Estimated effort

- ~10-12 implementation tasks for the plan
- ~3-4 days end-to-end including dogfood against Magpipe
- Dogfood validation: re-run the Magpipe scan with all 60+ Edge Functions seeded plus the OAuth callback as a target. Successful coverage proves V2 works end-to-end. Any new vulnerabilities surfaced are CASA-submission gold (most valuable possible outcome).

## Open questions

None remaining. All design forks resolved during brainstorming:

- ✅ V2 covers Edge Functions AND OAuth callback (user picked option C)
- ✅ Seed mechanism: `seedDir` Supabase shortcut + `seedUrls` explicit list
- ✅ `auth.type: none` for public endpoints
- ✅ `callbackParams` are fuzz inputs, not valid Google creds
- ✅ Per-target `scan` flavor (only `oauth-callback` initially)
- ✅ Extract `cli/lib/scan-flavors/` as part of V2 (refactor justified by complexity tipping point)
- ✅ Hook-file approach for spider seeding (only viable mechanism)
- ✅ No browser automation, no OpenAPI import, no real-token OAuth dance — explicitly out of scope
