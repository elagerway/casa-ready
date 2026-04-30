# Changelog

All notable changes to CASA Ready are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
