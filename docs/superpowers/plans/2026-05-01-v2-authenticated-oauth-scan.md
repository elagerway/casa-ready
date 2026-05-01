# V2 — Authenticated OAuth Scan + Endpoint Seeding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two CASA-blocking coverage gaps in v0.3.1 — Supabase Edge Function discovery (~60+ functions invisible to ZAP's spider) and OAuth callback handler active-scanning. Ship as `v0.4.0`, fully backward-compatible.

**Architecture:** Three optional schema additions (`seedUrls`, `seedDir`, per-target `scan` flavor + `callbackParams`) plus a new `auth.type: none`. Spider gets extra seed URLs via a Python `--hook` file (the only viable mechanism — ZAP daemon doesn't expose seed URLs as a CLI flag). OAuth callback active-scanning piggybacks `zap-api-scan.py` against a synthetic single-endpoint OpenAPI doc generated from `callbackParams`. Targeted refactor: extract `cli/lib/scan-flavors/{baseline,casa,oauth-callback}.js` adapters, mirroring the `cli/lib/auth/` dispatcher pattern.

**Tech Stack:** Node.js ≥20, Vitest, Zod, js-yaml, Docker (for ZAP `zaproxy/zap-stable`), Python (for the ZAP hook file — runs inside the container, host doesn't need Python).

**Spec:** `docs/superpowers/specs/2026-05-01-v2-authenticated-oauth-scan-design.md`

---

## File Structure

```
cli/
├── lib/
│   ├── schema.js                  ← MODIFY (Task 1): add seedUrls, seedDir, NoAuthSchema, scan, callbackParams + cross-field rules
│   ├── seed-urls.js               ← NEW (Task 2): resolveSeedUrls(target, cwd) → string[]
│   ├── auth/
│   │   ├── index.js               ← MODIFY (Task 3): register 'none' renderer
│   │   └── none.js                ← NEW (Task 3): scope-only context, no headers
│   ├── scan-flavors/              ← NEW (Tasks 4-7): per-flavor argv adapters
│   │   ├── index.js               ← Task 4: dispatcher
│   │   ├── baseline.js            ← Task 4: extracted from docker.js (zap-baseline.py)
│   │   ├── casa.js                ← Task 4: extracted (zap-full-scan.py)
│   │   └── oauth-callback.js      ← Task 7: zap-api-scan.py + synthetic OpenAPI
│   └── docker.js                  ← MODIFY (Task 5): buildZapArgs delegates to scan-flavors
└── commands/
    └── scan.js                    ← MODIFY (Task 8): per-target flavor + resolved seed URLs

configs/zap/
├── none-context-template.xml      ← NEW (Task 3)
└── seed-spider-hook.py            ← NEW (Task 6)

tests/
├── lib/
│   ├── seed-urls.test.js          ← NEW (Task 2)
│   ├── auth/none.test.js          ← NEW (Task 3)
│   ├── scan-flavors/
│   │   ├── baseline.test.js       ← NEW (Task 4)
│   │   ├── casa.test.js           ← NEW (Task 4)
│   │   └── oauth-callback.test.js ← NEW (Task 7)
│   └── schema.test.js             ← MODIFY (Task 1): new field cases
├── commands/scan.test.js          ← MODIFY (Task 8): mixed-flavor multi-target run
├── integration/oauth-callback-smoke.test.js  ← NEW (Task 10)
└── fixtures/multi-target-config.yml          ← MODIFY (Task 10): add OAuth callback target

casa-ready.yml.example             ← MODIFY (Task 10)
README.md                          ← MODIFY (Task 11)
CHANGELOG.md                       ← MODIFY (Task 11)
MIGRATION.md                       ← MODIFY (Task 11)
CONTRIBUTING.md                    ← MODIFY (Task 11)
package.json                       ← MODIFY (Task 11): version 0.3.1 → 0.4.0
schemas/casa-ready.schema.json     ← REGENERATED (Task 11): npm run build:schema
types/index.d.ts                   ← REGENERATED (Task 11): npm run build:schema
```

---

## Task 1: Schema additions

**Responsibility:** Zod is the single source of truth. Add the three optional target fields, the `NoAuthSchema`, the per-target `scan` enum, and the cross-field constraints.

**Files:**
- Modify: `cli/lib/schema.js`
- Modify: `tests/lib/schema.test.js`

- [ ] **Step 1: Add failing tests for new schema cases**

Edit `tests/lib/schema.test.js`. Find the `describe('ConfigSchema', () => {` block and append these tests INSIDE it (before the closing `});`):

```javascript
  it('accepts a target with seedUrls (string[])', () => {
    const cfg = structuredClone(validConfig);
    cfg.envs.staging.targets[0].seedUrls = ['/foo', 'https://staging.example.com/bar'];
    expect(() => ConfigSchema.parse(cfg)).not.toThrow();
  });

  it('accepts a target with seedDir (string path)', () => {
    const cfg = structuredClone(validConfig);
    cfg.envs.staging.targets[0].seedDir = './supabase/functions';
    expect(() => ConfigSchema.parse(cfg)).not.toThrow();
  });

  it("accepts auth.type: 'none' for public endpoints", () => {
    const cfg = structuredClone(validConfig);
    cfg.envs.staging.targets[0].auth = { type: 'none' };
    expect(() => ConfigSchema.parse(cfg)).not.toThrow();
  });

  it("accepts scan: 'oauth-callback' with callbackParams + auth.type: none", () => {
    const cfg = structuredClone(validConfig);
    cfg.envs.staging.targets[0].auth = { type: 'none' };
    cfg.envs.staging.targets[0].scan = 'oauth-callback';
    cfg.envs.staging.targets[0].callbackParams = { state: 'x', code: 'y' };
    expect(() => ConfigSchema.parse(cfg)).not.toThrow();
  });

  it("rejects scan: 'oauth-callback' without callbackParams", () => {
    const cfg = structuredClone(validConfig);
    cfg.envs.staging.targets[0].auth = { type: 'none' };
    cfg.envs.staging.targets[0].scan = 'oauth-callback';
    expect(() => ConfigSchema.parse(cfg)).toThrow(/callbackParams.*required.*oauth-callback/i);
  });

  it("rejects scan: 'oauth-callback' with empty callbackParams object", () => {
    const cfg = structuredClone(validConfig);
    cfg.envs.staging.targets[0].auth = { type: 'none' };
    cfg.envs.staging.targets[0].scan = 'oauth-callback';
    cfg.envs.staging.targets[0].callbackParams = {};
    expect(() => ConfigSchema.parse(cfg)).toThrow(/callbackParams.*required.*oauth-callback/i);
  });

  it("rejects scan: 'oauth-callback' with auth.type !== 'none'", () => {
    const cfg = structuredClone(validConfig);
    cfg.envs.staging.targets[0].scan = 'oauth-callback';
    cfg.envs.staging.targets[0].callbackParams = { state: 'x', code: 'y' };
    // auth.type is still 'form' from validConfig
    expect(() => ConfigSchema.parse(cfg)).toThrow(/oauth-callback.*requires.*auth\.type.*none/i);
  });

  it("accepts scan: 'baseline' or 'casa' with no callbackParams (per-target override)", () => {
    const cfg = structuredClone(validConfig);
    cfg.envs.staging.targets[0].scan = 'baseline';
    expect(() => ConfigSchema.parse(cfg)).not.toThrow();
    cfg.envs.staging.targets[0].scan = 'casa';
    expect(() => ConfigSchema.parse(cfg)).not.toThrow();
  });

  it('rejects unknown scan flavor', () => {
    const cfg = structuredClone(validConfig);
    cfg.envs.staging.targets[0].scan = 'fast';
    expect(() => ConfigSchema.parse(cfg)).toThrow(/Invalid enum value|fast/);
  });
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- tests/lib/schema.test.js`

Expected: 9 new tests fail (schema doesn't yet accept the new fields).

- [ ] **Step 3: Update cli/lib/schema.js**

Edit `cli/lib/schema.js`. Find the `SupabaseJwtAuthSchema` block. AFTER it, before the `AuthSchema` declaration, add:

```javascript
const NoAuthSchema = z
  .object({
    type: z.literal('none'),
  })
  .strict();
```

Find the `AuthSchema` declaration:

```javascript
const AuthSchema = z.discriminatedUnion('type', [
  FormAuthSchema,
  SupabaseJwtAuthSchema,
]);
```

Replace with:

```javascript
const AuthSchema = z.discriminatedUnion('type', [
  FormAuthSchema,
  SupabaseJwtAuthSchema,
  NoAuthSchema,
]);

const ScanFlavorSchema = z.enum(['casa', 'baseline', 'oauth-callback']);

const CallbackParamsSchema = z.record(z.string(), z.string());
```

Find the `TargetSchema` declaration:

```javascript
const TargetSchema = z
  .object({
    name: z.string().min(1, 'target.name is required'),
    url: HttpUrl,
    auth: AuthSchema,
  })
  .strict();
```

Replace with:

```javascript
const TargetSchema = z
  .object({
    name: z.string().min(1, 'target.name is required'),
    url: HttpUrl,
    auth: AuthSchema,
    // V2 additions — all optional, backward-compatible.
    seedUrls: z.array(z.string().min(1)).optional(),
    seedDir: z.string().min(1).optional(),
    scan: ScanFlavorSchema.optional(),
    callbackParams: CallbackParamsSchema.optional(),
  })
  .strict()
  .superRefine((target, ctx) => {
    if (target.scan === 'oauth-callback') {
      if (!target.callbackParams || Object.keys(target.callbackParams).length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['callbackParams'],
          message: 'callbackParams is required (and non-empty) when scan is oauth-callback',
        });
      }
      if (target.auth?.type !== 'none') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['auth', 'type'],
          message: "scan: 'oauth-callback' requires auth.type: 'none' (callback URLs are public)",
        });
      }
    }
  });
```

Find the re-exports line at the bottom:

```javascript
export { FormAuthSchema, SupabaseJwtAuthSchema, AuthSchema, TargetSchema, EnvSchema };
```

Replace with:

```javascript
export {
  FormAuthSchema,
  SupabaseJwtAuthSchema,
  NoAuthSchema,
  AuthSchema,
  ScanFlavorSchema,
  CallbackParamsSchema,
  TargetSchema,
  EnvSchema,
};
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- tests/lib/schema.test.js`

Expected: All schema tests pass (existing ~13 + 9 new = 22 tests).

- [ ] **Step 5: Commit**

```bash
git add cli/lib/schema.js tests/lib/schema.test.js
git commit -m "feat(schema): seedUrls + seedDir + per-target scan flavor + auth.type=none

V2 prep — schema additions are fully backward-compat. Cross-field rules
enforced via superRefine: scan=oauth-callback requires non-empty
callbackParams and auth.type=none (the callback is always public-fronted)."
```

---

## Task 2: `cli/lib/seed-urls.js`

**Responsibility:** Pure resolver. Takes `(target, cwd)` and returns the deduped list of URLs to seed ZAP's spider with. Always includes `target.url` first; appends `seedDir`-derived seeds, then explicit `seedUrls`. Path-only entries get prefixed with the target's origin.

**Files:**
- Create: `cli/lib/seed-urls.js`
- Create: `tests/lib/seed-urls.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/lib/seed-urls.test.js`:

```javascript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveSeedUrls } from '../../cli/lib/seed-urls.js';

describe('resolveSeedUrls', () => {
  const baseTarget = { name: 't', auth: { type: 'none' } };

  it('returns just target.url when no seeds configured', async () => {
    const target = { ...baseTarget, url: 'https://api.example.com' };
    expect(await resolveSeedUrls(target)).toEqual(['https://api.example.com']);
  });

  it('appends explicit seedUrls (full URLs) after target.url', async () => {
    const target = {
      ...baseTarget,
      url: 'https://api.example.com',
      seedUrls: ['https://api.example.com/foo', 'https://api.example.com/bar'],
    };
    expect(await resolveSeedUrls(target)).toEqual([
      'https://api.example.com',
      'https://api.example.com/foo',
      'https://api.example.com/bar',
    ]);
  });

  it('prefixes leading-slash seedUrls with target origin', async () => {
    const target = {
      ...baseTarget,
      url: 'https://api.example.com/v1',
      seedUrls: ['/v1/foo', '/healthz'],
    };
    expect(await resolveSeedUrls(target)).toEqual([
      'https://api.example.com/v1',
      'https://api.example.com/v1/foo',
      'https://api.example.com/healthz',
    ]);
  });

  it('appends path-only seedUrls (no leading slash) to target.url', async () => {
    const target = {
      ...baseTarget,
      url: 'https://api.example.com/v1',
      seedUrls: ['gmail-inbox'],
    };
    expect(await resolveSeedUrls(target)).toEqual([
      'https://api.example.com/v1',
      'https://api.example.com/v1/gmail-inbox',
    ]);
  });

  it('globs seedDir subdirectories and appends each name to target.url', async () => {
    const tmpDir = await mkdtemp(path.join(tmpdir(), 'seed-test-'));
    try {
      await mkdir(path.join(tmpDir, 'gmail-inbox'));
      await mkdir(path.join(tmpDir, 'gmail-send'));
      await writeFile(path.join(tmpDir, 'README.md'), '');
      const target = { ...baseTarget, url: 'https://api.example.com/v1', seedDir: tmpDir };
      const result = await resolveSeedUrls(target);
      expect(result).toContain('https://api.example.com/v1/gmail-inbox');
      expect(result).toContain('https://api.example.com/v1/gmail-send');
      expect(result.filter((u) => u.endsWith('README.md'))).toEqual([]);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('skips dotfiles and underscore-prefixed dirs (Supabase _shared convention)', async () => {
    const tmpDir = await mkdtemp(path.join(tmpdir(), 'seed-test-'));
    try {
      await mkdir(path.join(tmpDir, '_shared'));
      await mkdir(path.join(tmpDir, '.git'));
      await mkdir(path.join(tmpDir, 'real-fn'));
      const target = { ...baseTarget, url: 'https://x.com', seedDir: tmpDir };
      const result = await resolveSeedUrls(target);
      expect(result).toContain('https://x.com/real-fn');
      expect(result).not.toContain('https://x.com/_shared');
      expect(result).not.toContain('https://x.com/.git');
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('throws if seedDir does not exist, naming the absolute path', async () => {
    const target = { ...baseTarget, url: 'https://x.com', seedDir: '/nonexistent/xyz/123' };
    await expect(resolveSeedUrls(target)).rejects.toThrow(
      /seedDir does not exist.*\/nonexistent\/xyz\/123/
    );
  });

  it('warns and falls back when seedDir is empty (no failure)', async () => {
    const tmpDir = await mkdtemp(path.join(tmpdir(), 'seed-test-'));
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const target = { ...baseTarget, url: 'https://x.com', seedDir: tmpDir };
      const result = await resolveSeedUrls(target);
      expect(result).toEqual(['https://x.com']);
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringMatching(/seedDir.*no subdirectories/));
    } finally {
      stderrSpy.mockRestore();
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('combines seedDir and seedUrls, dedupes preserving order', async () => {
    const tmpDir = await mkdtemp(path.join(tmpdir(), 'seed-test-'));
    try {
      await mkdir(path.join(tmpDir, 'foo'));
      const target = {
        ...baseTarget,
        url: 'https://x.com',
        seedDir: tmpDir,
        seedUrls: ['https://x.com/foo', 'https://x.com/bar'],
      };
      const result = await resolveSeedUrls(target);
      expect(result).toEqual(['https://x.com', 'https://x.com/foo', 'https://x.com/bar']);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('resolves relative seedDir against cwd argument', async () => {
    const cwdDir = await mkdtemp(path.join(tmpdir(), 'cwd-'));
    try {
      await mkdir(path.join(cwdDir, 'sub'));
      await mkdir(path.join(cwdDir, 'sub', 'fn'));
      const target = { ...baseTarget, url: 'https://x.com', seedDir: 'sub' };
      const result = await resolveSeedUrls(target, cwdDir);
      expect(result).toContain('https://x.com/fn');
    } finally {
      await rm(cwdDir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- tests/lib/seed-urls.test.js`

Expected: All 10 tests fail with `Cannot find module '../../cli/lib/seed-urls.js'`.

- [ ] **Step 3: Implement cli/lib/seed-urls.js**

Create `cli/lib/seed-urls.js`:

```javascript
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * Resolve all seed URLs for a target.
 *
 * Returns an array starting with target.url, then any seedDir-derived seeds
 * (each subdirectory name appended to target.url), then any explicit seedUrls
 * (path-only entries are prefixed with the target's origin or appended to
 * target.url depending on whether they have a leading slash). Final list is
 * deduped while preserving first-occurrence order.
 *
 * Throws if seedDir is set but the directory doesn't exist (catches typos
 * and missing project paths). Warns to stderr — does not throw — when
 * seedDir exists but contains no subdirectories (early-development case).
 *
 * @param {object} target — TargetSchema-shaped object
 * @param {string} cwd — base for resolving relative seedDir (default: process.cwd())
 * @returns {Promise<string[]>} deduped seed URLs in stable order
 */
export async function resolveSeedUrls(target, cwd = process.cwd()) {
  const seeds = [target.url];

  if (target.seedDir) {
    const dirSeeds = await globSeedDir(target, cwd);
    seeds.push(...dirSeeds);
  }

  if (target.seedUrls && target.seedUrls.length > 0) {
    for (const seed of target.seedUrls) {
      seeds.push(resolveRelativeUrl(seed, target.url));
    }
  }

  return Array.from(new Set(seeds));
}

async function globSeedDir(target, cwd) {
  const absDir = path.isAbsolute(target.seedDir)
    ? target.seedDir
    : path.join(cwd, target.seedDir);

  let entries;
  try {
    entries = await readdir(absDir);
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`seedDir does not exist: ${absDir}`);
    }
    throw err;
  }

  const subdirs = [];
  for (const entry of entries) {
    if (entry.startsWith('.') || entry.startsWith('_')) continue;
    const stats = await stat(path.join(absDir, entry));
    if (stats.isDirectory()) {
      subdirs.push(entry);
    }
  }

  if (subdirs.length === 0) {
    process.stderr.write(
      `Warning: seedDir at ${absDir} contains no subdirectories — falling back to seedUrls only\n`
    );
    return [];
  }

  return subdirs.map((name) => `${trimTrailingSlash(target.url)}/${name}`);
}

function resolveRelativeUrl(url, baseUrl) {
  if (/^https?:\/\//.test(url)) return url;
  const base = new URL(baseUrl);
  if (url.startsWith('/')) {
    return `${base.protocol}//${base.host}${url}`;
  }
  return `${trimTrailingSlash(baseUrl)}/${url}`;
}

function trimTrailingSlash(url) {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- tests/lib/seed-urls.test.js`

Expected: All 10 tests pass.

- [ ] **Step 5: Commit**

```bash
git add cli/lib/seed-urls.js tests/lib/seed-urls.test.js
git commit -m "feat(seed-urls): pure resolver for spider seed URL list

Combines target.url + seedDir-globbed subdirs (Supabase shortcut) +
explicit seedUrls. Path-only entries get prefixed with the target's
origin (leading slash) or appended to target.url (no slash). Dedupes
while preserving order. Throws on missing seedDir, warns on empty."
```

---

## Task 3: `cli/lib/auth/none.js` + context template

**Responsibility:** Add the third auth renderer: `none` for genuinely public endpoints. Returns scope-only XML, no replacer headers, no scriptPath. Mirror `cli/lib/auth/form.js` shape.

**Files:**
- Create: `configs/zap/none-context-template.xml`
- Create: `cli/lib/auth/none.js`
- Modify: `cli/lib/auth/index.js`
- Create: `tests/lib/auth/none.test.js`

- [ ] **Step 1: Create the context template**

Create `configs/zap/none-context-template.xml`:

```xml
<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<configuration>
  <context>
    <name>{{contextName}}</name>
    <desc>CASA Ready autogenerated context (no auth — public endpoint)</desc>
    <inscope>true</inscope>
    <incregexes>{{originScope}}</incregexes>
    <tech>
      <include>Db</include>
      <include>Language</include>
      <include>OS</include>
      <include>SCM</include>
      <include>WS</include>
    </tech>
    <urlparser>
      <class>org.zaproxy.zap.model.StandardParameterParser</class>
      <config>{"kvps":"&amp;","kvs":"=","struct":[]}</config>
    </urlparser>
    <postparser>
      <class>org.zaproxy.zap.model.StandardParameterParser</class>
      <config>{"kvps":"&amp;","kvs":"=","struct":[]}</config>
    </postparser>
    <!--
      auth.type=none — for public endpoints (OAuth callback handlers,
      marketing pages, public APIs). No <authentication>, <users>, or
      <session> blocks. Scope-only context, identical pattern to v0.2.4
      supabase-jwt context.
    -->
  </context>
</configuration>
```

- [ ] **Step 2: Write failing tests**

Create `tests/lib/auth/none.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getContext } from '../../../cli/lib/auth/none.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configsDir = path.resolve(__dirname, '..', '..', '..', 'configs', 'zap');

describe('none auth getContext', () => {
  const target = {
    name: 'oauth-callback',
    url: 'https://example.com/auth/google/callback',
    auth: { type: 'none' },
  };
  const credentials = { username: 'unused', password: 'unused' };

  it('returns scope-only XML (no auth/users/session blocks)', async () => {
    const result = await getContext({ target, credentials, configsDir, runId: 'r1' });
    expect(result.contextXml).toContain('<name>oauth-callback</name>');
    expect(result.contextXml).toContain('^https://example\\.com(/.*)?$');
    const noComments = result.contextXml.replace(/<!--[\s\S]*?-->/g, '');
    expect(noComments).not.toMatch(/<authentication[\s>]/);
    expect(noComments).not.toMatch(/<users[\s>]/);
    expect(noComments).not.toMatch(/<httpauthsessionwrapper[\s>]/);
  });

  it('returns scriptPath: null and replacerHeaders: null', async () => {
    const result = await getContext({ target, credentials, configsDir, runId: 'r1' });
    expect(result.scriptPath).toBeNull();
    expect(result.replacerHeaders).toBeNull();
  });

  it('does not require credentials to be valid (skips login entirely)', async () => {
    const result = await getContext({
      target,
      credentials: { username: '', password: '' },
      configsDir,
      runId: 'r1',
    });
    expect(result.contextXml).toContain('<name>oauth-callback</name>');
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

Run: `npm test -- tests/lib/auth/none.test.js`

Expected: All 3 tests fail with `Cannot find module '../../../cli/lib/auth/none.js'`.

- [ ] **Step 4: Implement cli/lib/auth/none.js**

Create `cli/lib/auth/none.js`:

```javascript
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { renderContext, deriveOriginScope } from '../zap-context.js';

const TEMPLATE_FILENAME = 'none-context-template.xml';

/**
 * Render a scope-only ZAP context for a public (unauthenticated) target.
 *
 * Used by oauth-callback targets and any other genuinely public endpoint.
 * Returns no replacerHeaders (no Bearer token to inject) and no scriptPath
 * (no Nashorn auth script to mount). The context defines scope only, so
 * ZAP's spider stays in-bounds while not attempting any login.
 */
export async function getContext({ target, credentials: _credentials, configsDir, runId: _runId }) {
  const templatePath = path.join(configsDir, TEMPLATE_FILENAME);
  const template = await readFile(templatePath, 'utf8');
  const contextXml = renderContext(template, {
    contextName: target.name,
    originScope: deriveOriginScope(target.url),
  });
  return { contextXml, scriptPath: null, replacerHeaders: null };
}
```

- [ ] **Step 5: Wire into the auth dispatcher**

Edit `cli/lib/auth/index.js`. Find:

```javascript
import * as form from './form.js';
import * as supabaseJwt from './supabase-jwt.js';

const RENDERERS = {
  form,
  'supabase-jwt': supabaseJwt,
};
```

Replace with:

```javascript
import * as form from './form.js';
import * as supabaseJwt from './supabase-jwt.js';
import * as none from './none.js';

const RENDERERS = {
  form,
  'supabase-jwt': supabaseJwt,
  none,
};
```

- [ ] **Step 6: Run tests to verify pass**

Run: `npm test -- tests/lib/auth/`

Expected: All auth tests pass (existing form + supabase-jwt + new none).

- [ ] **Step 7: Commit**

```bash
git add cli/lib/auth/none.js cli/lib/auth/index.js configs/zap/none-context-template.xml tests/lib/auth/none.test.js
git commit -m "feat(auth): add 'none' auth type for public endpoints

For OAuth callback handlers and other genuinely public endpoints. Returns
scope-only context XML, no replacerHeaders, no scriptPath. Mirrors the
v0.2.4 supabase-jwt scope-only template pattern."
```

---

## Task 4: Extract scan-flavor adapters (refactor, no behavior change)

**Responsibility:** Move per-flavor argv construction out of `cli/lib/docker.js` into `cli/lib/scan-flavors/{baseline,casa}.js` with a small dispatcher in `cli/lib/scan-flavors/index.js`. No behavior change yet — this is the structural prep for Task 7's `oauth-callback` flavor.

**Files:**
- Create: `cli/lib/scan-flavors/index.js`
- Create: `cli/lib/scan-flavors/baseline.js`
- Create: `cli/lib/scan-flavors/casa.js`
- Create: `tests/lib/scan-flavors/baseline.test.js`
- Create: `tests/lib/scan-flavors/casa.test.js`

- [ ] **Step 1: Write failing tests for baseline flavor**

Create `tests/lib/scan-flavors/baseline.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { buildArgs } from '../../../cli/lib/scan-flavors/baseline.js';

describe('scan-flavors/baseline', () => {
  const baseOpts = {
    targetUrl: 'https://example.com',
    configsDir: '/abs/configs/zap',
    outputDir: '/abs/scan-output/staging/2026-04-29T12-00-00Z',
    contextPath: '/tmp/casa-ctx-abc.xml',
  };

  it('uses zap-baseline.py as the scan script', () => {
    const args = buildArgs(baseOpts);
    expect(args).toContain('zap-baseline.py');
    expect(args).not.toContain('zap-full-scan.py');
  });

  it('emits the standard mount + report flag set', () => {
    const args = buildArgs(baseOpts);
    expect(args).toContain('-v');
    expect(args).toContain('/abs/configs/zap:/zap/configs:ro');
    expect(args).toContain('/abs/scan-output/staging/2026-04-29T12-00-00Z:/zap/wrk:rw');
    expect(args).toContain('/tmp/casa-ctx-abc.xml:/zap/context.xml:ro');
    expect(args).toContain('-J');
    expect(args).toContain('results.json');
    expect(args).toContain('-x');
    expect(args).toContain('results.xml');
    expect(args).toContain('-r');
    expect(args).toContain('results.html');
  });

  it('emits replacer -z config when replacerHeaders is supplied', () => {
    const args = buildArgs({
      ...baseOpts,
      replacerHeaders: [{ name: 'Authorization', value: 'Bearer eyJabc' }],
    });
    expect(args).toContain('-z');
    const zIdx = args.indexOf('-z');
    expect(args[zIdx + 1]).toContain('replacer.full_list(0).matchstr=Authorization');
    expect(args[zIdx + 1]).toContain('replacer.full_list(0).replacement=Bearer eyJabc');
  });

  it('emits --name and --hook + extra mount when containerName + seed file are provided', () => {
    const args = buildArgs({
      ...baseOpts,
      containerName: 'casa-ready-spa-runId',
      seedFilePath: '/tmp/seed-urls-abc.txt',
    });
    expect(args).toContain('--name');
    expect(args).toContain('casa-ready-spa-runId');
    expect(args).toContain('/tmp/seed-urls-abc.txt:/zap/configs/seed-urls.txt:ro');
    expect(args).toContain('--hook');
    expect(args).toContain('/zap/configs/seed-spider-hook.py');
  });

  it('omits --hook when seedFilePath is not provided (no extra seeds)', () => {
    const args = buildArgs(baseOpts);
    expect(args).not.toContain('--hook');
  });
});
```

- [ ] **Step 2: Write failing tests for casa flavor**

Create `tests/lib/scan-flavors/casa.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { buildArgs } from '../../../cli/lib/scan-flavors/casa.js';

describe('scan-flavors/casa', () => {
  const baseOpts = {
    targetUrl: 'https://example.com',
    configsDir: '/abs/configs/zap',
    outputDir: '/abs/out',
    contextPath: '/tmp/ctx.xml',
  };

  it('uses zap-full-scan.py', () => {
    const args = buildArgs(baseOpts);
    expect(args).toContain('zap-full-scan.py');
    expect(args).not.toContain('zap-baseline.py');
  });

  it('shares the mount + report shape with baseline', () => {
    const args = buildArgs(baseOpts);
    expect(args).toContain('-J');
    expect(args).toContain('results.json');
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

Run: `npm test -- tests/lib/scan-flavors/`

Expected: 7 tests fail (modules don't exist).

- [ ] **Step 4: Implement cli/lib/scan-flavors/baseline.js**

Create `cli/lib/scan-flavors/baseline.js`:

```javascript
import { buildCommonArgs } from './_common.js';

/**
 * Build docker argv for a baseline (passive) ZAP scan.
 *
 * Passive scan: spider only, no active probes. Safe to run against prod.
 * Maps to ZAP's zap-baseline.py wrapper. ~3 minutes for a small SPA target.
 */
export function buildArgs(opts) {
  return buildCommonArgs({ ...opts, scriptName: 'zap-baseline.py' });
}
```

- [ ] **Step 5: Implement cli/lib/scan-flavors/casa.js**

Create `cli/lib/scan-flavors/casa.js`:

```javascript
import { buildCommonArgs } from './_common.js';

/**
 * Build docker argv for a CASA-tier (active) ZAP scan.
 *
 * Active scan: spider + probe attacks. NOT safe for prod by default —
 * the orchestrator gates this behind --confirm-prod when env=prod.
 * Maps to ZAP's zap-full-scan.py wrapper. ~30+ minutes for any real target.
 */
export function buildArgs(opts) {
  return buildCommonArgs({ ...opts, scriptName: 'zap-full-scan.py' });
}
```

- [ ] **Step 6: Implement cli/lib/scan-flavors/_common.js (shared helper)**

Create `cli/lib/scan-flavors/_common.js`:

```javascript
const ZAP_IMAGE = 'zaproxy/zap-stable';
const ZAP_CONTEXT_PATH = '/zap/context.xml';
const ZAP_SEED_FILE_PATH = '/zap/configs/seed-urls.txt';
const ZAP_HOOK_PATH = '/zap/configs/seed-spider-hook.py';

/**
 * Build docker argv shared by zap-baseline.py and zap-full-scan.py flavors.
 * They differ only in scriptName. Spider seeds and replacer headers are
 * threaded through identically.
 *
 * Caller passes:
 *   scriptName        — 'zap-baseline.py' or 'zap-full-scan.py'
 *   targetUrl         — primary scan target (becomes the spider's first seed)
 *   configsDir        — host path mounted to /zap/configs
 *   outputDir         — host path mounted to /zap/wrk (ZAP writes results here)
 *   contextPath       — host path of the rendered context XML
 *   replacerHeaders   — optional [{name,value}] for Bearer/apikey injection
 *   containerName     — optional --name for `docker ps` visibility
 *   seedFilePath      — optional host path to seed-urls.txt; triggers --hook
 */
export function buildCommonArgs({
  scriptName,
  targetUrl,
  configsDir,
  outputDir,
  contextPath,
  replacerHeaders = null,
  containerName = null,
  seedFilePath = null,
}) {
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
    `${contextPath}:${ZAP_CONTEXT_PATH}:ro`
  );
  if (seedFilePath) {
    // Mount the seed-urls.txt that the orchestrator wrote, so the
    // seed-spider-hook.py inside the container can read it.
    args.push('-v', `${seedFilePath}:${ZAP_SEED_FILE_PATH}:ro`);
  }

  args.push(
    ZAP_IMAGE,
    scriptName,
    '-t',
    targetUrl,
    '-n',
    ZAP_CONTEXT_PATH,
    '-J',
    'results.json',
    '-x',
    'results.xml',
    '-r',
    'results.html'
  );

  if (seedFilePath) {
    args.push('--hook', ZAP_HOOK_PATH);
  }

  const replacerZArg = renderReplacerZArg(replacerHeaders);
  if (replacerZArg) {
    args.push('-z', replacerZArg);
  }

  return args;
}

/**
 * Render replacer-rule headers as a single -z value for the ZAP wrapper
 * scripts. The wrapper shlex-splits the value into ZAP daemon CLI args, so
 * each `-config key=value` token gets its own shell-escaped pair. Values
 * with spaces (e.g. `Bearer <jwt>`) are single-quoted so shlex preserves
 * them as one token.
 *
 * The full set of keys per rule (description, enabled, matchtype, matchstr,
 * regex, replacement, initiators) are required — omitting any silently
 * disables the replacer.
 */
function renderReplacerZArg(replacerHeaders) {
  if (!replacerHeaders || replacerHeaders.length === 0) return null;
  const parts = [];
  replacerHeaders.forEach((h, i) => {
    const prefix = `replacer.full_list(${i})`;
    parts.push('-config', shellQuoteForShlex(`${prefix}.description=casa-ready-${h.name}`));
    parts.push('-config', shellQuoteForShlex(`${prefix}.enabled=true`));
    parts.push('-config', shellQuoteForShlex(`${prefix}.matchtype=REQ_HEADER`));
    parts.push('-config', shellQuoteForShlex(`${prefix}.matchstr=${h.name}`));
    parts.push('-config', shellQuoteForShlex(`${prefix}.regex=false`));
    parts.push('-config', shellQuoteForShlex(`${prefix}.replacement=${h.value}`));
    parts.push('-config', shellQuoteForShlex(`${prefix}.initiators=`));
  });
  return parts.join(' ');
}

function shellQuoteForShlex(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}
```

- [ ] **Step 7: Implement cli/lib/scan-flavors/index.js (dispatcher)**

Create `cli/lib/scan-flavors/index.js`:

```javascript
import * as baseline from './baseline.js';
import * as casa from './casa.js';

const FLAVORS = {
  baseline,
  casa,
};

export function buildArgsFor(flavor, opts) {
  const adapter = FLAVORS[flavor];
  if (!adapter) {
    const known = Object.keys(FLAVORS).join(', ');
    throw new Error(`Unknown scan flavor: ${flavor}. Known flavors: ${known}`);
  }
  return adapter.buildArgs(opts);
}
```

- [ ] **Step 8: Run tests to verify pass**

Run: `npm test -- tests/lib/scan-flavors/`

Expected: All 7 tests pass.

- [ ] **Step 9: Commit**

```bash
git add cli/lib/scan-flavors/ tests/lib/scan-flavors/
git commit -m "refactor(scan): extract baseline + casa flavor adapters

Pure structural prep for Task 7's oauth-callback flavor. No behavior
change yet — the existing buildZapArgs in docker.js still owns the
public surface; Task 5 wires this dispatcher into it.

Common docker-argv shape lives in scan-flavors/_common.js; baseline.js
and casa.js are 4-line modules that just pick the script name. The
dispatcher in scan-flavors/index.js mirrors cli/lib/auth/index.js."
```

---

## Task 5: Wire `cli/lib/docker.js` to use the dispatcher

**Responsibility:** `buildZapArgs` becomes a thin wrapper around the scan-flavors dispatcher. All argv construction moves there. The `runZap` function stays in `docker.js` (it's about process management, not flavor-specific).

**Files:**
- Modify: `cli/lib/docker.js`
- Modify: `tests/lib/docker.test.js`

- [ ] **Step 1: Update tests/lib/docker.test.js to add `flavor` parameter**

Edit `tests/lib/docker.test.js`. Find the test "builds the exact argv for casa scan with no auth script (form auth)". Update its inputs to add `flavor: 'casa'`:

```javascript
  it('builds the exact argv for casa scan with no auth script (form auth)', () => {
    const args = buildZapArgs({
      flavor: 'casa',
      targetUrl: 'https://example.com',
      configsDir: '/abs/configs/zap',
      outputDir: '/abs/scan-output/prod/2026-04-29T12-00-00Z',
      contextPath: '/tmp/casa-ctx-abc.xml',
      scriptPath: null,
      containerName: 'casa-ready-spa-2026-04-30T12-00-00Z',
    });
    // (same expected array as before)
```

(The signature already accepts `flavor` — this test passes it through to the dispatcher.)

Find the test "uses zap-baseline.py for the baseline flavor" — it already passes `flavor: 'baseline'`. No change.

Find the test "throws on unknown flavor" — already exists, will be re-routed through the dispatcher.

- [ ] **Step 2: Run tests to verify the existing suite still passes**

Run: `npm test -- tests/lib/docker.test.js`

Expected: All existing docker tests still pass (no changes yet).

- [ ] **Step 3: Refactor cli/lib/docker.js**

Replace the entire `buildZapArgs` function and the helpers below it. Find:

```javascript
export function buildZapArgs({
  flavor,
  targetUrl,
  configsDir,
  outputDir,
  contextPath,
  scriptPath: _scriptPath = null,
  replacerHeaders = null,
  containerName = null,
}) {
  // ... existing 80+ lines ...
}

function renderReplacerZArg(replacerHeaders) {
  // ... existing ...
}

function shellQuoteForShlex(s) {
  // ... existing ...
}
```

Replace with:

```javascript
import { buildArgsFor } from './scan-flavors/index.js';

/**
 * Build the docker argv for a ZAP scan.
 *
 * Delegates to the scan-flavors dispatcher (cli/lib/scan-flavors/index.js).
 * `buildZapArgs` is the public entry point; per-flavor argv construction
 * lives in cli/lib/scan-flavors/{baseline,casa,oauth-callback}.js.
 *
 * `scriptPath` is preserved for backward compatibility with the form-auth
 * dispatcher's contract, but is unused as of v0.2.4. A future script-based
 * auth would register via the --hook mechanism.
 */
export function buildZapArgs({
  flavor,
  targetUrl,
  configsDir,
  outputDir,
  contextPath,
  scriptPath: _scriptPath = null,
  replacerHeaders = null,
  containerName = null,
  seedFilePath = null,
  callbackParams = null,
}) {
  return buildArgsFor(flavor, {
    targetUrl,
    configsDir,
    outputDir,
    contextPath,
    replacerHeaders,
    containerName,
    seedFilePath,
    callbackParams,
  });
}
```

Remove the now-dead `renderReplacerZArg` and `shellQuoteForShlex` functions from this file (they live in `cli/lib/scan-flavors/_common.js` now).

The `runZap` function below stays unchanged. Same for the `ZAP_IMAGE`, `ZAP_CONTEXT_PATH`, `ZAP_SCAN_COMPLETED_CODES`, `FLAVOR_TO_SCRIPT` constants — wait, `FLAVOR_TO_SCRIPT` and `ZAP_IMAGE`/`ZAP_CONTEXT_PATH` are now also dead in this file. Remove them.

After the cleanup, `cli/lib/docker.js` should be roughly:

```javascript
import { spawn as nodeSpawn } from 'node:child_process';
import { buildArgsFor } from './scan-flavors/index.js';

const ZAP_SCAN_COMPLETED_CODES = new Set([0, 1, 2, 3]);

export function buildZapArgs({
  flavor,
  targetUrl,
  configsDir,
  outputDir,
  contextPath,
  scriptPath: _scriptPath = null,
  replacerHeaders = null,
  containerName = null,
  seedFilePath = null,
  callbackParams = null,
}) {
  return buildArgsFor(flavor, {
    targetUrl,
    configsDir,
    outputDir,
    contextPath,
    replacerHeaders,
    containerName,
    seedFilePath,
    callbackParams,
  });
}

export function runZap(args, { spawnFn = nodeSpawn, log = (msg) => process.stdout.write(msg) } = {}) {
  return new Promise((resolve, reject) => {
    const nameIdx = args.indexOf('--name');
    if (nameIdx !== -1 && args[nameIdx + 1]) {
      log(`Started ZAP container '${args[nameIdx + 1]}' (visible in Docker Desktop)\n`);
    }
    const child = spawnFn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    if (child.stdout && typeof child.stdout.on === 'function') {
      child.stdout.on('data', (chunk) => process.stdout.write(chunk));
    }
    if (child.stderr && typeof child.stderr.on === 'function') {
      child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    }
    child.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(
          new Error(
            'Docker is not installed or not on PATH. Install Docker Desktop (macOS/Windows) or docker-ce (Linux).'
          )
        );
      } else {
        reject(err);
      }
    });
    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`ZAP container was killed by signal ${signal}`));
      } else if (ZAP_SCAN_COMPLETED_CODES.has(code)) {
        resolve({ exitCode: code });
      } else {
        reject(new Error(`ZAP container exited with code ${code}`));
      }
    });
  });
}
```

- [ ] **Step 4: Run the full suite to confirm no regressions**

Run: `npm test`

Expected: All tests pass (existing + new from Tasks 1-4).

- [ ] **Step 5: Commit**

```bash
git add cli/lib/docker.js
git commit -m "refactor(docker): buildZapArgs delegates to scan-flavors dispatcher

