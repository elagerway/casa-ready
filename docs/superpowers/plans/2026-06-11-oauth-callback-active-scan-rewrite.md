# OAuth Callback Active-Scan Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken `zap-api-scan.py`-based `oauth-callback` scan flavor with a custom `--hook` on `zap-full-scan.py` that actively scans the exact callback URL (GET query + POST form body) with `callbackParams` as injection points, including open-redirect detection on `redirect_uri`.

**Architecture:** A new pure module builds a JSON descriptor (`{url, methods, params}`) from the target; the orchestrator writes it to a temp file and mounts it at `/zap/oauth-callback.json`; a new Python hook (`oauth-callback-hook.py`) seeds the parameterized request(s) into ZAP's Sites tree at `zap_started`; `zap-full-scan.py` owns the active-scan lifecycle. The synthetic-OpenAPI machinery is deleted. Open-redirect is covered by ZAP's default-on External Redirect active-scan rule plus a new triage rule file.

**Tech Stack:** Node.js (ESM), Zod, Vitest, Python (ZAP wrapper hook), Docker (`zaproxy/zap-stable`), js-yaml.

**Spec:** `docs/superpowers/specs/2026-06-11-oauth-callback-active-scan-rewrite-design.md`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `cli/lib/schema.js` | Add optional `method` field to target schema | Modify |
| `cli/lib/oauth-callback-descriptor.js` | Pure: `buildDescriptor(target) → {url, methods, params}` | Create |
| `cli/lib/scan-flavors/oauth-callback.js` | Build `zap-full-scan.py` argv + descriptor mount + hook; drop OpenAPI | Rewrite |
| `cli/lib/docker.js` | Forward `descriptorPath` (replaces `openApiPath`/`callbackParams`) | Modify |
| `cli/commands/scan.js` | Write/mount descriptor JSON (replaces OpenAPI temp file) | Modify |
| `configs/zap/oauth-callback-hook.py` | Seed GET/POST parameterized requests into Sites tree | Create |
| `configs/casa/rules/external-redirect.md` | Triage rule: External Redirect (plugin 20019) → Actionable | Create |
| `tests/lib/oauth-callback-descriptor.test.js` | Descriptor unit tests | Create |
| `tests/lib/scan-flavors/oauth-callback.test.js` | Flavor argv tests | Rewrite |
| `tests/lib/scan-flavors/index.test.js` | Dispatcher routing test | Modify |
| `tests/lib/docker.test.js` | `descriptorPath` forwarding test | Modify |
| `tests/commands/scan.test.js` | Descriptor write/mount/cleanup tests | Modify |
| `tests/lib/schema.test.js` | `method` field tests | Modify |
| `tests/integration/oauth-callback-smoke.test.js` | End-to-end GET+POST smoke vs juice-shop | Rewrite |
| `casa-ready.yml.example`, `README.md`, `website/src/pages/index.astro`, `CHANGELOG.md`, `CONTRIBUTING.md`, `MIGRATION.md` | Docs | Modify |
| `package.json`, `plugin/plugin.json` | Version bump to 0.6.0 | Modify |

**Decision recorded (plan-level correction to spec):** The spec lists "MODIFY casa-tier2.policy: ensure External Redirect enabled." On inspection, `casa-tier2.policy` is **not wired into any flavor** (`cli/lib/scan-flavors/_common.js` never passes `-c`), and `zap-full-scan.py` runs its default active-scan policy, which includes the External Redirect rule (plugin 20019) by default. Therefore **no policy-file change is made**; the open-redirect deliverable is (1) seeding `redirect_uri` as an injection point and (2) the `external-redirect.md` triage rule. The integration smoke (Task 8) is the gate that confirms the rule actually fires; if it does not fire by default, wiring `-c /zap/configs/casa-tier2.policy` into the flavor is the documented fallback.

**Method ordering decision (resolves spec ambiguity):** `buildDescriptor` emits `methods` in canonical order — `GET` before `POST` — regardless of input order, deduped. A scalar `method` becomes a one-element array. Omitted `method` defaults to `['GET']`.

---

## Task 1: Schema — add optional `method` field

**Files:**
- Modify: `cli/lib/schema.js`
- Test: `tests/lib/schema.test.js`

- [ ] **Step 1: Write the failing tests**

Add these tests to `tests/lib/schema.test.js` (place them after the existing oauth-callback block, near line 155). They rely on the file's existing `baseConfig`/`cfg` helper shape — match whatever clone helper the surrounding tests use (they build `cfg` from a base and parse via `ConfigSchema.parse(cfg)`):

```javascript
  it("accepts a scalar method on an oauth-callback target", () => {
    const cfg = baseConfig();
    cfg.envs.staging.targets[0].auth = { type: 'none' };
    cfg.envs.staging.targets[0].scan = 'oauth-callback';
    cfg.envs.staging.targets[0].callbackParams = { state: 'x' };
    cfg.envs.staging.targets[0].method = 'POST';
    expect(() => ConfigSchema.parse(cfg)).not.toThrow();
  });

  it("accepts an array method on an oauth-callback target", () => {
    const cfg = baseConfig();
    cfg.envs.staging.targets[0].auth = { type: 'none' };
    cfg.envs.staging.targets[0].scan = 'oauth-callback';
    cfg.envs.staging.targets[0].callbackParams = { state: 'x' };
    cfg.envs.staging.targets[0].method = ['GET', 'POST'];
    expect(() => ConfigSchema.parse(cfg)).not.toThrow();
  });

  it("rejects an invalid method value", () => {
    const cfg = baseConfig();
    cfg.envs.staging.targets[0].auth = { type: 'none' };
    cfg.envs.staging.targets[0].scan = 'oauth-callback';
    cfg.envs.staging.targets[0].callbackParams = { state: 'x' };
    cfg.envs.staging.targets[0].method = 'DELETE';
    expect(() => ConfigSchema.parse(cfg)).toThrow();
  });

  it("rejects an empty method array", () => {
    const cfg = baseConfig();
    cfg.envs.staging.targets[0].auth = { type: 'none' };
    cfg.envs.staging.targets[0].scan = 'oauth-callback';
    cfg.envs.staging.targets[0].callbackParams = { state: 'x' };
    cfg.envs.staging.targets[0].method = [];
    expect(() => ConfigSchema.parse(cfg)).toThrow();
  });
```

