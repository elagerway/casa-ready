# V2.1 — OAuth callback active-scan rewrite

**Status:** Brainstormed and approved 2026-06-11. Ready for implementation planning.
**Target version:** `v0.6.0` (minor bump, fully backward-compatible).
**Driver:** OSS completeness/credibility. The `scan: oauth-callback` flavor shipped in v0.4.0 but is currently **broken** (fails at active-scan time with `URL_NOT_IN_CONTEXT`), marked EXPERIMENTAL, and commented out in `casa-ready.yml.example`. A broken, experimental, commented-out feature is a wart on a public toolkit. This rewrite makes it actually work and removes the experimental status. (The original V2 forcing function — Magpipe's CASA deadline — no longer applies; validation is against juice-shop, not a real-world dogfood.)

## Problem

`zap-api-scan.py` is ZAP's wrapper for whole-API scans driven by an OpenAPI/SOAP/GraphQL spec. The v0.4.0 `oauth-callback` flavor abused it to fuzz a single callback endpoint by synthesizing a one-path OpenAPI doc from `callbackParams`. Three hotfixes (v0.4.1–v0.4.3) peeled back shallower integration bugs (seed-file mount path, virtiofs nested-mount, host-root dummy path), but the deepest problem is architectural and unfixable from outside the wrapper:

`zap-api-scan.py` **normalizes the active-scan target to the host root** (`target = target[0:target.index('/', 8)+1]`) before calling `zap.ascan.scan(target, recurse=True, contextid=...)`, and requires every scanned URL to already be in the imported context's message tree. For a single-endpoint callback fuzz, that is the wrong shape: the v0.4.3 "add a dummy `/` path to the synthetic OpenAPI" workaround got the host root into the tree but the active scan still doesn't reliably attack the specific callback path's parameters.

The fix abandons `zap-api-scan.py` entirely.

## Goal

Make `scan: oauth-callback` actively scan the **exact** callback URL, with its declared parameters as injection points, for both `GET` (query string) and `POST` (`application/x-www-form-urlencoded` body, i.e. OAuth `response_mode=form_post`) callbacks — and surface an open-redirect finding on `redirect_uri`-style params through the normal triage pipeline.

## Approach (decided)

**Custom `--hook` on `zap-full-scan.py`.** Keep the proven wrapper-plus-hook architecture used by `baseline`/`casa`/`seed-spider-hook.py`. A new `oauth-callback-hook.py` runs at `zap_started`, reads a mounted JSON descriptor, and **seeds the parameterized request(s) into ZAP's Sites tree** (a GET with params as query string and/or a POST with params as a form body). `zap-full-scan.py` then owns the active-scan lifecycle (spider → active scan → wait → write `results.json`). Because we drive a real wrapper pointed at the actual callback URL, the host-root normalization simply does not apply — that behavior was specific to `zap-api-scan.py`.

Two rejected alternatives (recorded for posterity):

- **Hook on `zap-baseline.py`** (the sketch in the v0.5.0 CHANGELOG): the hook itself calls `zap.ascan.scan(...)` and blocks. Workable, but it makes us drive and wait on the active-scan lifecycle by hand inside a wrapper that is nominally passive — trickier teardown timing for no benefit over letting `zap-full-scan.py` own it.
- **Bare daemon + scripted client**: drop the `*.py` wrapper for this flavor and orchestrate `accessUrl → ascan.scan → poll → export` from a client. Maximum control, but a brand-new execution model none of the other flavors use — most code and maintenance, not justified.

### Active-scan coverage contingency

The expectation is that `zap-full-scan.py`'s own active-scan pass (`ascan.scan` recursing from the callback URL) attacks the parameters of the seeded node, since the seeded request lands in the Sites tree before the active-scan phase. **If integration validation shows the wrapper's pass does not attack the seeded params**, the hook will additionally drive `zap.ascan.scan` on the seeded node(s) in `zap_pre_shutdown` (which runs after the scan and can block to completion). This is a known, called-out fallback — the implementation plan must verify which path is needed via the juice-shop smoke before declaring done.

## What we explicitly are NOT doing

- **Deterministic sentinel open-redirect probe (option (b) from brainstorming).** A `zap_pre_shutdown` step that sends `redirect_uri=https://casa-ready-sentinel.invalid/` and inspects the `Location` header would be more deterministic, but its finding lives outside ZAP's alert pipeline — requiring a side-channel findings file, orchestrator merge logic, and a synthetic alert name for the triage KB to key on. Cut in favor of option (a) below. Recorded as a possible future hardening.
- **Browser automation / real OAuth dance.** Same as V2: `callbackParams` are fuzz inputs, not valid Google credentials. Out of scope, permanently, unless a real customer needs it.
- **OpenAPI import.** The whole point is to stop depending on synthetic OpenAPI. Real OpenAPI consumers can use `seedUrls`.
- **GraphQL/SOAP callback shapes.** Only `GET` query and `POST` form-urlencoded bodies. JSON-body callbacks are not an OAuth `response_mode` and are out of scope.

## User-facing changes

All additions are optional and backward-compatible. Existing `casa-ready.yml` files continue to work unchanged. The only behavioral change is that `scan: oauth-callback` targets, which currently fail, now succeed.

### Schema addition (`cli/lib/schema.js`)

One new optional field on the oauth-callback target shape (`callbackParams` already exists and is unchanged):

| Field | Type | Default | Purpose |
|---|---|---|---|
| `method` | `'GET' \| 'POST' \| Array<'GET' \| 'POST'>` | `'GET'` | Which HTTP method(s) to probe. `GET` places `callbackParams` in the query string; `POST` places them in an `application/x-www-form-urlencoded` body (OAuth `response_mode=form_post`). An array probes each method. |

### Schema cross-field constraints (Zod `superRefine`)

Existing rules are retained:

- `scan: oauth-callback` requires non-empty `callbackParams`
- `scan: oauth-callback` requires `auth.type: none`

New rule:

- `method`, when present, must be `GET`, `POST`, or a non-empty array of those (deduped). Any other value is rejected with a targeted message.

### Example YAML (un-commented, EXPERIMENTAL warning removed)

```yaml
# OAuth callback active scan — fuzzes the callback handler's parameters.
# callbackParams are FUZZ INPUTS, not valid Google credentials; ZAP mutates
# them looking for injection, XSS in error responses, and open redirect.
- name: oauth-callback
  url: https://example.com/auth/google/callback
  auth:
    type: none
  scan: oauth-callback
  method: [GET, POST]        # NEW: default is GET; POST = response_mode=form_post
  callbackParams:
    state: test-state-token
    code: test-authorization-code
    redirect_uri: https://example.com/dashboard
```

## Internal architecture

### Module layout

```
configs/zap/
├── oauth-callback-hook.py            ← NEW: zap_started seeds GET/POST parameterized
│                                        requests into the Sites tree; no-op if descriptor
│                                        missing/empty (mirrors seed-spider-hook.py)
└── casa-tier2.policy                 ← MODIFY: ensure External Redirect (plugin 20019)
                                         active-scan rule is enabled at a meaningful strength

cli/lib/
├── oauth-callback-descriptor.js      ← NEW (pure): buildDescriptor(target) → { url, methods, params }
├── scan-flavors/
│   └── oauth-callback.js             ← REWRITE: zap-full-scan.py + --hook + descriptor mount.
│                                        DELETE renderOpenApiYaml, the dummy-root-path
│                                        workaround, openApiPath, the /zap/openapi.yaml mount.
└── schema.js                         ← MODIFY: add `method` field + superRefine rule

cli/commands/
└── scan.js                           ← MODIFY: write/mount the descriptor JSON (replaces the
                                         OpenAPI temp-file plumbing: writeOpenApiFile/
                                         deleteOpenApiFile → writeCallbackDescriptor/delete…)

configs/casa/rules/
└── external-redirect.md              ← NEW: triage rule file mapping ZAP "External Redirect"
                                         (plugin 20019) → Actionable, with the fix pattern
```

### Descriptor contract

`buildDescriptor(target)` is a pure function producing the JSON the hook consumes:

```json
{
  "url": "https://example.com/auth/google/callback",
  "methods": ["GET", "POST"],
  "params": { "state": "test-state-token", "code": "test-authorization-code", "redirect_uri": "https://example.com/dashboard" }
}
```

- `methods` is always normalized to an array (a scalar `method` becomes a one-element array), deduped, order-stable (`GET` before `POST`).
- `params` is `callbackParams` verbatim.

The orchestrator writes this to a temp file and mounts it at `/zap/oauth-callback.json` — **root level, not under `/zap/wrk/`** — to avoid the Docker Desktop virtiofs nested-mount failure that bit v0.4.2 (regression-tested).

### Hook mechanics (`oauth-callback-hook.py`)

```python
SEED_FILE = "/zap/oauth-callback.json"

def zap_started(zap, target):
    if not os.path.exists(SEED_FILE):
        return                       # no-op — bare callback URL still gets scanned
    desc = json.load(open(SEED_FILE, encoding="utf-8"))
    for method in desc.get("methods", ["GET"]):
        try:
            if method == "GET":
                zap.core.access_url(build_query_url(desc["url"], desc["params"]))
            elif method == "POST":
                zap.core.send_request(build_raw_post(desc["url"], desc["params"]))
        except Exception as e:
            logging.warning("CASA Ready: seed %s %s failed: %s", method, desc["url"], e)
```

- `GET` seeds via a URL with the params as a query string.
- `POST` seeds a raw `application/x-www-form-urlencoded` request so ZAP records a node whose body params are the injection points.
- Per-method failures log and continue (one method erroring must not abort the scan) — mirrors `seed-spider-hook.py`'s defensive posture.
- Exact ZAP Python API method names (`access_url` / `send_request` vs. their current spellings in the bundled client) are confirmed against the `zaproxy/zap-stable` image during implementation; the contract above is the intent.

### `oauth-callback` flavor argv (rewritten)

```
docker run --rm --name casa-ready-<target>-<runId>
  -v <configsDir>:/zap/configs:ro
  -v <outputDir>:/zap/wrk:rw
  -v <contextPath>:/zap/context.xml:ro
  -v <descriptorPath>:/zap/oauth-callback.json:ro
  zaproxy/zap-stable
  zap-full-scan.py
    -t <callback_url>
    -n /zap/context.xml
    --hook=/zap/configs/oauth-callback-hook.py
    -J results.json -x results.xml -r results.html
```

No `zap-api-scan.py`, no `-f openapi`, no OpenAPI mount.

### Data flow per oauth-callback target

```
1. buildDescriptor(target) → { url, methods, params }
2. orchestrator writes descriptor to a temp file; mounts at /zap/oauth-callback.json
3. zap-full-scan.py -t <callback_url> --hook=…/oauth-callback-hook.py -n /zap/context.xml -J results.json …
4. hook.zap_started: seed each method's parameterized request into the Sites tree
5. wrapper spiders + active-scans → params attacked → results.json
   (contingency: if seeded params aren't attacked, hook drives ascan in zap_pre_shutdown)
6. summarize + write per-target outputs (unchanged downstream)
```

### Open-redirect detection (option (a), in-pipeline)

`redirect_uri` (and any declared param) is seeded as an injection point, and ZAP's purpose-built **External Redirect** active-scan rule (plugin 20019) is enabled in `casa-tier2.policy`. The open-redirect attack therefore runs as part of the normal active scan and surfaces as a **standard ZAP alert in `results.json`**, flowing through `summarize` and the triage classifier like any other finding. A new `configs/casa/rules/external-redirect.md` rule file maps plugin 20019 / alert name "External Redirect" to the **Actionable** category with the standard fix pattern (validate/allowlist redirect targets server-side), so triage classifies it correctly. This is the entire open-redirect deliverable — no side channel, no custom finding plumbing.

## Error handling

| Condition | Behavior |
|---|---|
| Descriptor file missing/empty inside the container | Hook no-ops and logs; `zap-full-scan.py` still scans the bare callback URL. |
| One `method`'s seed request fails inside the hook | Log a warning, continue with other methods (don't abort the scan). |
| `method` is an invalid value | Schema rejects via Zod `superRefine` with a targeted message. |
| `scan: oauth-callback` without `callbackParams` | Schema rejects (existing rule, retained). |
| `scan: oauth-callback` with `auth.type !== 'none'` | Schema rejects (existing rule, retained). |
| Wrapper's active scan doesn't attack seeded params (discovered in smoke) | Implement the `zap_pre_shutdown` ascan fallback (see contingency); this is a gate on "done," verified by the integration smoke. |