cli/lib/docker.js shrinks from ~170 lines to ~70. All flavor-specific
argv construction lives in cli/lib/scan-flavors/. The replacer-z and
shell-quoting helpers move to scan-flavors/_common.js where they
actually run.

runZap stays here — it's about process management, not flavor logic."
```

---

## Task 6: `seed-spider-hook.py` + wire seed file mount

**Responsibility:** Vendor a small Python hook that runs inside the ZAP container, reads `/zap/configs/seed-urls.txt`, and calls `zap.spider.scan(url)` for each entry. Wire the orchestrator to write the seed file when seeds are present, so it gets mounted via the existing scan-flavors mechanism.

**Files:**
- Create: `configs/zap/seed-spider-hook.py`

This task is just the Python hook — the orchestrator wiring happens in Task 8.

- [ ] **Step 1: Create the hook file**

Create `configs/zap/seed-spider-hook.py`:

```python
"""
CASA Ready ZAP hook: feed extra spider seeds.

Why this exists: zap-baseline.py and zap-full-scan.py both hardcode a single
zap.spider.scan(target_url) call. There's no CLI flag to add more seeds.
ZAP's daemon doesn't read seed URLs from -config either. The supported
escape hatch is --hook=<file>, which lets us register a Python callback
that runs inside the wrapper.

This hook reads /zap/configs/seed-urls.txt (one URL per line, mounted by
the CASA Ready orchestrator) and calls zap.spider.scan(url) for each entry.
The result is exactly what would happen if zap-baseline.py supported a
--seed-url flag.

If the file doesn't exist or is empty, this is a no-op — existing scans
without seed URLs are unaffected.
"""
import logging
import os