> If the existing tests use a different helper name than `baseConfig()` (e.g. an inline object literal), adapt these four tests to that exact shape before running — open `tests/lib/schema.test.js` and copy the construction pattern from the test at line 135 ("accepts scan: 'oauth-callback' with callbackParams + auth.type: none").

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test tests/lib/schema.test.js`
Expected: the four new tests FAIL — `method` is currently an unknown key and `.strict()` rejects it, so even the "accepts" cases throw.

- [ ] **Step 3: Add the `method` field to the schema**

In `cli/lib/schema.js`, add an HTTP-method schema near `ScanFlavorSchema` (after line 48):

```javascript
const HttpMethodSchema = z.enum(['GET', 'POST']);
const MethodFieldSchema = z.union([HttpMethodSchema, z.array(HttpMethodSchema).min(1)]);
```

Add the field to `TargetSchema`'s object (after the `callbackParams` line, line 61):

```javascript
    // Per-target HTTP method(s) for the oauth-callback flavor. Optional;
    // defaults to GET in buildDescriptor. Ignored by other flavors.
    method: MethodFieldSchema.optional(),
```

Add `HttpMethodSchema` and `MethodFieldSchema` to the re-export block (after line 123, `ScanFlavorSchema,`):

```javascript
  HttpMethodSchema,
  MethodFieldSchema,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test tests/lib/schema.test.js`
Expected: PASS (all, including the four new tests).

- [ ] **Step 5: Commit**

```bash
git add cli/lib/schema.js tests/lib/schema.test.js
git commit -m "feat(schema): add optional method field for oauth-callback targets"
```

---

## Task 2: Descriptor builder — `cli/lib/oauth-callback-descriptor.js`

**Files:**
- Create: `cli/lib/oauth-callback-descriptor.js`
- Test: `tests/lib/oauth-callback-descriptor.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/oauth-callback-descriptor.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { buildDescriptor } from '../../cli/lib/oauth-callback-descriptor.js';

const target = {
  name: 'callback',
  url: 'https://example.com/auth/google/callback',
  auth: { type: 'none' },
  scan: 'oauth-callback',
  callbackParams: { state: 's', code: 'c', redirect_uri: 'https://example.com/dash' },
};

