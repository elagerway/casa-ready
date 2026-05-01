# Changelog

All notable changes to CASA Ready are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.2] — 2026-05-01

### Fixed
- **`oauth-callback` flavor mount path conflict — same bug class as v0.4.1's seed-file fix.** `oauth-callback.js` mounted the synthetic OpenAPI doc at `/zap/wrk/openapi.yaml`, but `/zap/wrk` is already bind-mounted from `outputDir`. Docker Desktop's virtiofs on macOS can't nest a file mount inside an existing directory mount — fails at runtime with `mountpoint ... is outside of rootfs`. Surfaced by the V2 dogfood scan against Magpipe with 4 oauth-callback targets (all 4 failed to start). Moved to `/zap/openapi.yaml` (root level, no parent-mount conflict). Added a defensive regression test that asserts the mount path is NOT inside `/zap/wrk/`.

### Notes
- Both v0.4.0's seed-file mount and v0.4.1's OpenAPI mount were the same kind of mistake: putting a file mount inside a directory mount that's already bind-mounted from the host. After v0.4.2 all single-file mounts (`/zap/context.xml`, `/zap/seed-urls.txt`, `/zap/openapi.yaml`) live at the `/zap/` root, away from the directory mounts (`/zap/configs`, `/zap/wrk`).
- This is the second hotfix in two hours — both surfaced by the same Magpipe dogfood and both invisible to the unit test suite (which doesn't exercise actual `docker run` mount semantics). The two regression tests added in v0.4.1 + v0.4.2 close those specific gaps; the broader lesson (mount-path conflicts need integration coverage) is tracked for v0.5+.

## [0.4.1] — 2026-05-01

### Fixed
- **`seedDir`/`seedUrls` were broken in production: Docker rejected the seed-file mount with `read-only file system`.** `_common.js` mounted the temp seed file at `/zap/configs/seed-urls.txt`, but `/zap/configs` is mounted `:ro` — Docker can't make a mountpoint inside a read-only mount. Surfaced by the V2 dogfood scan against Magpipe (entire scan failed on first run with seedDir enabled). Moved the mount path to `/zap/seed-urls.txt` (root level, no parent-mount conflict). Updated `configs/zap/seed-spider-hook.py` to read from the new path. Added a regression test that asserts the seed mount path is NOT inside `/zap/configs/`.
- **CLI now reports accurate scan status.** `bin/casa-ready.js` printed `✓ Scan complete.` unconditionally, even when all targets failed. Now branches on `result.failures.length`: `✓ Scan complete (N/N targets succeeded)`, `⚠ Scan partial`, or `✗ Scan failed: 0/N targets succeeded`. The TAC submission hint only appears on full success; partial/failed runs point at the summary file for triage instead.

### Notes
- v0.4.0 was technically still installable but its headline feature (endpoint seeding) couldn't run any scan against a non-trivial config. v0.4.1 is the version that actually works for V2.
- This is exactly the "dogfood-then-patch" pattern that surfaced the v0.2.4 silent-failure bug — unit tests passed because no test exercised the actual `docker run` mount semantics. The new regression test (`/zap/configs/` exclusion check) closes that specific gap.

## [0.4.0] — 2026-05-XX

### Added
- **Endpoint seeding (`seedUrls` + `seedDir`).** ZAP's spider can't enumerate authenticated APIs that have no directory listing (Supabase Edge Functions, most gateways). New target fields let users specify additional seed URLs explicitly (`seedUrls: [...]`) or via a Supabase-aware shortcut that globs `./supabase/functions/` and appends each subdir to `target.url` (`seedDir: ./supabase/functions`). For Magpipe: one line covers 60+ Edge Functions.
- **OAuth callback active scanning (`scan: oauth-callback`).** New per-target scan flavor wires `zap-api-scan.py` against a synthetic single-endpoint OpenAPI doc generated from `callbackParams`. ZAP's active scanner mutates the parameter values looking for SQL injection in `state`/`code`, XSS in error messages, open-redirect via `redirect_uri`, info leaks. Values are fuzz inputs — they don't need to be valid Google credentials.
- **`auth.type: none`** for genuinely public endpoints (callback handlers, marketing pages). Skips Node-side login and skips replacer headers.
- **`cli/lib/seed-urls.js`** — pure resolver for the seed URL list. Handles dedup, path-vs-URL prefixing, dotfile/underscore-prefixed dir skipping (Supabase `_shared` convention).
- **`configs/zap/seed-spider-hook.py`** — Python `--hook` that reads `/zap/configs/seed-urls.txt` (mounted by the orchestrator) and calls `zap.spider.scan` per URL. The only viable mechanism — `zap-baseline.py` and `zap-full-scan.py` hardcode a single seed and ZAP daemon doesn't expose seed URLs as a CLI flag.

### Changed
- **`cli/lib/scan-flavors/` extracted from `cli/lib/docker.js`.** `buildZapArgs` was hitting its complexity tipping point at 170 lines with three different ZAP wrapper scripts to dispatch to. New per-flavor adapters (`baseline.js`, `casa.js`, `oauth-callback.js`) each own their argv construction; `buildZapArgs` becomes orchestration-only. Same dispatcher pattern as `cli/lib/auth/`. No behavior change to baseline/casa flavors.

### Notes
- Fully backward-compatible. All v0.3.x configs work unchanged.
- Architecture rationale: the original V2 framing in the v0.2.0 CHANGELOG implied browser-driven session replay (Playwright) for OAuth flows. Investigation showed Magpipe's auth produces a Supabase JWT (already covered by the supabase-jwt path) and stores Gmail tokens server-side (endpoints that use them just take a regular Bearer header). The actual gap was **discovery** of the endpoints, not a different auth mechanism. Browser automation is deferred until a real customer needs it.
- Discovery still has limits: `seedDir` works for any directory-per-endpoint convention. Apps with a different layout (e.g. all routes in one file) need explicit `seedUrls`. OpenAPI import is a future addition.

### Deferred / known limitations
- General per-target scan flavor for `casa`/`baseline` (currently only `oauth-callback` is per-target; `casa`/`baseline` fall through to `--scan`) — v0.4.1.
- OpenAPI import — different feature; users with OpenAPI specs can derive `seedUrls` from them.
- Real ADA-tuned ZAP policy file — still using OWASP Top 10 fallback. Carries forward.
- Browser-driven session replay — out of scope until a real customer needs it.

## [0.3.1] — 2026-05-01

### Fixed
- **`runScan` default `configPath` was still `casa-ready.config.js`** (the v0.2.x filename), so users who ran `casa-ready scan` without `--config` got `Invalid YAML` errors when js-yaml choked on the JS source — instead of the v0.3.0 migration error pointing at `casa-ready init`. Now defaults to `casa-ready.yml`, matching the documented behavior in `--help`. Surfaced by the first real Magpipe dogfood with v0.3.0. Added a regression test (`tests/commands/scan.test.js`: "defaults configPath to ./casa-ready.yml") that exercises the un-injected default.

## [0.3.0] — 2026-05-01

### Added
- **YAML config (`casa-ready.yml`)** replaces the legacy JS module. Statically inspectable, supports comments, matches the OWASP/CASA toolchain norm — and avoids the security review that arbitrary-JS configs trigger at most companies.
- **`casa-ready init`** — interactive prompts that scaffold a valid `casa-ready.yml`. External customers no longer need to read the schema before getting started. Per-target prompts branch on auth.type (form vs supabase-jwt), pre-fill sensible defaults, and use `${VAR}` env-var indirection so anon keys never land in the YAML.
- **`${VAR_NAME}` env-var expansion** in YAML values (recursive, walks objects + arrays). Throws on missing var with the dotted path that referenced it (`envs.staging.targets.0.auth.apiKey`).
- **JSON Schema** published in the package (`schemas/casa-ready.schema.json`) and generated from the Zod source on every `prepublishOnly`. The `# yaml-language-server: $schema=…` directive at the top of generated YAML configs enables inline autocomplete + validation in VS Code's YAML extension.
- **TypeScript types** exported (`types/index.d.ts`) for programmatic Node users: `import type { CasaReadyConfig } from 'casa-ready'`.
- **Zod schema as single source of truth** — `cli/lib/schema.js` drives runtime validation, JSON Schema export, and TypeScript type emission. Previously, validation was a hand-rolled cascade in `config.js`.
- **Named containers** — every ZAP container is now spawned with `--name casa-ready-<target>-<runId>` and the name is printed to stdout. Find the running scan in Docker Desktop's Containers tab without guessing.
- **`MIGRATION.md`** with a full v0.2.x → v0.3.0 side-by-side translation.

### Changed
- **BREAKING:** config format. `casa-ready.config.js` is no longer read; v0.3 looks for `casa-ready.yml`. Detected legacy `.js` configs produce a migration error pointing at `casa-ready init` and `MIGRATION.md` rather than the generic not-found message. See [README](./README.md) and [MIGRATION.md](./MIGRATION.md) for the side-by-side.
- Validation moved from a hand-rolled cascade in `config.js` to Zod schemas with structured issues. Error messages now name the dotted path of the failing field (e.g. `envs.staging.targets.0.auth.loginUrl: url must start with http:// or https://`).
- `package.json` gained a `"files"` allowlist so the published npm package only includes runtime artifacts (no tests, no scan-output, no .worktrees).
- `SupabaseJwtAuthSchema.refreshSeconds` is now `.optional()` with no `.default(3300)`. The field has been a no-op since v0.2.4 (the new auth path doesn't poll); auto-injecting a value made YAMLs misleadingly include something with no semantics. Old v0.2.x YAMLs that explicitly set `refreshSeconds` still validate.

### Deferred / known limitations
- Per-target scan flavor (currently `--scan` applies to all targets) — v0.3.1.
- Per-target failure mode (`required: true|false`) — v0.3.1.
- Generic `json-script` auth (Auth0, Firebase, etc.) — v0.4.
- Real ADA-tuned ZAP policy file (still using OWASP Top 10 fallback) — carries forward.
- OAuth-flow scanning — V2.

## [0.2.4] — 2026-04-30

### Fixed
- **`supabase-jwt` auth was silently broken since v0.2.0.** The legacy approach used ZAP's script-based authentication (`<authentication type=4>`) with the JWT login script registered via `-z 'script.load(...)'`. Two latent bugs combined: (1) `zap-baseline.py` `shlex.split`s the `-z` value and appends each token as a CLI arg to the ZAP daemon — `script.load(...)` is not a valid daemon flag, so the script never registered; (2) even if it had, `zap_import_context()` runs BEFORE any `-z` config, so the context's `<script>` reference would always be unresolved. Result: every supabase-jwt scan logged `Failed to load context file /zap/context.xml : internal_error` and crawled completely unauthenticated. The juice-shop dogfood missed it because juice-shop is open — the spider succeeded regardless. Surfaced by the first real Magpipe scan against `${SUPABASE_URL}/functions/v1`: only 6 URLs found, all returning 401.

### Changed
- **`supabase-jwt` auth now does the Supabase login from Node**, then injects the resulting JWT and the anon `apikey` into every in-scope ZAP request via the replacer addon (`-z -config replacer.full_list(N)...`). The `<authentication>`, `<users>`, `<forceduser>`, `<session>`, and `<authorization>` blocks are gone from `supabase-jwt-context-template.xml` — the context now defines scope only. Auth fails fast in Node with an actionable error if creds/keys are wrong, instead of failing silently mid-scan. Validated end-to-end against Magpipe prod: `/functions/v1` now returns 404 (was 401), confirming the headers flow.
- `cli/lib/docker.js` `buildZapArgs` accepts a new optional `replacerHeaders: [{ name, value }]` and emits the matching `-z -config replacer.full_list(N).matchstr=… replacement=…` flags. Values containing spaces (e.g. `Bearer <jwt>`) are single-quoted so `shlex.split` keeps them as one token. The legacy `scriptPath` parameter is preserved on the function signature for the dispatcher contract but no longer drives any `-z` output.

### Added
- `cli/lib/auth/supabase-login.js`: pure Node `loginToSupabase({ loginUrl, apiKey, username, password, fetchFn })`. 5 unit tests covering the success path, 400 (bad creds with `error_description` surfaced), missing `access_token`, non-JSON response, and network errors (which now name the host so URL typos are easy to spot).

### Removed
- `configs/zap/supabase-jwt-script.js` — the Nashorn auth script is no longer used.

### Notes
- Architecture rationale: pulling auth into Node eliminates the Nashorn JS dependency and gives V1.2's `init` UX a clean place to validate creds upfront. The static-Bearer approach has a 1-hour expiry window — fine for baseline/full scans (which finish in minutes); long scans would need re-injection (deferred to V1.3+).
- Discovery is unchanged: ZAP's spider still can't enumerate Edge Function paths from `/functions/v1` since Supabase has no directory listing. Authenticated scans of specific function endpoints work; broad discovery requires an OpenAPI/seed-URL feature (V1.3 concern).

## [0.2.3] — 2026-04-30

### Fixed
- **`deriveOriginScope` now matches bare-host URLs.** v0.2.2 produced `^<scheme>://<host>/.*` which required a path — so a target with `url: 'https://magpipe.ai'` (no path) was rejected by ZAP's spider with `URL_NOT_IN_CONTEXT`. Now produces `^<scheme>://<host>(/.*)?$` — path is optional, so bare-host URLs and pathful URLs both resolve. End-anchored to prevent host smuggling (`magpipe.aievil.com`-style suffixes).
- Added two new `deriveOriginScope` tests: bare-host URLs (`https://magpipe.ai`) match correctly; host-smuggling attempts are rejected.

### Notes
- Surfaced by the v0.2.2 dogfood rerun: juice-shop's bare-host frontend target then failed (where v0.2.1's frontend had succeeded only because the broken `{{targetUrl}}.*` happened to be permissive). Two consecutive dogfood iterations caught two related-but-distinct regex bugs — exactly what dogfood-then-patch is for.

## [0.2.2] — 2026-04-30

### Fixed
- **Both context templates now use an origin-scoped includregex.** Previously `<incregexes>{{targetUrl}}.*</incregexes>` produced patterns like `https://x.supabase.co/functions/v1.*` — which excluded the loginUrl path `/auth/v1/token`. ZAP's spider then rejected the seed URL with `URL_NOT_IN_CONTEXT (url)` → `ScanNotStartedException`. Now uses `{{originScope}}` which produces `^https://x\.supabase\.co/.*` — the whole origin host is in scope, so cross-path loginUrls resolve cleanly. Surfaced by the v0.2.1 dogfood scan: juice-shop's `api` target failed for exactly this reason; would have hard-blocked Magpipe's supabase-jwt API target (loginUrl on `/auth/v1/`, target on `/functions/v1`).

### Added
- `cli/lib/zap-context.js` exports `deriveOriginScope(url)` — pure helper for converting any URL to a ZAP-safe origin-anchored regex with metachars escaped. 5 unit tests.

## [0.2.1] — 2026-04-30

### Fixed
- **`runZap` now treats ZAP exit codes 0–3 as success.** ZAP exits 1, 2, or 3 when it FINDS vulnerabilities (1=errors, 2=warnings, 3=both) — that's the success path for any real scan. V1 + V1.1 rejected on any non-zero exit, marking every realistic scan as a failure. Surfaced by the V1.1 dogfood scan against juice-shop (both targets exited 3 = real findings → marked failed). Now resolves `{ exitCode: code }`. Only exit 4+ or signal-kill rejects.
- **Removed `-c /zap/configs/casa-tier2.policy` from the docker invocation.** The vendored fallback policy file is XML (the format ZAP GUI exports), but `zap-baseline.py` / `zap-full-scan.py`'s `-c` flag wants a tab-separated config. ZAP silently fell back to built-in defaults the entire time and logged `Failed to load config file ... Unexpected number of tokens on line` on every scan. Now omits `-c` until a real ADA-tuned TSV policy is sourced — same effective behavior, no spurious warning.

### Notes
- Both bugs were V1 carry-over (shipped in v0.1.0); the V1.1 dogfood scan against juice-shop is what surfaced them in 42 seconds. The V1 smoke test only asserted artifact files exist, not their contents — too lenient to catch either.
- `configs/zap/casa-tier2.policy` is preserved as a placeholder for the V1.2 real-ADA-policy work; just not loaded.

## [0.2.0] — 2026-04-29

### Added
- Multi-target scanning: each env now has a `targets[]` array. One `casa-ready scan` invocation walks all targets sequentially.
- `--target <name>` CLI flag to scope a scan to one configured target.
- New auth type `supabase-jwt` for JSON-body Supabase Auth, using ZAP's script-based authentication (type=4) with periodic JWT refresh.
- Vendored ZAP auth script at `configs/zap/supabase-jwt-script.js`.
- Top-level aggregated `summary.md` + `results.txt` combining all per-target outputs into one TAC-ready bundle.
- Best-effort failure semantics: a failed target is reported in the summary; remaining targets still scan; exit code is non-zero only if any target failed.

### Changed
- **BREAKING:** config schema. `envs.<name>` was a URL string + a separate `auth` block; it's now `envs.<name>.targets[]` with per-target `url` and `auth`. See README "Migrating from v0.1.0 → v0.2.0" for the side-by-side.
- Renamed `configs/zap/context-template.xml` → `configs/zap/form-context-template.xml` to make room for `supabase-jwt-context-template.xml`.
- `summarize()` accepts an optional `{ targetName }` to tag the heading.
- Output layout: `scan-output/<env>/<ts>/<target>/` per-target subdirs + a top-level `summary.md`.

### Deferred / known limitations
- Generic `json-script` auth (for Auth0, Firebase, etc.) — V1.2.
- Per-target scan flavor (currently `--scan` applies to all targets) — V1.2.
- Per-target failure mode (`required: true|false`) — V1.2.
- Plugin architecture for auth providers — V1.3+.
- OAuth-flow scanning (Gmail-restricted user paths) — V2.
- Real ADA-tuned ZAP policy file (still using OWASP Top 10 fallback).

## [0.1.0] — 2026-04-29

### Added
- Initial V1 release: `casa-ready scan` with OWASP ZAP via Docker, form-based auth, two-target environment safety model (`--env staging` / `--env prod --confirm-prod`), markdown triage summary with "Likely NA" CDN heuristic.
- Vendored OWASP Top 10 fallback ZAP policy (real ADA-tuned policy is V1.1+ work).
- 43 unit tests + 1 gated integration smoke (juice-shop).
- Opt-in `.github/workflows/casa-scan.yml.example` for annual recert.