SEED_FILE = "/zap/configs/seed-urls.txt"


def zap_started(zap, target):
    """Called by zap-baseline.py / zap-full-scan.py after ZAP daemon comes up."""
    if not os.path.exists(SEED_FILE):
        return
    with open(SEED_FILE, "r", encoding="utf-8") as f:
        seeds = [line.strip() for line in f if line.strip() and not line.startswith("#")]
    if not seeds:
        return
    logging.info("CASA Ready: seeding spider with %d additional URLs", len(seeds))
    for seed in seeds:
        # Skip the primary target URL — the wrapper already spiders it.
        if seed == target:
            continue
        try:
            scan_id = zap.spider.scan(seed)
            logging.info("CASA Ready: spider.scan(%s) -> id=%s", seed, scan_id)
        except Exception as e:
            # Don't fail the whole scan if one seed errors (typically because
            # ZAP rejects it as out-of-context). Log and continue.
            logging.warning("CASA Ready: spider.scan(%s) failed: %s", seed, e)
```

- [ ] **Step 2: Verify the file is well-formed Python (syntax check, no execution)**

Run: `python3 -c "import ast; ast.parse(open('configs/zap/seed-spider-hook.py').read())" && echo "OK: parses"`

Expected: `OK: parses`

(Full runtime test happens via the integration smoke in Task 10 — needs Docker + ZAP. Unit test is impractical for an in-container Python file.)

- [ ] **Step 3: Commit**

```bash
git add configs/zap/seed-spider-hook.py
git commit -m "feat(hook): vendor seed-spider-hook.py for extra spider seeds

