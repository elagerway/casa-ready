# CASA Ready — Project Handoff

**Written:** 2026-06-11. **Reason:** hard-drive swap — this doc is the durable source of truth (the local clone, the `.worktrees/` worktree, and `~/.claude` memory may be lost). Everything you need to resume is here or on GitHub/npm. Nothing critical lives only on the old disk.

---

## 1. Snapshot — where things are right now

| Thing | State |
|---|---|
| **npm `latest`** | `0.5.3` (published, live) |
| **GitHub default branch** | `main` @ `e2d9105` (specs/plans only; the v0.6.0 feature is NOT on main yet) |
| **Open work** | **PR #5** — v0.6.0 oauth-callback rewrite — branch `v0.6.0-impl` @ `942503d`, fully pushed, **NOT merged** |
| **Website** | https://casaready.org — live on Vercel, serving v0.5.2 landing page |
| **Repo** | https://github.com/elagerway/casa-ready (public, MIT) |

There is exactly **one** active workstream: finishing and shipping **v0.6.0** (PR #5). Everything else is done.

---

## 2. Resuming on a fresh machine

```bash
# 1. Clone
git clone https://github.com/elagerway/casa-ready.git
cd casa-ready

# 2. Get the v0.6.0 work (PR #5)
git fetch origin
git checkout v0.6.0-impl     # tracks origin/v0.6.0-impl
npm ci

# 3. Confirm the unit suite is green (228 passed, 4 skipped)
npm test
```

Accounts/tools you'll need to re-auth on the new disk:
- **npm**: `npm login` as `elagerway` (erik@snapsonic.com). 2FA is a **passkey** — publishing is done by running `npm publish` and confirming in the browser with the passkey. There are no authenticator codes. CLI 2FA enrollment is dead (website only). A recovery code also works as `--otp=<code>`.
- **GitHub**: `gh auth login` (user `elagerway`).
- **Vercel**: `vercel login` as `erik-4230` / team `snapsonic` — only needed to redeploy the website.
- **Docker**: NOT currently installed on any machine. Required to run the v0.6.0 release gate (see §3). Install OrbStack (`brew install orbstack`), Colima (`brew install colima docker && colima start`), or Docker Desktop.

---

## 3. THE ONE OPEN TASK — finish & ship v0.6.0 (PR #5)

v0.6.0 rewrites the broken `scan: oauth-callback` flavor. It is fully implemented, unit-tested (228 pass / 4 skip), reviewed (per-task spec+quality reviews + a final holistic review: **READY TO MERGE**), and committed on `v0.6.0-impl`. **It is blocked only on one live integration smoke** that needs Docker.

### Step 1 — Run the integration smoke (the release gate)

Requires a running container engine + juice-shop. From a checkout of `v0.6.0-impl`:

```bash
docker run --rm -d -p 3000:3000 --name juice-shop bkimminich/juice-shop
RUN_INTEGRATION=1 npm run test:integration
```

**What to confirm while it runs:**
1. The test passes (artifacts written, `summary.md` produced).
2. In the juice-shop/ZAP container logs, look for `CASA Ready: seeded GET ...` AND `CASA Ready: seeded POST ...` — this proves both hook branches fire (the POST/`send_request` path has no automated coverage).
3. Inspect the produced `results.json` (path printed in the run output) for at least one **active-scan** alert whose URI carries the seeded callback params.
   - **If active-scan alerts on the seeded params are present → the mechanism works. Done, no code change.**
   - **If only passive/spider alerts appear** → implement the documented fallback: add a `zap_pre_shutdown(zap)` function to `configs/zap/oauth-callback-hook.py` that calls `zap.ascan.scan(seeded_url, recurse=False)` for each seeded node and polls `zap.ascan.status(scan_id)` to 100 before returning. Re-run the smoke. Commit as `fix(zap): drive ascan on seeded callback nodes in zap_pre_shutdown`.

```bash
docker stop juice-shop   # cleanup when done
```

> **Already de-risked statically (2026-06-11):** the ZAP Python client methods the hook uses are confirmed real against `python-owasp-zap-v2.4` — `zap.core.access_url(url, followredirects, apikey)`, `zap.core.send_request(request, followredirects, apikey)`, plus `zap.ascan.scan(...)` / `zap.ascan.status(...)` for the fallback. So the hook won't fail on a bad method name. The smoke's only remaining job is to confirm the seeded params actually get actively scanned (the contingency above).

### Step 2 — Merge, tag, publish (after the smoke passes)

```bash
# Merge PR #5 (rebase merge to preserve the atomic commits)
gh pr merge 5 --rebase

# On the merged main HEAD:
git checkout main && git pull
git tag v0.6.0
git push origin v0.6.0

# Publish (passkey — run it yourself, confirm in browser)
npm publish
# verify:
npm view casa-ready version    # should print 0.6.0
```

The PR description (https://github.com/elagerway/casa-ready/pull/5) repeats this gate.

---

## 4. What v0.6.0 actually changes (reference)

The `oauth-callback` flavor used to fail at active-scan time (`URL_NOT_IN_CONTEXT`) because `zap-api-scan.py` normalizes the active-scan target to the host root — wrong for single-endpoint callback fuzzing. It was EXPERIMENTAL and commented out.

**Now:** the flavor runs `zap-full-scan.py` against the exact callback URL with a custom hook `configs/zap/oauth-callback-hook.py` that seeds the parameterized request(s) into ZAP's Sites tree from a JSON descriptor mounted at `/zap/oauth-callback.json`. ZAP's active scanner then attacks the `callbackParams` as injection points. New capabilities:
- **`method` field** on oauth-callback targets: `GET | POST | [GET, POST]` (default `GET`). POST sends params as `application/x-www-form-urlencoded` (OAuth `response_mode=form_post`).
- **Open-redirect** coverage on `redirect_uri` via ZAP's External Redirect rule (plugin 20019) + new triage rule `configs/casa/rules/external-redirect.md`.
- Removed all synthetic-OpenAPI machinery (`renderOpenApiYaml`, dummy-root-path workaround, `/zap/openapi.yaml` mount).

Design + plan (on `main` and the branch):
- `docs/superpowers/specs/2026-06-11-oauth-callback-active-scan-rewrite-design.md`
- `docs/superpowers/plans/2026-06-11-oauth-callback-active-scan-rewrite.md`

The 11 commits on `v0.6.0-impl` (oldest → newest): schema `method` field → `buildDescriptor` module → flavor rewrite → docker `descriptorPath` → scan.js descriptor wiring → the Python hook → external-redirect rule → docker `descriptorPath` forward → GET+POST smoke → docs → stale-comment fix → version bump.

---

## 5. Durable facts (these were in `~/.claude` memory — preserved here in case that's wiped)

- **npm package `casa-ready`** is owned by `elagerway` / erik@snapsonic.com. The CLI resolves its rules KB at runtime from the package's `configs/casa/rules` (`DEFAULT_RULES_DIR` in `cli/lib/triage/index.js`) — that dir MUST stay in the npm tarball.
- **npm README only refreshes on publish** — if you change README, it won't show on npmjs.com until the next `npm publish`.
- **Website (casaready.org):** Astro app in `website/`. Deployed via CLI (`vercel deploy --prod --yes` from `website/`) to Vercel project `snapsonic/casaready` — **no Git auto-deploy is wired**, so site changes need a manual deploy. **DNS lives at SiteGround nameservers** (NOT Namecheap, despite Namecheap being the registrar — editing Namecheap Advanced DNS is a no-op). Records: `A @ → 216.150.1.1` + `216.150.16.1`; `CNAME www → da9791eb44c96e31.vercel-dns-016.com` (per-domain Vercel value). Generated `*.vercel.app` URLs return 401 (team deployment protection); the custom domain is public.
- **Magpipe CASA submission was abandoned (too expensive).** All Magpipe / "passing CASA for Magpipe" claims were removed from public copy (website, README, CONTRIBUTING, MIGRATION, triage skill) in v0.5.3. **Do not reintroduce them.** Historical mentions in CHANGELOG / internal docs / code comments were intentionally left as records. `tests/fixtures/sample-results.json` still contains `magpipe-staging-…vercel.app` URLs as test data (harmless; anonymize only if desired).

---

## 6. Deferred / intentionally-open items (NOT bugs)

- **Triage `index.js` per-target walk** uses guarded `stat()` (kept symlink-tolerant) rather than `readdir({withFileTypes})`. Leave unless a reason emerges.
- **Dynamic cross-finding reclassification** (e.g. reclassify `X-Frame-Options` to noise when CSP `frame-ancestors` is present) is a future feature, not a cleanup — needs header evidence in `results.json` + a post-classify context pass + rule-declared predicates.
- **Shared YAML wrapper, rationale data-map, `--version` flag** — all DONE in v0.5.2 (no longer open).
- **Optional v0.6.0 hardening** (only if wanted later): the integration smoke asserts artifacts exist but not that the POST branch seeded or that an open-redirect alert fired. A non-flaky upgrade is a structural assertion that `results.json` contains a seeded POST request to the callback URL.

---

## 7. One-line status for whoever picks this up

> v0.5.3 is live on npm and casaready.org is up. The only open work is **PR #5 (v0.6.0 oauth-callback rewrite)** — fully built and unit-green, blocked on one Docker-based integration smoke (§3). Run the smoke → merge → tag → `npm publish` (passkey).
