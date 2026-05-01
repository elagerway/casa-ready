# Contributing to CASA Ready

Thanks for taking a look. CASA Ready is small, focused, and dogfooded against a real CASA submission ([Magpipe](https://magpipe.ai)). Contributions that move the needle on real CASA submissions are very welcome — see the **Where to start** section below for the highest-leverage work.

## What this project is and isn't

**Is:** an opinionated open-source toolkit for the OWASP-ZAP + Supabase corner of CASA Tier 2. Single CLI, single YAML config, single source of truth for the schema.

**Isn't:** a multi-framework compliance platform. If you want SOC 2 / ISO 27001 too, [Probo](https://github.com/getprobo/probo) and [Comp AI](https://github.com/trycompai/comp) are better fits. If you want cloud infra scanning, [Shasta](https://github.com/transilienceai/shasta) is.

## Codebase layout

```
casa-ready/
├── bin/casa-ready.js              ← CLI entrypoint (subcommand routing only)
├── cli/
│   ├── commands/
│   │   ├── scan.js                ← multi-target scan orchestrator
│   │   └── init.js                ← interactive YAML scaffolding
│   └── lib/
│       ├── schema.js              ← Zod schema — SINGLE SOURCE OF TRUTH
│       ├── config.js              ← YAML loader + ${VAR} expansion + validation
│       ├── env-expand.js          ← pure ${VAR} string substitution walker
│       ├── docker.js              ← buildZapArgs + runZap (Docker invocation)
│       ├── zap-context.js         ← XML rendering + origin-scope regex helpers
│       ├── summarize.js           ← ZAP results.json → markdown
│       ├── targets-summary.js     ← top-level multi-target aggregate
│       └── auth/
│           ├── index.js           ← auth.type dispatcher
│           ├── form.js            ← form-auth (HTML POST login)
│           ├── supabase-jwt.js    ← context renderer (delegates login to supabase-login)
│           └── supabase-login.js  ← Node-side Supabase password POST
├── configs/zap/                   ← vendored ZAP context templates + policy
├── schemas/casa-ready.schema.json ← AUTO-GENERATED from cli/lib/schema.js
├── types/index.d.ts               ← AUTO-GENERATED from cli/lib/schema.js
├── scripts/build-schema.js        ← regenerates the two files above
├── tests/                         ← vitest suites + integration smoke
└── website/                       ← Astro source for casaready.org
```

## Local dev setup

```bash
git clone https://github.com/elagerway/casa-ready.git
cd casa-ready
npm install
npm test                                         # 109 tests, ~1s
npm run smoke                                    # CLI --help loads cleanly
```

**Optional, recommended for end-to-end work:**
- Docker Desktop installed and running (the scan path spawns ZAP in a container)
- A juice-shop instance on `host.docker.internal:3000` for the integration smoke (`docker run -p 3000:3000 bkimminich/juice-shop` in another terminal)
- `RUN_INTEGRATION=1 npm run test:integration` runs the end-to-end ZAP scan against juice-shop

## How we work

### TDD by default

Every behavioral change ships with tests. Pattern: write the failing test, run it to see the red, write the minimum code to pass, commit. Look at any of the existing test files for the shape — `tests/lib/auth/supabase-login.test.js` is a representative small one.

### Zod schema is the single source of truth

If you're adding or changing a config field, edit `cli/lib/schema.js` and let everything else flow downstream:
- Runtime validation: automatic via `safeParse` in `cli/lib/config.js`
- JSON Schema (for IDE autocomplete): `npm run build:schema` regenerates `schemas/casa-ready.schema.json`
- TypeScript types: `npm run build:schema` regenerates `types/index.d.ts` (currently hand-curated for discriminated unions; update both together)

Don't add validation logic anywhere else. If you find yourself reaching for an `if (config.foo === undefined)` check, that's a sign the schema needs the constraint instead.

### Adding a new auth type

The path is well-trodden — `supabase-jwt` was added in v0.2.0 and rewritten in v0.2.4. The shape:

1. Add a new `*AuthSchema` to `cli/lib/schema.js` with `.strict()` and a discriminator literal.
2. Add it to the `z.discriminatedUnion('type', […])` array.
3. Create `cli/lib/auth/<your-auth>.js` exporting `getContext({ target, credentials, configsDir, runId, fetchFn? })` that returns `{ contextXml, scriptPath: null, replacerHeaders?: [...] }`.
4. Register it in `cli/lib/auth/index.js`'s `RENDERERS` map.
5. Vendor a context XML template in `configs/zap/` if needed.
6. Add prompts in `cli/commands/init.js`'s `collectTargets` for the new auth type.
7. Add a test file at `tests/lib/auth/<your-auth>.test.js`.
8. Update README + CHANGELOG.

The JSON Schema and TS types regenerate from step 1 — no manual edits to `schemas/` or `types/`.

### Commit style

Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`). Subject under 70 chars. Body explains the *why*, not the *what* — the diff already shows the what. Look at `git log --oneline -20` for the running style; the v0.2.4 and v0.3.0 commits are good examples of body length and tone.

### Pricing claims and other "facts"

If you're adding any specific number to user-facing copy (README, CLI HELP, website, blog), it must trace to a primary source — vendor pricing page, screenshot of a quote, linked Reddit comment with timestamp. "I read it somewhere" doesn't qualify. There's a `⚠️ Sourcing note` in `docs/research-findings.md` flagging the historical "$15K–$40K" claim that propagated unverified for too long; don't repeat that pattern.

## Where to start

Ranked by impact for actual CASA submissions:

1. **V2: authenticated OAuth flow scanning** for Gmail-restricted user paths. The current scan covers the public + simple-auth surface; CASA reviewers will ask about routes that require Google OAuth to reach. Open in Issues as the V2 scope.
2. **Real ADA-tuned ZAP policy file.** Currently using the OWASP Top 10 fallback because the App Defense Alliance distributes its CASA-tuned policy via the [Tier 2 tooling matrix](https://appdefensealliance.dev/casa/tier-2/tooling-matrix), not their public GitHub. Sourcing the official policy and wiring it as the default would be a real upgrade.
3. **Generic JSON-API auth** (`json-script` type) for Auth0 / Firebase / custom backends. The pattern is the same as `supabase-jwt` but parameterized — see `cli/lib/auth/supabase-jwt.js` for the template.
4. **Per-target scan flavor + per-target failure mode** (`required: true|false`). Currently `--scan` applies to all targets and a failed target is best-effort; both could be per-target schema fields.
5. **`casa-ready saq`** — the SAQ Copilot. Drafts answers to the 50+ Self-Assessment Questionnaire from your repo + cloud config. Most-time-saved per CASA submission, but needs real scan output to feed it.
6. **Bugs and DX rough edges.** The container name currently doubles the target segment (`casa-ready-api-api-…`); the runId convention should be reworked. Small, visible, good first PR.

## Reporting bugs

[Open an issue](https://github.com/elagerway/casa-ready/issues) with:
- Version (`casa-ready --version` once that's wired, or check `package.json` for now)
- Your `casa-ready.yml` minus secrets
- The full stdout/stderr from the failing command
- What you expected vs. what you got

If the bug surfaced during a real CASA submission, say so — those get prioritized.

## License

MIT. By contributing you agree your contributions are MIT-licensed.