describe('buildDescriptor', () => {
  it('defaults methods to [GET] when method is absent', () => {
    expect(buildDescriptor(target)).toEqual({
      url: 'https://example.com/auth/google/callback',
      methods: ['GET'],
      params: { state: 's', code: 'c', redirect_uri: 'https://example.com/dash' },
    });
  });

  it('wraps a scalar method into an array', () => {
    expect(buildDescriptor({ ...target, method: 'POST' }).methods).toEqual(['POST']);
  });

  it('passes an array method through', () => {
    expect(buildDescriptor({ ...target, method: ['GET', 'POST'] }).methods).toEqual(['GET', 'POST']);
  });

  it('emits canonical GET-before-POST order regardless of input order', () => {
    expect(buildDescriptor({ ...target, method: ['POST', 'GET'] }).methods).toEqual(['GET', 'POST']);
  });

  it('dedupes repeated methods', () => {
    expect(buildDescriptor({ ...target, method: ['POST', 'POST', 'GET'] }).methods).toEqual(['GET', 'POST']);
  });

  it('carries callbackParams through verbatim', () => {
    expect(buildDescriptor(target).params).toEqual(target.callbackParams);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test tests/lib/oauth-callback-descriptor.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the module**

Create `cli/lib/oauth-callback-descriptor.js`:

```javascript
// Pure: turn an oauth-callback target into the JSON descriptor the
// oauth-callback-hook.py reads inside the ZAP container. The hook seeds one
// request per method, with callbackParams as the injection points.

const METHOD_ORDER = ['GET', 'POST'];

/**
 * @param {{url: string, callbackParams: Record<string,string>, method?: string | string[]}} target
 * @returns {{url: string, methods: string[], params: Record<string,string>}}
 */
export function buildDescriptor(target) {
  return {
    url: target.url,
    methods: normalizeMethods(target.method),
    params: target.callbackParams,
  };
}

function normalizeMethods(method) {
  const raw = method == null ? ['GET'] : Array.isArray(method) ? method : [method];
  const present = new Set(raw);
  // Canonical order (GET before POST), deduped.
  return METHOD_ORDER.filter((m) => present.has(m));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test tests/lib/oauth-callback-descriptor.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add cli/lib/oauth-callback-descriptor.js tests/lib/oauth-callback-descriptor.test.js
git commit -m "feat: add buildDescriptor for oauth-callback hook input"
```

---

## Task 3: Rewrite the `oauth-callback` flavor argv

**Files:**
- Rewrite: `cli/lib/scan-flavors/oauth-callback.js`
- Test (rewrite): `tests/lib/scan-flavors/oauth-callback.test.js`
- Test (modify): `tests/lib/scan-flavors/index.test.js`

- [ ] **Step 1: Rewrite the flavor test**

Replace the entire contents of `tests/lib/scan-flavors/oauth-callback.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { buildArgs } from '../../../cli/lib/scan-flavors/oauth-callback.js';

describe('scan-flavors/oauth-callback', () => {
  const baseOpts = {
    targetUrl: 'https://example.com/auth/google/callback',
    configsDir: '/abs/configs/zap',
    outputDir: '/abs/out',
    contextPath: '/tmp/ctx.xml',
    descriptorPath: '/tmp/oauth-callback-abc.json',
    containerName: 'casa-ready-callback-123',
  };

  it('uses zap-full-scan.py (not zap-api-scan.py)', () => {
    const args = buildArgs(baseOpts);
    expect(args).toContain('zap-full-scan.py');
    expect(args).not.toContain('zap-api-scan.py');
    expect(args).not.toContain('openapi');
  });

  it('registers the oauth-callback hook', () => {
    const args = buildArgs(baseOpts);
    const hookIdx = args.indexOf('--hook');
    expect(hookIdx).toBeGreaterThan(-1);
    expect(args[hookIdx + 1]).toBe('/zap/configs/oauth-callback-hook.py');
  });

  it('mounts the descriptor at /zap root (NOT inside /zap/wrk)', () => {
    const args = buildArgs(baseOpts);
    expect(args).toContain('/tmp/oauth-callback-abc.json:/zap/oauth-callback.json:ro');
    const descriptorMount = args.find((a) => a.startsWith('/tmp/oauth-callback-abc.json:'));
    expect(descriptorMount).not.toMatch(/:\/zap\/wrk\//);
  });

  it('targets the actual callback URL (no host-root normalization)', () => {
    const args = buildArgs(baseOpts);
    const tIdx = args.indexOf('-t');
    expect(args[tIdx + 1]).toBe('https://example.com/auth/google/callback');
  });

  it('preserves the standard mount + report flag set', () => {
    const args = buildArgs(baseOpts);
    expect(args).toContain('/abs/out:/zap/wrk:rw');
    expect(args).toContain('/tmp/ctx.xml:/zap/context.xml:ro');
    expect(args).toContain('-J');
    expect(args).toContain('results.json');
  });

  it('throws when descriptorPath is missing', () => {
    const opts = { ...baseOpts };
    delete opts.descriptorPath;
    expect(() => buildArgs(opts)).toThrow(/descriptorPath.*required/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test tests/lib/scan-flavors/oauth-callback.test.js`
Expected: FAIL — the current module still exports the OpenAPI-based `buildArgs`/`renderOpenApiYaml`; new assertions (zap-full-scan.py, `--hook`, descriptor mount, `descriptorPath` guard) fail.

- [ ] **Step 3: Rewrite the flavor module**

Replace the entire contents of `cli/lib/scan-flavors/oauth-callback.js`:

```javascript
import { RESULTS_FILENAME } from '../scan-output.js';

const ZAP_IMAGE = 'zaproxy/zap-stable';
const ZAP_CONTEXT_PATH = '/zap/context.xml';
// Descriptor lives at /zap/ root, NOT inside /zap/wrk/ (bind-mounted from
// outputDir) and NOT inside /zap/configs/ (mounted :ro — Docker can't create
// a new mountpoint there). Same lesson as v0.4.1/v0.4.2 seed-file fixes.
const ZAP_DESCRIPTOR_PATH = '/zap/oauth-callback.json';
const ZAP_HOOK_PATH = '/zap/configs/oauth-callback-hook.py';

/**
 * Build docker argv for an OAuth callback active scan.
 *
 * Uses zap-full-scan.py (active scan, owns the lifecycle) pointed at the exact
 * callback URL, plus oauth-callback-hook.py which seeds the parameterized
 * request(s) — GET query and/or POST form body — into ZAP's Sites tree from
 * the mounted descriptor. ZAP's active scanner then mutates callbackParams
 * looking for injection, XSS in error responses, and open redirect on
 * redirect_uri. No zap-api-scan.py, so no host-root normalization.
 */
export function buildArgs({
  targetUrl,
  configsDir,
  outputDir,
  contextPath,
  descriptorPath,
  containerName = null,
}) {
  if (!descriptorPath) {
    throw new Error(
      'descriptorPath is required for oauth-callback scan flavor (orchestrator must write the JSON descriptor and pass its path)'
    );
  }

  const args = ['run', '--rm'];
  if (containerName) {
    args.push('--name', containerName);
  }
  args.push(
    '-v',
    `${configsDir}:/zap/configs:ro`,
    '-v',
    `${outputDir}:/zap/wrk:rw`,
    '-v',
    `${contextPath}:${ZAP_CONTEXT_PATH}:ro`,
    '-v',
    `${descriptorPath}:${ZAP_DESCRIPTOR_PATH}:ro`,
    ZAP_IMAGE,
    'zap-full-scan.py',
    '-t',
    targetUrl,
    '-n',
    ZAP_CONTEXT_PATH,
    '-J',
    RESULTS_FILENAME,
    '-x',
    'results.xml',
    '-r',
    'results.html',
    '--hook',
    ZAP_HOOK_PATH
  );

  return args;
}
```

- [ ] **Step 4: Update the dispatcher test**

In `tests/lib/scan-flavors/index.test.js`, replace the `routes oauth-callback` test (lines 22–29) with:

```javascript
  it('routes oauth-callback to zap-full-scan.py', () => {
    const args = buildArgsFor('oauth-callback', {
      ...baseOpts,
      descriptorPath: '/tmp/oauth-callback.json',
    });
    expect(args).toContain('zap-full-scan.py');
    expect(args).not.toContain('zap-api-scan.py');
  });
```

- [ ] **Step 5: Run both tests to verify they pass**

Run: `npm test tests/lib/scan-flavors/oauth-callback.test.js tests/lib/scan-flavors/index.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add cli/lib/scan-flavors/oauth-callback.js tests/lib/scan-flavors/oauth-callback.test.js tests/lib/scan-flavors/index.test.js
git commit -m "refactor(oauth-callback): zap-full-scan.py + hook, drop synthetic OpenAPI"
```

---

## Task 4: `docker.js` — forward `descriptorPath`

**Files:**
- Modify: `cli/lib/docker.js`
- Test: `tests/lib/docker.test.js`

- [ ] **Step 1: Rewrite the failing test**

In `tests/lib/docker.test.js`, replace the `forwards openApiPath` test (around lines 154–171) with:

```javascript
  it('forwards descriptorPath to the dispatcher (oauth-callback flavor needs it)', () => {
    const args = buildZapArgs({
      flavor: 'oauth-callback',
      targetUrl: 'https://example.com/auth/google/callback',
      configsDir: '/abs/configs/zap',
      outputDir: '/abs/out',
      contextPath: '/tmp/ctx.xml',
      descriptorPath: '/tmp/oauth-callback-abc.json',
    });
    // If descriptorPath isn't forwarded from buildZapArgs to the dispatcher,
    // the oauth-callback adapter throws "descriptorPath is required". This
    // pins the contract at the docker.js boundary.
    expect(args).toContain('/tmp/oauth-callback-abc.json:/zap/oauth-callback.json:ro');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test tests/lib/docker.test.js`
Expected: FAIL — `buildZapArgs` does not yet accept/forward `descriptorPath` (it still forwards `openApiPath`/`callbackParams`), so the adapter throws "descriptorPath is required".

- [ ] **Step 3: Update `buildZapArgs`**

In `cli/lib/docker.js`, change the `buildZapArgs` signature and forwarded opts. Replace the `callbackParams = null, openApiPath = null,` destructured params (lines 35–36) with:

```javascript
  descriptorPath = null,
```

And in the forwarded object passed to `buildArgsFor` (the `return buildArgsFor(flavor, { ... })` block, lines 38–48), replace the `callbackParams,` and `openApiPath,` lines with:

```javascript
    descriptorPath,
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test tests/lib/docker.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/lib/docker.js tests/lib/docker.test.js
git commit -m "refactor(docker): forward descriptorPath instead of openApiPath"
```

---

## Task 5: `scan.js` — write & mount the descriptor

**Files:**
- Modify: `cli/commands/scan.js`
- Test: `tests/commands/scan.test.js`

- [ ] **Step 1: Update the orchestration test**

In `tests/commands/scan.test.js`, the oauth-callback target test (around lines 209–293) and every `deps.writeOpenApiFile`/`deps.deleteOpenApiFile` mock must move to the descriptor names. Apply these replacements throughout the file:

- Replace every `deps.writeOpenApiFile = vi.fn().mockResolvedValue('/tmp/casa-openapi-test.yaml');` with:
  `deps.writeCallbackDescriptor = vi.fn().mockResolvedValue('/tmp/casa-oauth-descriptor-test.json');`
- Replace every `deps.deleteOpenApiFile = vi.fn().mockResolvedValue(undefined);` with:
  `deps.deleteCallbackDescriptor = vi.fn().mockResolvedValue(undefined);`

Then replace the body of the assertion test that inspects the OpenAPI YAML (the block around lines 242–293 that asserts `writeOpenApiFile` was called once and the YAML body contains the callbackParams) with descriptor assertions:

```javascript
      // - oauth-callback target uses writeCallbackDescriptor (NOT writeSeedFile)
      // - non-oauth-callback targets never use writeCallbackDescriptor
      deps.writeCallbackDescriptor = vi.fn().mockResolvedValue('/tmp/casa-oauth-descriptor-test.json');
      deps.deleteCallbackDescriptor = vi.fn().mockResolvedValue(undefined);

      await runScan(
        { configPath: ymlPath, env: 'staging', flavor: 'baseline' },
        deps
      );

      // The oauth-callback target writes exactly one descriptor and cleans it up.
      expect(deps.writeCallbackDescriptor).toHaveBeenCalledTimes(1);
      expect(deps.deleteCallbackDescriptor).toHaveBeenCalledTimes(1);

      // The descriptor passed to writeCallbackDescriptor carries the configured
      // callbackParams and defaults methods to ['GET'].
      const descriptor = deps.writeCallbackDescriptor.mock.calls[0][0];
      expect(descriptor.url).toContain('/auth/google/callback');
      expect(descriptor.methods).toEqual(['GET']);
      expect(descriptor.params).toMatchObject({ state: expect.any(String) });
```

> The target YAML at lines 229–233 already sets `scan: oauth-callback` with `callbackParams`. Ensure that target's `callbackParams` includes a `state` key (the assertion above checks for it); if it uses different keys, change the assertion's key to match the YAML.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test tests/commands/scan.test.js`
Expected: FAIL — `scan.js` still references `renderOpenApiYaml`/`writeOpenApiFile`; the new `writeCallbackDescriptor` deps are never called.

- [ ] **Step 3: Update `scan.js`**

In `cli/commands/scan.js`:

1. Replace the import (line 11):
```javascript
import { buildDescriptor } from '../lib/oauth-callback-descriptor.js';
```

2. Replace the `writeOpenApiFile`/`deleteOpenApiFile` default deps (lines 66–71) with:
```javascript
    writeCallbackDescriptor = async (descriptor, runId) => {
      const tmpPath = path.join(tmpdir(), `casa-oauth-descriptor-${runId}.json`);
      await writeFile(tmpPath, JSON.stringify(descriptor), 'utf8');
      return tmpPath;
    },
    deleteCallbackDescriptor = (p) => unlink(p).catch(() => {}),
```

3. In the `runOneTarget` parameter list, replace `writeOpenApiFile,`/`deleteOpenApiFile,` (lines 156–157) with:
```javascript
  writeCallbackDescriptor,
  deleteCallbackDescriptor,
```
And replace the same two names in the `runOneTarget({ ... })` call inside `runScan` (lines 106–107) with:
```javascript
      writeCallbackDescriptor,
      deleteCallbackDescriptor,
```

4. Replace the local var declaration `let openApiPath = null;` (line 165) with:
```javascript
  let descriptorPath = null;
```

5. Replace the oauth-callback block (lines 194–198) with:
```javascript
    // For oauth-callback: build the JSON descriptor the hook reads in-container.
    if (targetFlavor === 'oauth-callback') {
      const descriptor = buildDescriptor(target);
      descriptorPath = await writeCallbackDescriptor(descriptor, runId);
    }
```

6. In the `buildZapArgs({ ... })` call (lines 200–212), replace `callbackParams: target.callbackParams,` and `openApiPath,` with:
```javascript
      descriptorPath,
```

7. In the `finally` block (lines 237–239), replace the openApiPath cleanup with:
```javascript
    if (descriptorPath) {
      await deleteCallbackDescriptor(descriptorPath);
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test tests/commands/scan.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full suite to catch fallout**

Run: `npm test`
Expected: PASS (no remaining references to `renderOpenApiYaml`/`openApiPath`). If any test still imports `renderOpenApiYaml`, it belongs to the deleted OpenAPI surface — remove that import/test.

- [ ] **Step 6: Commit**

```bash
git add cli/commands/scan.js tests/commands/scan.test.js
git commit -m "refactor(scan): write/mount oauth-callback JSON descriptor"
```

---

## Task 6: The ZAP hook — `configs/zap/oauth-callback-hook.py`

**Files:**
- Create: `configs/zap/oauth-callback-hook.py`

> No unit test: this repo has no Python test harness (consistent with `configs/zap/seed-spider-hook.py`). It is exercised by the integration smoke in Task 8. This gap is intentional and documented in the spec.

- [ ] **Step 1: Create the hook**

Create `configs/zap/oauth-callback-hook.py`:

```python
"""
CASA Ready ZAP hook: seed a single OAuth callback endpoint for active scanning.

Why this exists: zap-api-scan.py (the old oauth-callback path) normalizes the
active-scan target to the host root, which breaks single-endpoint callback
fuzzing. Instead we run zap-full-scan.py against the exact callback URL and use
this hook to seed the parameterized request(s) into ZAP's Sites tree so the
declared callbackParams become injection points. zap-full-scan.py then active-
scans them (including ZAP's External Redirect rule on redirect_uri).

Reads /zap/oauth-callback.json (written and mounted by the CASA Ready
orchestrator):

    { "url": "...", "methods": ["GET", "POST"], "params": { "state": "...", ... } }

GET  -> access_url(url + "?" + urlencode(params))
POST -> send_request(raw application/x-www-form-urlencoded request)

If the file is missing or empty, this is a no-op (zap-full-scan.py still scans
the bare callback URL). A failure seeding one method logs and continues — one
method erroring must not abort the whole scan.
"""
import json
import logging
import os
from urllib.parse import urlparse, urlencode

DESCRIPTOR_FILE = "/zap/oauth-callback.json"


def zap_started(zap, target):
    """Called by zap-full-scan.py after the ZAP daemon comes up."""
    if not os.path.exists(DESCRIPTOR_FILE):
        return
    try:
        with open(DESCRIPTOR_FILE, "r", encoding="utf-8") as f:
            desc = json.load(f)
    except Exception as e:  # noqa: BLE001 - log and skip, never abort the scan
        logging.warning("CASA Ready: could not read %s: %s", DESCRIPTOR_FILE, e)
        return

    url = desc.get("url")
    params = desc.get("params") or {}
    methods = desc.get("methods") or ["GET"]
    if not url:
        return

    for method in methods:
        try:
            if method == "GET":
                seeded = _build_query_url(url, params)
                zap.core.access_url(seeded)
                logging.info("CASA Ready: seeded GET %s", seeded)
            elif method == "POST":
                raw = _build_raw_post(url, params)
                zap.core.send_request(raw)
                logging.info("CASA Ready: seeded POST %s", url)
            else:
                logging.warning("CASA Ready: ignoring unknown method %s", method)
        except Exception as e:  # noqa: BLE001 - one method failing must not abort
            logging.warning("CASA Ready: seed %s %s failed: %s", method, url, e)


def _build_query_url(url, params):
    if not params:
        return url
    sep = "&" if urlparse(url).query else "?"
    return url + sep + urlencode(params)


def _build_raw_post(url, params):
    u = urlparse(url)
    path = u.path or "/"
    if u.query:
        path += "?" + u.query
    body = urlencode(params)
    return (
        "POST {path} HTTP/1.1\r\n"
        "Host: {host}\r\n"
        "Content-Type: application/x-www-form-urlencoded\r\n"
        "Content-Length: {length}\r\n"
        "\r\n"
        "{body}"
    ).format(path=path, host=u.netloc, length=len(body), body=body)
```

- [ ] **Step 2: Verify it parses as Python**

Run: `python3 -c "import ast; ast.parse(open('configs/zap/oauth-callback-hook.py').read()); print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add configs/zap/oauth-callback-hook.py
git commit -m "feat(zap): add oauth-callback-hook.py to seed parameterized callback requests"
```

---

## Task 7: Triage rule — `configs/casa/rules/external-redirect.md`

**Files:**
- Create: `configs/casa/rules/external-redirect.md`

> Validated by the existing `tests/rules-kb.test.js`, which iterates over every file in `configs/casa/rules/`. An actionable rule must have a `saq_section`, a body > 50 chars, and `## Standard fix pattern` + `## How to spot` sections; its `zap_plugin_ids` and `zap_alert_names` must be unique across the KB.

- [ ] **Step 1: Create the rule file**

Create `configs/casa/rules/external-redirect.md`:

```markdown
---
name: External Redirect
slug: external-redirect
zap_plugin_ids: [20019]
zap_alert_names:
  - "External Redirect"
cwe: 601
category: actionable
saq_section: "3.3"
saq_section_title: Input Validation
severity_override: null
fix_pattern: redirect-allowlist
---

# External Redirect

## What ZAP detects

ZAP's External Redirect active-scan rule (plugin 20019) injects attacker-controlled URLs into request parameters and checks whether the response redirects to them — via a `Location` header (3xx), a `Refresh` header, or a client-side `window.location` / `meta refresh`. On an OAuth callback handler, the most common injection point is a `redirect_uri` / `next` / `returnTo` parameter that the handler uses to decide where to send the user after processing the callback.

## Why this is "Actionable" for CASA

CASA Tier 2 (input validation) requires that redirect targets derived from user input be validated against a server-side allowlist. An open redirect on a callback handler is a real attack primitive: an attacker crafts a link to your trusted domain that silently bounces the authenticated user to a phishing site, or chains with OAuth to leak tokens. It is a code fix, not an SAQ explanation — the handler must stop trusting the parameter.

## Standard fix pattern

Never pass a request-derived value straight into a redirect. Validate against an allowlist of known-safe destinations, and fall back to a safe default:

```javascript
const SAFE_REDIRECTS = new Set([
  '/dashboard',
  '/account',
]);

function safeRedirectTarget(raw) {
  // Only allow same-site, allowlisted paths. Reject absolute URLs outright.
  if (typeof raw !== 'string' || raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('//')) {
    return '/dashboard';
  }
  return SAFE_REDIRECTS.has(raw) ? raw : '/dashboard';
}

// in the callback handler:
res.redirect(safeRedirectTarget(req.query.redirect_uri));
```

For OAuth specifically, prefer carrying post-login destination in signed server-side state (the `state` parameter you already validate) rather than a free-form `redirect_uri` on the callback.

## How to spot the source in your code

Grep patterns:
- `res\.redirect\(` (Express) / `redirect(` (framework helpers)
- `Location:` header set from a request value
- `window\.location\s*=` driven by a query param
- `redirect_uri`, `returnTo`, `next`, `continue`, `url=` parameters read in the callback handler

Common locations:
- The OAuth/OIDC callback route (`/auth/*/callback`)
- Generic "login then return to where you were" middleware
- Logout handlers that accept a post-logout redirect

## SAQ answer template (only if you cannot ship the fix before submission)

> The redirect target in `<FILE_PATH>` is derived from the `<PARAM>` parameter. We validate it against a same-site allowlist in `<FUNCTION>`; absolute and off-site URLs fall back to `<DEFAULT_PATH>`. The fix is tracked in `<ISSUE_ID>`, scheduled for `<DATE>`.

(Note: TAC reviewers prefer the actual fix. Use this template only when timing genuinely blocks the fix from landing pre-submission.)
```

- [ ] **Step 2: Run the rules-KB validation**

Run: `npm test tests/rules-kb.test.js`
Expected: PASS — the new rule has a valid category, unique plugin ID (20019) and alert name ("External Redirect"), a `saq_section`, and the required `## Standard fix pattern` / `## How to spot` sections.

- [ ] **Step 3: Commit**

```bash
git add configs/casa/rules/external-redirect.md
git commit -m "feat(rules): add External Redirect (open-redirect) triage rule"
```

---

## Task 8: Integration smoke — end-to-end GET + POST vs juice-shop

**Files:**
- Rewrite: `tests/integration/oauth-callback-smoke.test.js`

> Gated behind `RUN_INTEGRATION=1`; requires Docker + a local juice-shop on port 3000. This is the **release gate**: it proves the new mechanism works end-to-end and decides the active-scan contingency (see below).

- [ ] **Step 1: Rewrite the smoke test**

Replace the body of the `it(...)` in `tests/integration/oauth-callback-smoke.test.js` (the YAML at lines 39–52 and the comment at 30–33). Replace the comment and YAML so the target declares both methods, and update the stale "zap-api-scan" comment:

```javascript
  it('produces ZAP artifacts for a GET+POST oauth-callback target', async () => {
    // Single oauth-callback target pointing at juice-shop's login endpoint.
    // juice-shop accepts arbitrary params and returns useful errors, which
    // exercises the new zap-full-scan.py + oauth-callback-hook.py flow
    // (GET query string + POST form body) without needing a real OAuth
    // provider. We assert only that the orchestrator completed and wrote
    // artifacts — not what ZAP found.
    const tmpDir = path.join(tmpdir(), 'casa-oauth-smoke-' + Date.now());
    await mkdir(tmpDir, { recursive: true });
    const ymlPath = path.join(tmpDir, 'casa-ready.yml');
    await writeFile(
      ymlPath,
      `app: juice-shop-oauth-smoke
envs:
  staging:
    targets:
      - name: callback
        url: http://host.docker.internal:3000/rest/user/login
        auth: { type: none }
        scan: oauth-callback
        method: [GET, POST]
        callbackParams:
          email: test@x.com
          password: test
`,
      'utf8'
    );
```

Leave the `try { ... } finally { ... }` body (the `runScan` call and the `summary.md` assertion at lines 54–69) unchanged — it already asserts `exitCode ∈ {0,1}` and `summary` contains `# CASA Ready Scan Summary`.

- [ ] **Step 2: Run the smoke test**

Start juice-shop if not already running:
```bash
docker run --rm -d -p 3000:3000 --name juice-shop bkimminich/juice-shop
```
Run: `RUN_INTEGRATION=1 npm run test:integration`
Expected: PASS — artifacts written, `summary.md` present. Watch the container logs for the hook's `CASA Ready: seeded GET ...` / `CASA Ready: seeded POST ...` lines.

- [ ] **Step 3: Verify the active-scan contingency**

Inspect the produced `results.json` (path printed in the run output) for at least one active-scan alert whose `uri` includes the seeded params. If the active scan attacked the seeded params, the default `zap-full-scan.py` pass is sufficient — **done, no code change**.

If `results.json` shows the callback params were NOT attacked (only passive/spider alerts), implement the documented fallback in `configs/zap/oauth-callback-hook.py`: add a `zap_pre_shutdown(zap)` function that calls `zap.ascan.scan(seeded_url, recurse=False)` for each seeded node and polls `zap.ascan.status(scan_id)` to 100 before returning. Re-run Step 2 until an active-scan alert against the seeded params appears. Commit that change with message `fix(zap): drive ascan on seeded callback nodes in zap_pre_shutdown`.

- [ ] **Step 4: Stop juice-shop and commit the smoke test**

```bash
docker stop juice-shop
git add tests/integration/oauth-callback-smoke.test.js
git commit -m "test(integration): GET+POST oauth-callback smoke for the new hook flow"
```

---

## Task 9: Documentation

**Files:**
- Modify: `casa-ready.yml.example`, `README.md`, `website/src/pages/index.astro`, `CHANGELOG.md`, `CONTRIBUTING.md`, `MIGRATION.md`

- [ ] **Step 1: Un-deprecate the example**

In `casa-ready.yml.example`, find the commented-out oauth-callback target with the `⚠️ EXPERIMENTAL` warning. Un-comment it, remove the warning lines, and add the `method` field. The active target block should read:

```yaml
      # OAuth callback active scan — fuzzes the callback handler's parameters.
      # callbackParams are FUZZ INPUTS, not valid Google credentials; ZAP
      # mutates them looking for injection, XSS in error responses, and open
      # redirect on redirect_uri.
      - name: oauth-callback
        url: https://example.com/auth/google/callback
        auth:
          type: none
        scan: oauth-callback
        method: [GET, POST]   # default is GET; POST = OAuth response_mode=form_post
        callbackParams:
          state: test-state-token
          code: test-authorization-code
          redirect_uri: https://example.com/dashboard
```

> First read `casa-ready.yml.example` to find the exact comment block and indentation; match the file's existing 2-space-per-level YAML indentation under the env's `targets:`.

- [ ] **Step 2: Update README roadmap**

In `README.md`, find the roadmap table. Change the `V2.1` row's status from its planned/next text to:
```
| **V2.1** ✓ | OAuth callback active scan rewrite — custom `--hook` on `zap-full-scan.py` (GET + POST, open-redirect on `redirect_uri`); replaces the experimental `zap-api-scan.py` path | Shipped 2026-06-11 in `v0.6.0` |
```
And in the `V2` row, remove the "oauth-callback experimental" caveat so it reads as fully shipped.

> Read the current roadmap rows first (search for `V2.1` and `oauth-callback experimental`) and replace the exact existing text.

- [ ] **Step 3: Update the website roadmap + feature card**

In `website/src/pages/index.astro`:
- Find the roadmap `<tr>` for V2.1 (search `V2.1`). Change its status cell to shipped, matching the existing shipped-row markup (`<td class="shipped">Shipped Jun 11, 2026 &mdash; v0.6.0</td>`) and update the scope cell to mention GET+POST and open-redirect.
- If a feature card mentions "experimental" OAuth callback scanning, remove the "experimental" qualifier.

> Read the file's roadmap `<tbody>` first and edit the exact V2.1 `<tr>`.

- [ ] **Step 4: Rebuild the website to verify it compiles**

Run: `cd website && npm run build && cd ..`
Expected: `[build] Complete!` with 2 pages, no errors.

- [ ] **Step 5: Add the CHANGELOG entry**

In `CHANGELOG.md`, add a new top entry above the most recent version:

```markdown
## [0.6.0] — 2026-06-11

### Fixed

- **`scan: oauth-callback` now works.** The flavor previously failed at active-scan time with `URL_NOT_IN_CONTEXT` because `zap-api-scan.py` normalizes the active-scan target to the host root — wrong for single-endpoint callback fuzzing. The flavor now runs `zap-full-scan.py` against the exact callback URL with a custom `oauth-callback-hook.py` that seeds the parameterized request(s) into ZAP's Sites tree, so `callbackParams` become real injection points. No more host-root normalization.

### Added

- **POST / `form_post` callbacks and a `method` field.** OAuth callback targets accept `method: GET | POST | [GET, POST]` (default `GET`). `POST` sends `callbackParams` as an `application/x-www-form-urlencoded` body (OAuth `response_mode=form_post`).
- **Open-redirect coverage on `redirect_uri`.** ZAP's External Redirect active-scan rule runs against the seeded params; a new `configs/casa/rules/external-redirect.md` triage rule classifies the finding as Actionable with the redirect-allowlist fix pattern.

### Changed

- `scan: oauth-callback` is no longer experimental — the example YAML target is un-commented and the warning removed.
- Removed the synthetic-OpenAPI machinery (`renderOpenApiYaml`, the dummy-root-path workaround, the `/zap/openapi.yaml` mount) that the old path required.
```

- [ ] **Step 6: Update CONTRIBUTING + MIGRATION**

In `CONTRIBUTING.md`, find the section describing ZAP hooks / extension points (search `seed-spider-hook`) and add a sentence noting `configs/zap/oauth-callback-hook.py` as the second example of the wrapper-hook pattern (seeds a parameterized request for the oauth-callback flavor).

In `MIGRATION.md`, add a short section:

```markdown
## v0.5.x → v0.6.0

No breaking changes. Two notes:

- `scan: oauth-callback` targets that previously failed with `URL_NOT_IN_CONTEXT` now work — no config change required.
- New optional `method` field on oauth-callback targets: `method: [GET, POST]` to also probe `application/x-www-form-urlencoded` (OAuth `response_mode=form_post`) callbacks. Defaults to `GET`.
```

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS (all unit tests; integration remains skipped without `RUN_INTEGRATION=1`).

- [ ] **Step 8: Commit**

```bash
git add casa-ready.yml.example README.md website/src/pages/index.astro CHANGELOG.md CONTRIBUTING.md MIGRATION.md
git commit -m "docs: un-deprecate oauth-callback, document v0.6.0 (methods, open-redirect)"
```

---

## Task 10: Release v0.6.0

**Files:**
- Modify: `package.json`, `plugin/plugin.json`

- [ ] **Step 1: Bump versions**

Run: `npm pkg set version=0.6.0`

In `plugin/plugin.json`, change `"version": "0.5.3",` (or whatever the current value is — read it first) to `"version": "0.6.0",`.

- [ ] **Step 2: Verify the published tarball shape**

Run: `npm publish --dry-run 2>&1 | grep -E "version:|total files:|warn"`
Expected: `version: 0.6.0`, no `npm warn` lines, file count includes `configs/zap/oauth-callback-hook.py` and `configs/casa/rules/external-redirect.md` (and does NOT include the deleted OpenAPI code).

- [ ] **Step 3: Run the full suite one last time**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit, tag, push**

```bash
git add package.json plugin/plugin.json
git commit -m "chore(release): bump to v0.6.0"
git tag v0.6.0
git push origin <branch> --tags
```
(If implemented on `main` directly, `git push origin main --tags`. If in a worktree branch, push the branch and open a PR per the spec's release shape — rebase merge to preserve atomic commits, then tag `v0.6.0` on the merged `main` HEAD.)

- [ ] **Step 5: Publish to npm (manual — passkey)**

`npm publish` requires Erik's passkey confirmation in the browser; the agent cannot drive it. Surface this instruction to the user:

> Run `! npm publish` and confirm with your passkey when the browser prompts. Then I'll verify `npm view casa-ready version` shows `0.6.0`.

After the user confirms:
Run: `npm view casa-ready version dist-tags`
Expected: `version = '0.6.0'`, `dist-tags = { latest: '0.6.0' }`.

---

## Self-Review

**Spec coverage:**
- Core mechanism (hook on `zap-full-scan.py`) → Tasks 3, 6 ✓
- `method` schema field → Task 1 ✓
- Descriptor contract → Task 2 ✓
- Mount at `/zap` root (not `/zap/wrk`) → Task 3 (regression-asserted) ✓
- Delete OpenAPI machinery → Tasks 3, 5 ✓
- `docker.js` forwarding → Task 4 ✓
- Orchestrator descriptor write/mount/cleanup → Task 5 ✓
- Open-redirect via External Redirect rule + triage rule → Task 7 + plan-level policy decision ✓
- Active-scan contingency (pre_shutdown ascan fallback) → Task 8 Step 3 ✓
- Integration smoke (GET + POST, juice-shop) → Task 8 ✓
- Docs (example, README, website, CHANGELOG, CONTRIBUTING, MIGRATION) → Task 9 ✓
- Release v0.6.0 + passkey publish → Task 10 ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. The two "read the file first" notes (schema test helper shape; doc exact-text) are real-codebase adaptation guards, not placeholders — each names the exact anchor to match.

**Type consistency:** `descriptorPath` is used identically across Tasks 3 (flavor `buildArgs`), 4 (`docker.js` forward), 5 (`scan.js` local var + write dep). Dep names `writeCallbackDescriptor`/`deleteCallbackDescriptor` match between Task 5's `scan.js` change and its test change. `buildDescriptor` signature `{url, methods, params}` matches between Task 2 (definition), Task 5 (caller), Task 6 (hook reader), and Task 8 (smoke). `method` schema (Task 1) feeds `buildDescriptor` normalization (Task 2).

**Spec deviation flagged:** `casa-tier2.policy` is intentionally NOT modified (it isn't wired into any flavor and External Redirect is default-on in `zap-full-scan.py`); the integration smoke is the gate that confirms the rule fires, with `-c` wiring as the documented fallback.