zap-baseline.py / zap-full-scan.py hardcode a single zap.spider.scan call.
This --hook reads /zap/configs/seed-urls.txt (mounted by the orchestrator
when seeds are configured) and calls spider.scan per URL. No-op if the
file is absent or empty, so existing seed-less scans are unaffected.

Per-seed errors are logged but don't fail the scan — typical reason is
ZAP rejecting an out-of-context URL, which shouldn't sink the whole run."
```

---

## Task 7: `cli/lib/scan-flavors/oauth-callback.js`

**Responsibility:** New scan flavor that wires `zap-api-scan.py` against a synthetic single-endpoint OpenAPI YAML generated from the target's `callbackParams`. ZAP's active scanner reads the example values and mutates them.

**Files:**
- Create: `cli/lib/scan-flavors/oauth-callback.js`
- Modify: `cli/lib/scan-flavors/index.js`
- Create: `tests/lib/scan-flavors/oauth-callback.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/lib/scan-flavors/oauth-callback.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { buildArgs, renderOpenApiYaml } from '../../../cli/lib/scan-flavors/oauth-callback.js';

describe('scan-flavors/oauth-callback', () => {
  const baseOpts = {
    targetUrl: 'https://magpipe.ai/auth/google/callback',
    configsDir: '/abs/configs/zap',
    outputDir: '/abs/out',
    contextPath: '/tmp/ctx.xml',
    callbackParams: { state: 'test-state', code: 'test-code', redirect_uri: 'https://magpipe.ai/dash' },
    openApiPath: '/tmp/oauth-openapi-abc.yaml',
  };

  it('uses zap-api-scan.py with -f openapi', () => {
    const args = buildArgs(baseOpts);
    expect(args).toContain('zap-api-scan.py');
    expect(args).toContain('-f');
    const fIdx = args.indexOf('-f');
    expect(args[fIdx + 1]).toBe('openapi');
  });

  it('mounts the synthetic OpenAPI file and points -t at it inside the container', () => {
    const args = buildArgs(baseOpts);
    expect(args).toContain('/tmp/oauth-openapi-abc.yaml:/zap/wrk/openapi.yaml:ro');
    const tIdx = args.indexOf('-t');
    expect(args[tIdx + 1]).toBe('/zap/wrk/openapi.yaml');
  });

  it('preserves the standard mount + report flag set', () => {
    const args = buildArgs(baseOpts);
    expect(args).toContain('/abs/out:/zap/wrk:rw');
    expect(args).toContain('/tmp/ctx.xml:/zap/context.xml:ro');
    expect(args).toContain('-J');
    expect(args).toContain('results.json');
  });

  it('throws when callbackParams is missing', () => {
    const opts = { ...baseOpts };
    delete opts.callbackParams;
    expect(() => buildArgs(opts)).toThrow(/callbackParams.*required.*oauth-callback/i);
  });

  it('throws when openApiPath is missing', () => {
    const opts = { ...baseOpts };
    delete opts.openApiPath;
    expect(() => buildArgs(opts)).toThrow(/openApiPath.*required/i);
  });
});