## Testing strategy

| Module | Tests | Approx. count |
|---|---|---|
| `cli/lib/oauth-callback-descriptor.js` | Pure module, full coverage — scalar `method` → array, GET default, POST, both, dedup, order stability, params passthrough | 6–8 |
| `cli/lib/schema.js` | `method` accepted (scalar + array), invalid `method` rejected, `callbackParams` still required, `auth.type: none` still required | 4–6 |
| `cli/lib/scan-flavors/oauth-callback.js` | argv asserts `zap-full-scan.py` + `--hook` + descriptor mounted at `/zap` root (regression: **not** under `/zap/wrk/`); asserts no `zap-api-scan.py` / `-f openapi` / OpenAPI mount remain | 4–6 |
| OpenAPI deletion | Remove `renderOpenApiYaml` and its tests; assert the symbol is gone | (net negative) |
| `cli/commands/scan.js` | Descriptor temp file written, mounted, and cleaned up (replaces the OpenAPI temp-file deps); existing tests updated for the new dependency names | 3–4 |
| Rules KB (`tests/rules-kb.test.js`) | `external-redirect.md` parses, has a unique `zap_alert_name`, maps plugin 20019; existing KB invariants still hold | covered by existing suite |
| `oauth-callback-hook.py` (Python) | **No unit harness in this repo** (consistent with `seed-spider-hook.py`). Covered by the integration smoke. Stated plainly, not faked. | 0 (documented gap) |
| Integration smoke (`tests/integration/oauth-callback-smoke.test.js`, gated) | Rewrite to validate the new flow against juice-shop: a GET callback target and a POST variant both produce active-scan artifacts. This is the end-to-end proof; run with `RUN_INTEGRATION=1`. | 1–2 |

## Documentation deltas

- **`casa-ready.yml.example`** — un-comment the oauth-callback target, remove the ⚠️ EXPERIMENTAL warning, add the `method` field with a comment explaining `GET` vs. `POST`/`form_post`.
- **`README.md`** — flip the V2.1 roadmap row to ✓; remove "oauth-callback experimental" caveat from the V2 row; brief note that callbacks are actively scanned (GET + POST) with open-redirect coverage.
- **`website/src/pages/index.astro`** — flip the V2.1 roadmap row to shipped; update the OAuth-callback feature card to drop "experimental."
- **`CHANGELOG.md`** — `[0.6.0]` entry: Fixed (oauth-callback now works — root cause + new mechanism), Added (`method` field, POST/form_post support, External Redirect rule + `external-redirect.md`), Changed (oauth-callback no longer experimental; OpenAPI machinery removed).
- **`CONTRIBUTING.md`** — note the new hook (`oauth-callback-hook.py`) alongside `seed-spider-hook.py` as the pattern for wrapper-level ZAP extension.
- **`MIGRATION.md`** — short "v0.5.x → v0.6.0" note: no breaking changes; oauth-callback targets that previously failed now work; new optional `method` field.

## Release shape

- Ships as `v0.6.0` (minor — additive `method` field, new POST/open-redirect capability, feature un-deprecated; fully backward-compatible).
- Implementation in a `v0.6.0-impl` worktree off `main` (per `superpowers:using-git-worktrees`).
- Atomic commits per task; TDD per module (pure modules and schema first, flavor argv next, docs last).
- The integration smoke (`RUN_INTEGRATION=1`) is a **required gate** before release — it both proves the mechanism and decides the active-scan contingency.
- Single PR off `main`, rebase merge to preserve atomic commits. Tag `v0.6.0` on post-merge `main` HEAD; push tag.
- `npm publish` via the passkey flow (Erik runs `! npm publish`, confirms in browser). Refresh `plugin/plugin.json` version in lockstep.

## Open questions

None remaining. Resolved during brainstorming:

- ✅ Driver is OSS completeness; validation against juice-shop (no Magpipe dogfood).
- ✅ Scope: swap + remove dead OpenAPI code + broaden coverage (POST/form_post, open-redirect, configurable methods).
- ✅ Execution model: custom `--hook` on `zap-full-scan.py`.
- ✅ Open-redirect: option (a) — ZAP's External Redirect rule on the seeded `redirect_uri` param, in-pipeline; the deterministic sentinel probe (b) is explicitly out of scope.
- ✅ Active-scan coverage contingency documented (hook-driven `ascan` fallback in `zap_pre_shutdown` if needed), gated by the integration smoke.