describe('renderOpenApiYaml', () => {
  it('produces a single-endpoint OpenAPI 3.0 doc with one query param per callbackParams entry', () => {
    const yaml = renderOpenApiYaml({
      url: 'https://magpipe.ai/auth/google/callback',
      params: { state: 'abc', code: 'xyz' },
    });
    expect(yaml).toContain('openapi: 3.0.0');
    expect(yaml).toContain('/auth/google/callback');
    expect(yaml).toContain('name: state');
    expect(yaml).toContain('example: abc');
    expect(yaml).toContain('name: code');
    expect(yaml).toContain('example: xyz');
    expect(yaml).toContain('in: query');
  });

  it('parses the URL path correctly (no host in the path:)', () => {
    const yaml = renderOpenApiYaml({
      url: 'https://magpipe.ai/auth/google/callback',
      params: { state: 'x' },
    });
    // The OpenAPI 'paths:' key has the URL path only; the server URL has the origin.
    expect(yaml).toMatch(/servers:\n\s*-\s*url:\s*https:\/\/magpipe\.ai\b/);
    expect(yaml).toMatch(/paths:\n\s*\/auth\/google\/callback:/);
  });

  it('XML-escapes nothing (it is YAML, not XML) but quotes example values that need it', () => {
    const yaml = renderOpenApiYaml({
      url: 'https://x.com/cb',
      params: { redirect_uri: 'https://attacker.example/?next=/admin' },
    });
    // js-yaml will quote the example string because it contains a colon
    expect(yaml).toMatch(/example:\s*'?https:\/\/attacker\.example/);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- tests/lib/scan-flavors/oauth-callback.test.js`

Expected: 8 tests fail (module doesn't exist).

- [ ] **Step 3: Implement cli/lib/scan-flavors/oauth-callback.js**

Create `cli/lib/scan-flavors/oauth-callback.js`:

```javascript
import yaml from 'js-yaml';

const ZAP_IMAGE = 'zaproxy/zap-stable';
const ZAP_CONTEXT_PATH = '/zap/context.xml';
const ZAP_OPENAPI_PATH = '/zap/wrk/openapi.yaml';

/**
 * Build docker argv for an OAuth callback active scan.
 *
 * Maps to ZAP's zap-api-scan.py wrapper, which expects an OpenAPI/SOAP/
 * GraphQL spec as input. We synthesize a single-endpoint OpenAPI 3.0 doc
 * from the target's callbackParams (rendered by renderOpenApiYaml and
 * written to disk by the orchestrator before the scan starts).
 *
 * The example values in the spec become ZAP's starting point for active
 * fuzzing. They do NOT need to be valid Google credentials — ZAP mutates
 * them looking for SQL injection, XSS, open-redirect via redirect_uri,
 * info leaks in error responses, and similar callback-handler classics.
 */
export function buildArgs({
  targetUrl,
  configsDir,
  outputDir,
  contextPath,
  callbackParams,
  openApiPath,
  containerName = null,
}) {
  if (!callbackParams || Object.keys(callbackParams).length === 0) {
    throw new Error(
      'callbackParams is required for oauth-callback scan flavor (and must be non-empty)'
    );
  }
  if (!openApiPath) {
    throw new Error(
      'openApiPath is required for oauth-callback scan flavor (orchestrator must write the synthetic OpenAPI doc and pass its path)'
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
    `${openApiPath}:${ZAP_OPENAPI_PATH}:ro`,
    ZAP_IMAGE,
    'zap-api-scan.py',
    '-t',
    ZAP_OPENAPI_PATH,
    '-f',
    'openapi',
    '-n',
    ZAP_CONTEXT_PATH,
    '-J',
    'results.json',
    '-x',
    'results.xml',
    '-r',
    'results.html'
  );

  // Suppress unused-var warning — targetUrl is informational here (the actual
  // URL ZAP scans comes from the OpenAPI doc), kept on the signature for
  // dispatcher symmetry with baseline.js / casa.js.
  void targetUrl;

  return args;
}

/**
 * Render a synthetic OpenAPI 3.0 YAML doc with one path and one query param
 * per callbackParams entry. Each example value is the corresponding param
 * value from the user's config — ZAP uses these as starting input for
 * mutation-based active scanning.
 */
export function renderOpenApiYaml({ url, params }) {
  const parsed = new URL(url);
  const serverUrl = `${parsed.protocol}//${parsed.host}`;
  const path = parsed.pathname;

  const doc = {
    openapi: '3.0.0',
    info: { title: 'casa-ready oauth-callback scan', version: '1' },
    servers: [{ url: serverUrl }],
    paths: {
      [path]: {
        get: {
          summary: 'OAuth callback handler',
          parameters: Object.entries(params).map(([name, example]) => ({
            name,
            in: 'query',
            required: true,
            schema: { type: 'string' },
            example,
          })),
          responses: {
            200: { description: 'callback handled' },
          },
        },
      },
    },
  };

  return yaml.dump(doc, { lineWidth: 120, noRefs: true });
}
```

- [ ] **Step 4: Register the flavor in the dispatcher**

Edit `cli/lib/scan-flavors/index.js`. Find:

```javascript
import * as baseline from './baseline.js';
import * as casa from './casa.js';

const FLAVORS = {
  baseline,
  casa,
};
```

Replace with:

```javascript
import * as baseline from './baseline.js';
import * as casa from './casa.js';
import * as oauthCallback from './oauth-callback.js';

const FLAVORS = {
  baseline,
  casa,
  'oauth-callback': oauthCallback,
};
```

- [ ] **Step 5: Run tests to verify pass**

Run: `npm test -- tests/lib/scan-flavors/`

Expected: All scan-flavors tests pass (baseline + casa + oauth-callback).

- [ ] **Step 6: Commit**

```bash
git add cli/lib/scan-flavors/oauth-callback.js cli/lib/scan-flavors/index.js tests/lib/scan-flavors/oauth-callback.test.js
git commit -m "feat(scan): oauth-callback flavor — active scan via synthetic OpenAPI

zap-api-scan.py against a synthesized single-endpoint OpenAPI 3.0 doc
generated from target.callbackParams. ZAP reads the example values and
mutates them, exercising callback-handler classics: SQL injection in
state/code, XSS in error messages, open-redirect via redirect_uri,
info leaks in error responses.

callbackParams values do NOT need to be valid Google credentials —
they're starting input for mutation-based active scanning."
```

---

## Task 8: `cli/commands/scan.js` — orchestrator wiring

**Responsibility:** Per-target flavor resolution, seed-URL list resolution + temp-file write, OpenAPI YAML generation for oauth-callback, all threaded through the dispatcher. Cleanup on success and failure.

**Files:**
- Modify: `cli/commands/scan.js`
- Modify: `tests/commands/scan.test.js`

- [ ] **Step 1: Write failing test for mixed-flavor multi-target run**

Edit `tests/commands/scan.test.js`. After the existing tests inside `describe('runScan (multi-target)', () => {`, add:

```javascript
  it('uses per-target scan flavor when set, else falls back to opts.flavor', async () => {
    // Build a fixture YAML on the fly: one supabase-jwt target with no scan
    // override, one oauth-callback target with scan: oauth-callback.
    const tmpDir = path.join(__dirname, '..', 'fixtures', 'tmp-mixed-flavors');
    const ymlPath = path.join(tmpDir, 'casa-ready.yml');
    await import('node:fs/promises').then((fs) => fs.mkdir(tmpDir, { recursive: true }));
    await import('node:fs/promises').then((fs) =>
      fs.writeFile(
        ymlPath,
        `app: testapp
envs:
  staging:
    targets:
      - name: api
        url: https://api.example.com
        auth:
          type: supabase-jwt
          loginUrl: https://api.example.com/auth/v1/token
          apiKey: anon
      - name: oauth-callback
        url: https://api.example.com/auth/google/callback
        auth: { type: none }
        scan: oauth-callback
        callbackParams:
          state: x
          code: y
`
      )
    );
    try {
      const deps = makeDeps();
      // Track which scriptName each runZap call used (proxy for flavor)
      deps.runZap = vi.fn().mockImplementation(async (args) => {
        // Find the script name (token after the image name 'zaproxy/zap-stable')
        const imgIdx = args.indexOf('zaproxy/zap-stable');
        const scriptName = args[imgIdx + 1];
        deps.runZap.scripts = deps.runZap.scripts || [];
        deps.runZap.scripts.push(scriptName);
        return { exitCode: 0 };
      });
      // supabase-jwt path needs a fetchFn we control
      deps.getAuthContext = async ({ target }) => {
        if (target.auth.type === 'supabase-jwt') {
          return {
            contextXml: '<context>fake</context>',
            scriptPath: null,
            replacerHeaders: [{ name: 'Authorization', value: 'Bearer fake' }],
          };
        }
        if (target.auth.type === 'none') {
          return { contextXml: '<context>fake</context>', scriptPath: null, replacerHeaders: null };
        }
        throw new Error(`unexpected auth type ${target.auth.type}`);
      };
      await runScan(
        { configPath: ymlPath, env: 'staging', confirmProd: false, flavor: 'casa' },
        deps
      );
      expect(deps.runZap.scripts).toEqual(['zap-full-scan.py', 'zap-api-scan.py']);
    } finally {
      await import('node:fs/promises').then((fs) =>
        fs.rm(tmpDir, { recursive: true, force: true })
      );
    }
  });
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- tests/commands/scan.test.js`

Expected: New test fails (orchestrator doesn't yet branch on per-target flavor or call the OpenAPI writer).

- [ ] **Step 3: Update cli/commands/scan.js**

Edit `cli/commands/scan.js`. Find the imports block at the top:

```javascript
import path from 'node:path';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadConfig, resolveTargets, readAuthCredentials } from '../lib/config.js';
import { getContext as defaultGetAuthContext } from '../lib/auth/index.js';
import { buildZapArgs, runZap as defaultRunZap } from '../lib/docker.js';
import { summarize } from '../lib/summarize.js';
import { aggregateTargets } from '../lib/targets-summary.js';
```

Replace with:

```javascript
import path from 'node:path';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadConfig, resolveTargets, readAuthCredentials } from '../lib/config.js';
import { getContext as defaultGetAuthContext } from '../lib/auth/index.js';
import { buildZapArgs, runZap as defaultRunZap } from '../lib/docker.js';
import { summarize } from '../lib/summarize.js';
import { aggregateTargets } from '../lib/targets-summary.js';
import { resolveSeedUrls as defaultResolveSeedUrls } from '../lib/seed-urls.js';
import { renderOpenApiYaml } from '../lib/scan-flavors/oauth-callback.js';
```

Find the `runScan` function's `deps` destructuring (around line 30-62 currently). Find the line `getAuthContext = defaultGetAuthContext,` and add the new injectable defaults:

```javascript
    getAuthContext = defaultGetAuthContext,
    mkdirOutput = async (envName, ts, targetName) => {
      const dir = path.join(process.cwd(), 'scan-output', envName, ts, targetName);
      await mkdir(dir, { recursive: true });
      return dir;
    },
    now = () => new Date().toISOString().replace(/[:.]/g, '-'),
```

Insert after `getAuthContext = defaultGetAuthContext,`:

```javascript
    getAuthContext = defaultGetAuthContext,
    resolveSeedUrls = defaultResolveSeedUrls,
    writeSeedFile = async (urls, runId) => {
      const tmpPath = path.join(tmpdir(), `casa-seeds-${runId}.txt`);
      await writeFile(tmpPath, urls.join('\n') + '\n', 'utf8');
      return tmpPath;
    },
    deleteSeedFile = (p) => unlink(p).catch(() => {}),
    writeOpenApiFile = async (yamlBody, runId) => {
      const tmpPath = path.join(tmpdir(), `casa-openapi-${runId}.yaml`);
      await writeFile(tmpPath, yamlBody, 'utf8');
      return tmpPath;
    },
    deleteOpenApiFile = (p) => unlink(p).catch(() => {}),
```

Now find the `runOneTarget` function. Find the body inside the `try` block:

```javascript
  try {
    outputDir = await mkdirOutput(env, timestamp, target.name);

    const { contextXml, scriptPath, replacerHeaders } = await getAuthContext({
      target,
      credentials,
      configsDir: CONFIGS_DIR,
      runId,
    });
    contextPath = await writeContext(contextXml, runId);

    const args = buildZapArgs({
      flavor,
      targetUrl: target.url,
      configsDir: CONFIGS_DIR,
      outputDir,
      contextPath,
      scriptPath,
      replacerHeaders,
      containerName: `casa-ready-${target.name}-${runId}`,
    });

    await runZap(args);
    // ...
```

Replace with:

```javascript
  let seedFilePath = null;
  let openApiPath = null;

  try {
    outputDir = await mkdirOutput(env, timestamp, target.name);

    const { contextXml, scriptPath, replacerHeaders } = await getAuthContext({
      target,
      credentials,
      configsDir: CONFIGS_DIR,
      runId,
    });
    contextPath = await writeContext(contextXml, runId);

    // Per-target scan flavor override — falls back to global --scan flag.
    const targetFlavor = target.scan ?? flavor;

    // For baseline/casa: resolve seed URLs and write to a temp file the
    // hook script will read. Skip for oauth-callback (uses synthetic OpenAPI).
    if (targetFlavor !== 'oauth-callback') {
      const seedUrls = await resolveSeedUrls(target);
      // Only mount/write if we actually have extras beyond target.url.
      if (seedUrls.length > 1) {
        seedFilePath = await writeSeedFile(seedUrls, runId);
      }
    }

    // For oauth-callback: synthesize the OpenAPI doc from callbackParams.
    if (targetFlavor === 'oauth-callback') {
      const yamlBody = renderOpenApiYaml({ url: target.url, params: target.callbackParams });
      openApiPath = await writeOpenApiFile(yamlBody, runId);
    }

    const args = buildZapArgs({
      flavor: targetFlavor,
      targetUrl: target.url,
      configsDir: CONFIGS_DIR,
      outputDir,
      contextPath,
      scriptPath,
      replacerHeaders,
      containerName: `casa-ready-${target.name}-${runId}`,
      seedFilePath,
      callbackParams: target.callbackParams,
      openApiPath,
    });

    await runZap(args);
    // ... (rest unchanged)
```

Find the `finally` block at the bottom of `runOneTarget`:

```javascript
  } finally {
    if (contextPath) {
      await deleteContext(contextPath);
    }
  }
```

Replace with:

```javascript
  } finally {
    if (contextPath) {
      await deleteContext(contextPath);
    }
    if (seedFilePath) {
      await deleteSeedFile(seedFilePath);
    }
    if (openApiPath) {
      await deleteOpenApiFile(openApiPath);
    }
  }
```

Find the function signature for `runOneTarget` near the top:

```javascript
async function runOneTarget({
  target,
  env,
  timestamp,
  credentials,
  runZap,
  readResultsJson,
  writeSummary,
  writeContext,
  deleteContext,
  getAuthContext,
  mkdirOutput,
  flavor,
}) {
```

Replace with:

```javascript
async function runOneTarget({
  target,
  env,
  timestamp,
  credentials,
  runZap,
  readResultsJson,
  writeSummary,
  writeContext,
  deleteContext,
  getAuthContext,
  resolveSeedUrls,
  writeSeedFile,
  deleteSeedFile,
  writeOpenApiFile,
  deleteOpenApiFile,
  mkdirOutput,
  flavor,
}) {
```

Find the call site that invokes `runOneTarget` (in the `for (const target of targets)` loop):

```javascript
    const result = await runOneTarget({
      target,
      env,
      timestamp,
      credentials,
      runZap,
      readResultsJson,
      writeSummary,
      writeContext,
      deleteContext,
      getAuthContext,
      mkdirOutput,
      flavor,
    });
```

Replace with:

```javascript
    const result = await runOneTarget({
      target,
      env,
      timestamp,
      credentials,
      runZap,
      readResultsJson,
      writeSummary,
      writeContext,
      deleteContext,
      getAuthContext,
      resolveSeedUrls,
      writeSeedFile,
      deleteSeedFile,
      writeOpenApiFile,
      deleteOpenApiFile,
      mkdirOutput,
      flavor,
    });
```

- [ ] **Step 4: Run the new test to verify pass**

Run: `npm test -- tests/commands/scan.test.js`

Expected: All scan tests pass (existing + new mixed-flavor test).

- [ ] **Step 5: Run the full suite**

Run: `npm test`

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add cli/commands/scan.js tests/commands/scan.test.js
git commit -m "feat(scan): per-target flavor + seed file write + OpenAPI synthesis

The orchestrator now resolves target.scan ?? opts.flavor, branches
output preparation:
- baseline/casa: resolve seedUrls, write seed-urls.txt to a temp file
  (only if there are extras beyond target.url), pass path to docker
- oauth-callback: render synthetic OpenAPI YAML from callbackParams,
  write to a temp file, pass path to docker

Cleanup of both temp files happens in the finally block alongside
context.xml cleanup."
```

---

## Task 9: Regenerate JSON Schema + TS types

**Responsibility:** `npm run build:schema` regenerates `schemas/casa-ready.schema.json` and `types/index.d.ts` from the updated Zod source. Hand-update `types/index.d.ts` for the new fields (the build script's TS output is hand-curated for discriminated unions).

**Files:**
- Modify: `schemas/casa-ready.schema.json` (auto-regenerated)
- Modify: `types/index.d.ts` (hand-edit for new fields)
- Modify: `scripts/build-schema.js` (update the d.ts output)

- [ ] **Step 1: Run the build script**

Run: `npm run build:schema`

Expected: `✓ wrote schemas/casa-ready.schema.json` and `✓ wrote types/index.d.ts`. The JSON schema picks up the new fields automatically. The TS types are hand-curated in `scripts/build-schema.js` and need a manual update.

- [ ] **Step 2: Update scripts/build-schema.js to include the new TS types**

Edit `scripts/build-schema.js`. Find the hand-crafted `dts` template literal:

```javascript
  const dts = `// Auto-generated by scripts/build-schema.js — do not edit by hand.
// The Zod schema in cli/lib/schema.js is the source of truth.

export interface CasaReadyConfig {
  app: string;
  envs: Record<string, Env>;
}

export interface Env {
  targets: Target[];
}

export interface Target {
  name: string;
  url: string;
  auth: FormAuth | SupabaseJwtAuth;
}

export interface FormAuth {
  type: 'form';
  loginUrl: string;
  loginRequestBody: string;
  usernameField: string;
  passwordField: string;
  loggedInIndicator: string;
}

export interface SupabaseJwtAuth {
  type: 'supabase-jwt';
  loginUrl: string;
  apiKey: string;
  refreshSeconds?: number;
}
`;
```

Replace with:

```javascript
  const dts = `// Auto-generated by scripts/build-schema.js — do not edit by hand.
// The Zod schema in cli/lib/schema.js is the source of truth.

export interface CasaReadyConfig {
  app: string;
  envs: Record<string, Env>;
}

export interface Env {
  targets: Target[];
}

export interface Target {
  name: string;
  url: string;
  auth: FormAuth | SupabaseJwtAuth | NoAuth;
  /** Explicit list of URLs to seed ZAP's spider with (in addition to target.url). */
  seedUrls?: string[];
  /** Path to a directory whose subdirectory names become seed URLs (Supabase shortcut). */
  seedDir?: string;
  /** Per-target scan flavor override; defaults to the global --scan flag. */
  scan?: 'casa' | 'baseline' | 'oauth-callback';
  /** Required when scan='oauth-callback'. Query params used as fuzz starting input. */
  callbackParams?: Record<string, string>;
}

export interface FormAuth {
  type: 'form';
  loginUrl: string;
  loginRequestBody: string;
  usernameField: string;
  passwordField: string;
  loggedInIndicator: string;
}

export interface SupabaseJwtAuth {
  type: 'supabase-jwt';
  loginUrl: string;
  apiKey: string;
  refreshSeconds?: number;
}

export interface NoAuth {
  type: 'none';
}
`;
```

- [ ] **Step 3: Re-run the build to regenerate types**

Run: `npm run build:schema`

Expected: Both files regenerated.

- [ ] **Step 4: Inspect the generated schema for the new fields**

Run: `grep -E "seedUrls|seedDir|callbackParams|none" schemas/casa-ready.schema.json | head -10`

Expected: Output includes lines mentioning `seedUrls`, `seedDir`, `callbackParams`, and the `none` enum value.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-schema.js schemas/casa-ready.schema.json types/index.d.ts
git commit -m "build(schema): regenerate JSON Schema + TS types for V2 fields

scripts/build-schema.js d.ts template updated to include seedUrls,
seedDir, scan, callbackParams (all optional) and the new NoAuth interface.
JSON Schema regenerated automatically from the Zod source."
```

---

## Task 10: Example config + integration smoke for oauth-callback

**Responsibility:** Update `casa-ready.yml.example` to show a 3rd target (oauth-callback). Add an integration smoke test against juice-shop's login endpoint that exercises the full oauth-callback path end-to-end (only runs with `RUN_INTEGRATION=1` + Docker + juice-shop on localhost).

**Files:**
- Modify: `casa-ready.yml.example`
- Modify: `tests/fixtures/multi-target-config.yml`
- Create: `tests/integration/oauth-callback-smoke.test.js`

- [ ] **Step 1: Update casa-ready.yml.example**

Edit `casa-ready.yml.example`. After the existing `api` target's block (the `supabase-jwt` one), add a third target. Find:

```yaml
      - name: api
        url: https://your-project-ref.supabase.co/functions/v1
        auth:
          type: supabase-jwt
          # Must contain /auth/v1/ — Supabase Auth REST endpoint
          loginUrl: https://your-project-ref.supabase.co/auth/v1/token?grant_type=password
          # Supabase project anon key (public). Inline the var name; do not
          # paste the literal key. The ${} is expanded from process.env at
          # scan time. casa-ready.yml itself stays safe to commit.
          apiKey: ${SUPABASE_ANON_KEY}

  prod:
    targets: []  # add prod targets here once staging is dialed in
```

Replace with:

```yaml
      - name: api
        url: https://your-project-ref.supabase.co/functions/v1
        auth:
          type: supabase-jwt
          # Must contain /auth/v1/ — Supabase Auth REST endpoint
          loginUrl: https://your-project-ref.supabase.co/auth/v1/token?grant_type=password
          # Supabase project anon key (public). Inline the var name; do not
          # paste the literal key. The ${} is expanded from process.env at
          # scan time. casa-ready.yml itself stays safe to commit.
          apiKey: ${SUPABASE_ANON_KEY}
        # OPTIONAL (V2 / v0.4.0+): Supabase shortcut — globs subdirs of this
        # path and seeds ZAP's spider with each subdir name appended to
        # target.url. For Magpipe-style apps this single line covers all
        # Edge Functions in one go (otherwise the spider can't find them
        # because Supabase has no directory listing).
        seedDir: ./supabase/functions
        # OPTIONAL (V2 / v0.4.0+): explicit additional seed URLs for routes
        # outside seedDir's coverage. Either full URLs or paths.
        seedUrls:
          - /functions/v1/legacy-route

      # OPTIONAL (V2 / v0.4.0+): OAuth callback active scan target.
      # Set scan: oauth-callback to invoke ZAP's active scanner against a
      # synthetic OpenAPI doc generated from callbackParams. ZAP mutates
      # the example values looking for SQL injection in state/code, XSS in
      # error messages, open-redirect via redirect_uri, info leaks, etc.
      #
      # callbackParams values do NOT need to be valid Google credentials.
      # ZAP fuzzes them — they're just starting input for mutation.
      - name: oauth-callback
        url: https://your-app.example/auth/google/callback
        auth: { type: none }   # public endpoint — Google's redirect arrives unauthenticated
        scan: oauth-callback
        callbackParams:
          state: test-state-token
          code: test-authorization-code
          redirect_uri: https://your-app.example/dashboard

  prod:
    targets: []  # add prod targets here once staging is dialed in
```

- [ ] **Step 2: Update tests/fixtures/multi-target-config.yml**

Edit `tests/fixtures/multi-target-config.yml`. Add a third target after the existing two. Find:

```yaml
      - name: api
        url: https://x.supabase.co/functions/v1
        auth:
          type: supabase-jwt
          loginUrl: https://x.supabase.co/auth/v1/token?grant_type=password
          apiKey: public-anon-key-here
          refreshSeconds: 3300
```

Append after it (still inside `targets:`, same indentation):

```yaml

      - name: oauth-callback
        url: https://staging.example.com/auth/google/callback
        auth:
          type: none
        scan: oauth-callback
        callbackParams:
          state: test-state
          code: test-code
          redirect_uri: https://staging.example.com/dashboard
```

- [ ] **Step 3: Run the existing config tests to confirm fixture still loads**

Run: `npm test -- tests/lib/config.test.js`

Expected: All config tests pass (the fixture now has 3 targets but the existing assertions check `targets[0]` and `targets[1]` by name, which still work).

- [ ] **Step 4: Update the resolveTargets test that checks target count**

Edit `tests/lib/config.test.js`. Find:

```javascript
  it('returns all targets for a known env', async () => {
    const config = await loadConfig(fixturePath);
    const targets = resolveTargets(config, 'staging');
    expect(targets).toHaveLength(2);
    expect(targets.map((t) => t.name)).toEqual(['spa', 'api']);
  });
```

Replace with:

```javascript
  it('returns all targets for a known env', async () => {
    const config = await loadConfig(fixturePath);
    const targets = resolveTargets(config, 'staging');
    expect(targets).toHaveLength(3);
    expect(targets.map((t) => t.name)).toEqual(['spa', 'api', 'oauth-callback']);
  });
```

Find the related `'throws when filter target name does not exist'` test and update its expected error to include the third target:

```javascript
  it('throws when filter target name does not exist', async () => {
    const config = await loadConfig(fixturePath);
    expect(() => resolveTargets(config, 'staging', 'nope')).toThrow(
      /target.*nope.*not found.*spa.*api.*oauth-callback/i
    );
  });
```

- [ ] **Step 5: Create the integration smoke test**

Create `tests/integration/oauth-callback-smoke.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { runScan } from '../../cli/commands/scan.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const RUN = process.env.RUN_INTEGRATION === '1';

describe.skipIf(!RUN)('oauth-callback flavor (integration)', () => {
  it('produces ZAP artifacts for an oauth-callback target', async () => {
    // Build a single-target oauth-callback config pointing at juice-shop's
    // login endpoint. juice-shop accepts random query params and returns
    // useful errors, which exercises the full zap-api-scan flow without
    // needing a real OAuth provider.
    const tmpDir = await mkdir(path.join(tmpdir(), 'casa-oauth-smoke-' + Date.now()), {
      recursive: true,
    });
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
        callbackParams:
          email: test@x.com
          password: test
`,
      'utf8'
    );

    // Required for the orchestrator (even though oauth-callback skips the
    // form-auth login flow — the readAuthCredentials check is unconditional).
    process.env.CASA_READY_USER = 'unused';
    process.env.CASA_READY_PASS = 'unused';

    try {
      const result = await runScan({
        configPath: ymlPath,
        env: 'staging',
        confirmProd: false,
      });
      // ZAP exit codes 0-3 all mean "scan completed" (1-3 = found things).
      // We don't care WHAT it found here — only that the artifact files exist.
      expect(result.exitCode).toBeOneOf([0, 1]);
      const targetDir = path.join(result.outputDir, 'callback');
      const summary = await readFile(path.join(targetDir, 'summary.md'), 'utf8');
      expect(summary).toContain('# CASA Ready Scan Summary');
    } finally {
      delete process.env.CASA_READY_USER;
      delete process.env.CASA_READY_PASS;
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 600_000); // 10 minute timeout — active scan can take a while
});
```

- [ ] **Step 6: Run unit tests + skipped integration test**

Run: `npm test`

Expected: All unit tests pass. Integration test reports as skipped (because `RUN_INTEGRATION` is not set).

- [ ] **Step 7: Commit**

```bash
git add casa-ready.yml.example tests/fixtures/multi-target-config.yml tests/lib/config.test.js tests/integration/oauth-callback-smoke.test.js
git commit -m "docs+test: example yml + integration smoke for oauth-callback

casa-ready.yml.example now shows the seedDir+seedUrls Supabase pattern
and a third target with scan: oauth-callback. Inline comments call out
that callbackParams are fuzz inputs (not valid Google creds) and that
seedDir is the one-line Supabase shortcut.

multi-target-config.yml fixture grows to 3 targets exercising form +
supabase-jwt + oauth-callback in the loader/resolver tests.

Integration smoke is gated on RUN_INTEGRATION=1 (same convention as the
existing juice-shop smoke). It points at juice-shop's /rest/user/login
which accepts arbitrary query params, proving the zap-api-scan + active
scanner flow works end-to-end without needing a real OAuth provider."
```

---

## Task 11: README + MIGRATION + CHANGELOG + CONTRIBUTING + bump 0.4.0

**Responsibility:** Documentation deltas + version bump. No code changes.

**Files:**
- Modify: `README.md`
- Modify: `MIGRATION.md`
- Modify: `CHANGELOG.md`
- Modify: `CONTRIBUTING.md`
- Modify: `package.json`
- Modify: `package-lock.json` (auto)
- Modify: `website/src/pages/index.astro` (roadmap row)

- [ ] **Step 1: Bump package.json**

Edit `package.json`. Find:

```json
  "version": "0.3.1",
```

Replace with:

```json
  "version": "0.4.0",
```

- [ ] **Step 2: Sync package-lock.json**

Run: `npm install`

Expected: `package-lock.json` updates the version to 0.4.0.

- [ ] **Step 3: Add 0.4.0 entry to CHANGELOG.md**

Edit `CHANGELOG.md`. Find:

```markdown
## [0.3.1] — 2026-05-01
```

Insert above it:

```markdown
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

```

- [ ] **Step 4: Update README**

Edit `README.md`. Find the Status line:

```markdown
**Status:** V1.2 (`v0.3.0`) — YAML config, `init` command, JSON Schema for IDE autocomplete. Built in the open while passing CASA for [Magpipe](https://magpipe.ai).
```

Replace with:

```markdown
**Status:** V2 (`v0.4.0`) — endpoint seeding (`seedDir`/`seedUrls`) + OAuth callback active-scanning. Built in the open while passing CASA for [Magpipe](https://magpipe.ai).
```

Find the Roadmap table. Find the V1.2 row:

```markdown
| **V1.2** ✓ | YAML config + `init` command + JSON Schema + TS types — OSS launch quality | Shipped 2026-05-01 in `v0.3.0` |
| **V2** | Authenticated scan: ZAP context with session replay + OAuth flows | V1.1 ships + TAC findings reveal coverage gaps anonymous scans can't catch |
```

Replace with:

```markdown
| **V1.2** ✓ | YAML config + `init` command + JSON Schema + TS types — OSS launch quality | Shipped 2026-05-01 in `v0.3.0` |
| **V2** ✓ | Endpoint seeding (`seedDir`/`seedUrls`) + OAuth callback active-scanning | Shipped 2026-05-XX in `v0.4.0` |
```

Find the "Migrating from v0.2.x → v0.3.0" section. Add a new section right after it:

```markdown
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

For OAuth callback security testing, add a third target with `scan: oauth-callback` — see the example in `casa-ready.yml.example` and the [V2 design spec](./docs/superpowers/specs/2026-05-01-v2-authenticated-oauth-scan-design.md) for the rationale.
```

- [ ] **Step 5: Update MIGRATION.md**

Edit `MIGRATION.md`. Find the heading `## v0.2.x → v0.3.0` and insert above it:

```markdown
## v0.3.x → v0.4.0

Fully backward-compatible. All v0.3.x configs work unchanged. New optional target fields:

| Field | Purpose |
|---|---|
| `seedUrls: [...]` | Explicit URLs to seed ZAP's spider with (full URLs or paths). |
| `seedDir: ./supabase/functions` | Supabase shortcut. Globs subdirs of the path; each subdir name becomes a seed URL. |
| `scan: oauth-callback` | Per-target scan flavor for OAuth callback handlers. Requires `callbackParams` and `auth.type: none`. |
| `auth: { type: none }` | For genuinely public endpoints (callback handlers, marketing pages). Skips login. |
| `callbackParams: {...}` | Required when `scan: oauth-callback`. Query params used as fuzz starting input. |

Magpipe-style minimal upgrade — add one line to your existing `api` target:

```yaml
- name: api
  url: https://x.supabase.co/functions/v1
  auth: { type: supabase-jwt, ... }
  seedDir: ./supabase/functions   # ← add this
```

ZAP now discovers all your Edge Functions instead of hitting only the directory-listing-less root.

---

```

- [ ] **Step 6: Update CONTRIBUTING.md**

Edit `CONTRIBUTING.md`. Find the "How to add a new auth type" section. Insert a new section after it:

```markdown
### Adding a new scan flavor

The path mirrors auth types — the dispatcher in `cli/lib/scan-flavors/index.js` maps flavor names to per-flavor adapter modules:

1. Add the flavor to the `ScanFlavorSchema` enum in `cli/lib/schema.js`.
2. Add cross-field rules to `TargetSchema.superRefine` if the flavor requires specific other fields (e.g. `oauth-callback` requires `callbackParams` and `auth.type: none`).
3. Create `cli/lib/scan-flavors/<flavor>.js` exporting `buildArgs(opts)` that returns a docker argv.
4. Register it in `cli/lib/scan-flavors/index.js`'s `FLAVORS` map.
5. Add tests at `tests/lib/scan-flavors/<flavor>.test.js`.
6. If the flavor uses a different ZAP wrapper script (`zap-baseline.py` vs `zap-api-scan.py` vs the GraphQL one), look at `cli/lib/scan-flavors/oauth-callback.js` for how to mount the spec file and pass `-f` etc.
7. Update README + CHANGELOG.

The JSON Schema and TS types regenerate from step 1 — no manual edits to `schemas/` (but `types/index.d.ts`'s union may need a hand-update in `scripts/build-schema.js`).
```

- [ ] **Step 7: Update website roadmap row**

Edit `website/src/pages/index.astro`. Find:

```html
            <tr>
              <td>V1.2</td>
              <td>YAML config + <code>init</code> command + JSON Schema + TS types</td>
              <td class="shipped">Shipped May 1, 2026 &mdash; v0.3.0</td>
            </tr>
            <tr>
              <td>V2</td>
              <td>Authenticated OAuth flow scanning (Gmail-restricted user paths)</td>
              <td>Next, after a soak window on V1.2</td>
            </tr>
```

Replace with:

```html
            <tr>
              <td>V1.2</td>
              <td>YAML config + <code>init</code> command + JSON Schema + TS types</td>
              <td class="shipped">Shipped May 1, 2026 &mdash; v0.3.0</td>
            </tr>
            <tr>
              <td>V2</td>
              <td>Endpoint seeding (<code>seedDir</code>/<code>seedUrls</code>) + OAuth callback active-scanning</td>
              <td class="shipped">Shipped May XX, 2026 &mdash; v0.4.0</td>
            </tr>
```

- [ ] **Step 8: Verify build still passes**

Run: `cd website && npm run build && cd ..`

Expected: 2 pages built, no errors.

- [ ] **Step 9: Run the full suite one more time**

Run: `npm test`

Expected: All tests pass.

- [ ] **Step 10: Commit**

```bash
git add README.md MIGRATION.md CHANGELOG.md CONTRIBUTING.md package.json package-lock.json website/src/pages/index.astro
git commit -m "docs: V2 README + MIGRATION + CHANGELOG + CONTRIBUTING + bump 0.4.0

- README: status line + Roadmap V2 ✓ row + new 'v0.3.x → v0.4.0' migration section
- MIGRATION.md: full v0.3.x → v0.4.0 section with the one-line Supabase upgrade
- CHANGELOG: 0.4.0 entry covers all 5 user-facing additions + the
  scan-flavors refactor + architecture rationale (why no Playwright)
- CONTRIBUTING: new 'Adding a new scan flavor' section mirrors the
  existing 'Adding a new auth type' shape
- Website roadmap row updated to ✓
- package.json bumped 0.3.1 → 0.4.0; lockfile synced"
```

---

## Task 12: Tag v0.4.0

- [ ] **Step 1: Verify clean tree + tests pass + build is fresh**

```bash
git status                       # working tree clean
npm test                         # all green
npm run build:schema             # idempotent — should be no-op since Task 9
```

- [ ] **Step 2: Create the annotated tag**

```bash
git tag -a v0.4.0 -m "V2: endpoint seeding + OAuth callback active-scanning"
git log --oneline -5
git tag -l v0.4.0
```

(Don't push the tag yet — that happens after the PR merges to main, so the tag lands on the actual merge commit. The controller / human handles the merge → re-tag → push flow per the v0.3.0 / v0.3.1 pattern.)

---

## Self-Review

(Run by the plan author after writing — checklist, not subagent dispatch.)

**1. Spec coverage:**

| Spec section | Implementing task |
|---|---|
| Schema additions (seedUrls, seedDir, scan, callbackParams, NoAuthSchema, cross-field rules) | Task 1 ✓ |
| `cli/lib/seed-urls.js` | Task 2 ✓ |
| `cli/lib/auth/none.js` + template + dispatcher registration | Task 3 ✓ |
| `cli/lib/scan-flavors/{baseline,casa}.js` extraction | Task 4 ✓ |
| `cli/lib/docker.js` refactor to delegate | Task 5 ✓ |
| `configs/zap/seed-spider-hook.py` | Task 6 ✓ |
| `cli/lib/scan-flavors/oauth-callback.js` + synthetic OpenAPI | Task 7 ✓ |
| `cli/commands/scan.js` orchestrator wiring (per-target flavor + temp file mgmt) | Task 8 ✓ |
| Schema + types regeneration | Task 9 ✓ |
| `casa-ready.yml.example` + integration smoke | Task 10 ✓ |
| README + MIGRATION + CHANGELOG + CONTRIBUTING + version bump | Task 11 ✓ |
| Tag v0.4.0 | Task 12 ✓ |

No spec gaps.

**2. Placeholder scan:** No "TBD", no "implement later", no "add error handling", no "similar to Task N", no "fill in details". Every test has actual code; every implementation has actual code; every command has expected output.

**3. Type / signature consistency:**
- `resolveSeedUrls(target, cwd)` — same shape across seed-urls.js implementation, tests (Task 2), and orchestrator usage (Task 8). ✓
- `scanFlavors[flavor].buildArgs(opts)` — same signature in baseline.js, casa.js, oauth-callback.js. Index.js dispatcher returns the result. ✓
- `buildZapArgs(opts)` — adds `seedFilePath`, `callbackParams`, `openApiPath` to the existing signature; backward-compat preserved (all optional). ✓
- `getContext({ target, credentials, configsDir, runId })` — `none.js` implements the same shape as `form.js`/`supabase-jwt.js` (note: `none` ignores credentials). ✓
- `runOneTarget` injectable defaults — added `resolveSeedUrls`, `writeSeedFile`, `deleteSeedFile`, `writeOpenApiFile`, `deleteOpenApiFile` consistently to both the destructure and the call site (Task 8). ✓
- Field name `callbackParams` consistent across schema (Task 1), oauth-callback flavor (Task 7), orchestrator (Task 8), tests (Tasks 1, 7, 8, 10), and YAML examples (Task 10). ✓

No drift.

---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-05-01-v2-authenticated-oauth-scan.md`. Two execution options:

**1. Subagent-Driven (recommended for new feature areas)** — I dispatch a fresh subagent per task, two-stage review (spec compliance + code quality) between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session via `superpowers:executing-plans`, batch execution with checkpoints.

For V2 specifically, **inline execution is reasonable** — the plan is well-spec'd, I have full context from this session (which just landed v0.3.1 + the website + the spec), and the V1.2 plan executed inline went smoothly through 11 similar tasks. Subagent-driven is the right choice if I'd been off the project for a while.
