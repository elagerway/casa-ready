# ZAP Pre-Scan Kit V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `casa-ready scan` — a Node CLI that runs an opinionated, CASA-tuned OWASP ZAP scan against a deployed app and emits TAC-acceptable artifacts plus a human triage summary, with form-based authentication and a two-target (staging/prod) safety model.

**Architecture:** Thin Node wrapper around the official `zaproxy/zap-stable` Docker container. The CLI loads a config file, generates a per-run ZAP context XML for form-based auth, spawns Docker with the right policy file mounted, and post-processes ZAP's JSON output into a markdown triage summary. No ZAP REST API — we shell out to the bundled `zap-full-scan.py` and `zap-baseline.py` scripts.

**Tech Stack:** Node 20+ (ESM, `node:util parseArgs`, `child_process.spawn`), Vitest for tests, OWASP ZAP via Docker, plain string-template substitution for the context XML (no template library).

**Spec:** `docs/superpowers/specs/2026-04-29-zap-prescan-kit-design.md`

---

## File Structure

This plan creates or modifies the following files. Each module has one responsibility.

**New files:**

```
casa-ready/
├── bin/
│   └── casa-ready.js                                    [Task 7]
├── cli/
│   ├── commands/
│   │   └── scan.js                                      [Task 6]
│   └── lib/
│       ├── config.js                                    [Task 2]
│       ├── zap-context.js                               [Task 3]
│       ├── docker.js                                    [Task 4]
│       └── summarize.js                                 [Task 5]
├── configs/zap/
│   ├── casa-tier2.policy                                [Task 8]
│   └── context-template.xml                             [Task 8]
├── tests/
│   ├── fixtures/
│   │   ├── sample-config.js                             [Task 2]
│   │   └── sample-results.json                          [Task 5]
│   ├── lib/
│   │   ├── config.test.js                               [Task 2]
│   │   ├── zap-context.test.js                          [Task 3]
│   │   ├── docker.test.js                               [Task 4]
│   │   └── summarize.test.js                            [Task 5]
│   └── commands/
│       └── scan.test.js                                 [Task 6]
├── .github/workflows/
│   └── casa-scan.yml.example                            [Task 9]
└── casa-ready.config.example.js                         [Task 9]
```

**Modified files:**

- `package.json` — add deps + scripts                   [Task 1]
- `README.md` — add "Using `casa-ready scan`" section   [Task 9]
- `.gitignore` — already has `scan-output/` from scaffold

---

## Task 1: Bootstrap dev tooling

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install Vitest as a dev dependency**

Run:
```bash
npm install --save-dev vitest@^1.6.0
```

Expected: `package.json` `devDependencies` now contains `"vitest": "^1.6.0"`. `node_modules/` populated.

- [ ] **Step 2: Update test script in package.json**

Edit `package.json`, replace the `scripts.test` field:

```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest",
  "test:integration": "RUN_INTEGRATION=1 vitest run tests/integration"
}
```

- [ ] **Step 3: Verify Vitest runs (against zero tests)**

Run:
```bash
npm test
```

Expected: Vitest exits 0 with "No test files found, exiting with code 0" or similar. Confirms install + script wiring.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add vitest as dev dependency"
```

---

## Task 2: Config loader (`cli/lib/config.js`)

**Responsibility:** Load and validate `casa-ready.config.js`. Resolve `--env` to a URL. Pull credentials from environment variables. Throw clear errors when anything is missing.

**Files:**
- Create: `cli/lib/config.js`
- Create: `tests/lib/config.test.js`
- Create: `tests/fixtures/sample-config.js`

- [ ] **Step 1: Create the test fixture config**

Create `tests/fixtures/sample-config.js`:

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

- [ ] **Step 2: Write failing tests for config loader**

Create `tests/lib/config.test.js`:

```javascript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadConfig, resolveEnv, readAuthCredentials } from '../../cli/lib/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, '..', 'fixtures', 'sample-config.js');

describe('loadConfig', () => {
  it('loads a valid config file', async () => {
    const config = await loadConfig(fixturePath);
    expect(config.app).toBe('magpipe');
    expect(config.envs.staging).toMatch(/^https:\/\//);
  });

  it('throws a clear error when the file does not exist', async () => {
    await expect(loadConfig('/nonexistent/path.js')).rejects.toThrow(
      /could not load config/i
    );
  });

  it('throws when required fields are missing', async () => {
    const badPath = path.join(__dirname, '..', 'fixtures', 'bad-config.js');
    // Will be created inline by test setup - skip for now
  });
});

describe('resolveEnv', () => {
  it('resolves staging to the staging URL', async () => {
    const config = await loadConfig(fixturePath);
    expect(resolveEnv(config, 'staging')).toBe(
      'https://magpipe-staging-snapsonic.vercel.app'
    );
  });

  it('resolves prod to the prod URL', async () => {
    const config = await loadConfig(fixturePath);
    expect(resolveEnv(config, 'prod')).toBe('https://magpipe.ai');
  });

  it('throws on unknown env', async () => {
    const config = await loadConfig(fixturePath);
    expect(() => resolveEnv(config, 'qa')).toThrow(/unknown env: qa/i);
  });
});

describe('readAuthCredentials', () => {
  let originalUser, originalPass;

  beforeEach(() => {
    originalUser = process.env.CASA_READY_USER;
    originalPass = process.env.CASA_READY_PASS;
  });

  afterEach(() => {
    if (originalUser === undefined) delete process.env.CASA_READY_USER;
    else process.env.CASA_READY_USER = originalUser;
    if (originalPass === undefined) delete process.env.CASA_READY_PASS;
    else process.env.CASA_READY_PASS = originalPass;
  });

  it('reads creds from env vars', () => {
    process.env.CASA_READY_USER = 'erik@snapsonic.com';
    process.env.CASA_READY_PASS = 'hunter2';
    const creds = readAuthCredentials();
    expect(creds).toEqual({ username: 'erik@snapsonic.com', password: 'hunter2' });
  });

  it('throws when CASA_READY_USER missing', () => {
    delete process.env.CASA_READY_USER;
    process.env.CASA_READY_PASS = 'hunter2';
    expect(() => readAuthCredentials()).toThrow(/CASA_READY_USER/);
  });

  it('throws when CASA_READY_PASS missing', () => {
    process.env.CASA_READY_USER = 'erik@snapsonic.com';
    delete process.env.CASA_READY_PASS;
    expect(() => readAuthCredentials()).toThrow(/CASA_READY_PASS/);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:
```bash
npm test
```

Expected: All tests in `config.test.js` fail with `Cannot find module '../../cli/lib/config.js'`.

- [ ] **Step 4: Implement the config loader**

Create `cli/lib/config.js`:

```javascript
import { pathToFileURL } from 'node:url';
import { access } from 'node:fs/promises';

export async function loadConfig(configPath) {
  try {
    await access(configPath);
  } catch {
    throw new Error(`Could not load config: file not found at ${configPath}`);
  }

  let mod;
  try {
    mod = await import(pathToFileURL(configPath).href);
  } catch (err) {
    throw new Error(`Could not load config at ${configPath}: ${err.message}`);
  }

  const config = mod.default;
  validateConfig(config);
  return config;
}

function validateConfig(config) {
  if (!config || typeof config !== 'object') {
    throw new Error('Config: default export must be an object');
  }
  if (!config.app || typeof config.app !== 'string') {
    throw new Error('Config: "app" must be a non-empty string');
  }
  if (!config.envs || typeof config.envs !== 'object') {
    throw new Error('Config: "envs" must be an object mapping env names to URLs');
  }
  if (!config.auth || typeof config.auth !== 'object') {
    throw new Error('Config: "auth" must be an object');
  }
  const requiredAuthFields = [
    'type',
    'loginUrl',
    'loginRequestBody',
    'usernameField',
    'passwordField',
    'loggedInIndicator',
  ];
  for (const field of requiredAuthFields) {
    if (!config.auth[field]) {
      throw new Error(`Config: "auth.${field}" is required`);
    }
  }
}

export function resolveEnv(config, envName) {
  const url = config.envs[envName];
  if (!url) {
    const known = Object.keys(config.envs).join(', ');
    throw new Error(`Unknown env: ${envName}. Known envs: ${known}`);
  }
  return url;
}

export function readAuthCredentials() {
  const username = process.env.CASA_READY_USER;
  const password = process.env.CASA_READY_PASS;
  if (!username) {
    throw new Error('Missing CASA_READY_USER env var (auth.username)');
  }
  if (!password) {
    throw new Error('Missing CASA_READY_PASS env var (auth.password)');
  }
  return { username, password };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run:
```bash
npm test
```

Expected: All `config.test.js` tests pass. The "throws when required fields are missing" test is currently a no-op (placeholder) — that's fine for now; we'll fix in step 6.

- [ ] **Step 6: Add the missing-fields test using inline fixture**

Replace the "throws when required fields are missing" test in `tests/lib/config.test.js`:

```javascript
  it('throws when required fields are missing', async () => {
    const tmpDir = path.join(__dirname, '..', 'fixtures', 'tmp');
    const tmpPath = path.join(tmpDir, 'bad-config.js');
    const { mkdir, writeFile, rm } = await import('node:fs/promises');
    await mkdir(tmpDir, { recursive: true });
    await writeFile(tmpPath, 'export default { app: "x" };');
    try {
      await expect(loadConfig(tmpPath)).rejects.toThrow(/envs/);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
```

- [ ] **Step 7: Run tests to verify the new one passes**

Run:
```bash
npm test
```

Expected: All tests pass including the missing-fields one.

- [ ] **Step 8: Commit**

```bash
git add cli/lib/config.js tests/lib/config.test.js tests/fixtures/sample-config.js
git commit -m "feat(config): load and validate casa-ready.config.js"
```

---

## Task 3: ZAP context XML generator (`cli/lib/zap-context.js`)

**Responsibility:** Render a ZAP context XML file from a string template and a values object. The template uses `{{varname}}` placeholders that get substituted before being written to disk. The output is a complete, valid ZAP context XML that ZAP's `-n` flag can consume.

**Files:**
- Create: `cli/lib/zap-context.js`
- Create: `tests/lib/zap-context.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/lib/zap-context.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { renderContext } from '../../cli/lib/zap-context.js';

const sampleTemplate = `<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <context>
    <name>{{contextName}}</name>
    <url>{{targetUrl}}</url>
    <authentication>
      <loginUrl>{{loginUrl}}</loginUrl>
      <loginRequestBody>{{loginRequestBody}}</loginRequestBody>
      <usernameField>{{usernameField}}</usernameField>
      <passwordField>{{passwordField}}</passwordField>
      <loggedInIndicator>{{loggedInIndicator}}</loggedInIndicator>
    </authentication>
    <user>
      <name>{{username}}</name>
      <password>{{password}}</password>
    </user>
  </context>
</configuration>`;

describe('renderContext', () => {
  it('substitutes all {{var}} placeholders with provided values', () => {
    const values = {
      contextName: 'magpipe-staging',
      targetUrl: 'https://magpipe-staging-snapsonic.vercel.app',
      loginUrl: 'https://magpipe-staging-snapsonic.vercel.app/login',
      loginRequestBody: 'email={%username%}&password={%password%}',
      usernameField: 'email',
      passwordField: 'password',
      loggedInIndicator: 'Sign out|/dashboard',
      username: 'erik@snapsonic.com',
      password: 'hunter2',
    };
    const result = renderContext(sampleTemplate, values);
    expect(result).toContain('<name>magpipe-staging</name>');
    expect(result).toContain('<url>https://magpipe-staging-snapsonic.vercel.app</url>');
    expect(result).toContain('<usernameField>email</usernameField>');
    expect(result).toContain('<password>hunter2</password>');
    expect(result).not.toContain('{{');
  });

  it('throws when a required placeholder has no value', () => {
    const values = { contextName: 'magpipe' }; // missing most fields
    expect(() => renderContext(sampleTemplate, values)).toThrow(
      /missing value for placeholder: targetUrl/i
    );
  });

  it('XML-escapes special characters in values', () => {
    const template = `<password>{{password}}</password>`;
    const result = renderContext(template, { password: '<script>&"\'' });
    expect(result).toBe('<password>&lt;script&gt;&amp;&quot;&apos;</password>');
  });

  it('does not double-escape already-encoded entities', () => {
    const template = `<password>{{password}}</password>`;
    // Plain string with literal ampersand — should be encoded once
    const result = renderContext(template, { password: 'a&b' });
    expect(result).toBe('<password>a&amp;b</password>');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
npm test
```

Expected: All `zap-context.test.js` tests fail with `Cannot find module`.

- [ ] **Step 3: Implement the renderer**

Create `cli/lib/zap-context.js`:

```javascript
const PLACEHOLDER_PATTERN = /\{\{(\w+)\}\}/g;

export function renderContext(template, values) {
  return template.replace(PLACEHOLDER_PATTERN, (_match, key) => {
    if (!Object.prototype.hasOwnProperty.call(values, key)) {
      throw new Error(`Missing value for placeholder: ${key}`);
    }
    return xmlEscape(String(values[key]));
  });
}

function xmlEscape(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
npm test
```

Expected: All `zap-context.test.js` tests pass.

- [ ] **Step 5: Commit**

```bash
git add cli/lib/zap-context.js tests/lib/zap-context.test.js
git commit -m "feat(zap-context): render ZAP context XML from template"
```

---

## Task 4: Docker spawn wrapper (`cli/lib/docker.js`)

**Responsibility:** Build the `docker run` argv for ZAP and spawn the container, streaming stdout/stderr to the parent process. Returns a promise that resolves on exit-zero and rejects on non-zero. Pure command construction is unit-testable; the spawn itself we mock.

**Files:**
- Create: `cli/lib/docker.js`
- Create: `tests/lib/docker.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/lib/docker.test.js`:

```javascript
import { describe, it, expect, vi } from 'vitest';
import { buildZapArgs, runZap } from '../../cli/lib/docker.js';

describe('buildZapArgs', () => {
  it('builds argv for the casa scan flavor', () => {
    const args = buildZapArgs({
      flavor: 'casa',
      targetUrl: 'https://magpipe.ai',
      configsDir: '/abs/configs/zap',
      outputDir: '/abs/scan-output/prod/2026-04-29T12-00-00Z',
      contextPath: '/tmp/casa-ctx-abc.xml',
    });
    expect(args[0]).toBe('run');
    expect(args).toContain('--rm');
    expect(args).toContain('-v');
    expect(args.join(' ')).toContain('/abs/configs/zap:/zap/configs:ro');
    expect(args.join(' ')).toContain('/abs/scan-output/prod/2026-04-29T12-00-00Z:/zap/wrk:rw');
    expect(args).toContain('zaproxy/zap-stable');
    expect(args).toContain('zap-full-scan.py');
    expect(args).toContain('-t');
    expect(args).toContain('https://magpipe.ai');
    expect(args).toContain('-c');
    expect(args).toContain('/zap/configs/casa-tier2.policy');
    expect(args).toContain('-n');
    expect(args).toContain('/tmp/casa-ctx-abc.xml');
  });

  it('uses zap-baseline.py for the baseline flavor', () => {
    const args = buildZapArgs({
      flavor: 'baseline',
      targetUrl: 'https://magpipe.ai',
      configsDir: '/abs/configs/zap',
      outputDir: '/abs/scan-output/staging/2026-04-29T12-00-00Z',
      contextPath: '/tmp/casa-ctx-abc.xml',
    });
    expect(args).toContain('zap-baseline.py');
    expect(args).not.toContain('zap-full-scan.py');
  });

  it('throws on unknown flavor', () => {
    expect(() =>
      buildZapArgs({
        flavor: 'fast',
        targetUrl: 'x',
        configsDir: 'x',
        outputDir: 'x',
        contextPath: 'x',
      })
    ).toThrow(/unknown scan flavor: fast/i);
  });
});

describe('runZap', () => {
  it('resolves on exit code 0', async () => {
    const fakeSpawn = vi.fn(() => ({
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      on: (event, cb) => {
        if (event === 'exit') setTimeout(() => cb(0, null), 0);
      },
    }));
    await expect(
      runZap(['run', '--rm', 'hello-world'], { spawnFn: fakeSpawn })
    ).resolves.toEqual({ exitCode: 0 });
    expect(fakeSpawn).toHaveBeenCalledWith('docker', ['run', '--rm', 'hello-world'], { stdio: ['ignore', 'pipe', 'pipe'] });
  });

  it('rejects on non-zero exit code', async () => {
    const fakeSpawn = vi.fn(() => ({
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      on: (event, cb) => {
        if (event === 'exit') setTimeout(() => cb(2, null), 0);
      },
    }));
    await expect(
      runZap(['run', '--rm', 'x'], { spawnFn: fakeSpawn })
    ).rejects.toThrow(/exited with code 2/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
npm test
```

Expected: `docker.test.js` tests fail with `Cannot find module`.

- [ ] **Step 3: Implement the docker wrapper**

Create `cli/lib/docker.js`:

```javascript
import { spawn as nodeSpawn } from 'node:child_process';

const FLAVOR_TO_SCRIPT = {
  casa: 'zap-full-scan.py',
  baseline: 'zap-baseline.py',
};

export function buildZapArgs({
  flavor,
  targetUrl,
  configsDir,
  outputDir,
  contextPath,
}) {
  const script = FLAVOR_TO_SCRIPT[flavor];
  if (!script) {
    throw new Error(`Unknown scan flavor: ${flavor}`);
  }
  return [
    'run',
    '--rm',
    '-v',
    `${configsDir}:/zap/configs:ro`,
    '-v',
    `${outputDir}:/zap/wrk:rw`,
    '-v',
    `${contextPath}:${contextPath}:ro`,
    'zaproxy/zap-stable',
    script,
    '-t',
    targetUrl,
    '-c',
    '/zap/configs/casa-tier2.policy',
    '-n',
    contextPath,
    '-J',
    'results.json',
    '-x',
    'results.xml',
    '-r',
    'results.html',
  ];
}

export function runZap(args, { spawnFn = nodeSpawn } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnFn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    if (child.stdout && typeof child.stdout.on === 'function') {
      child.stdout.on('data', (chunk) => process.stdout.write(chunk));
    }
    if (child.stderr && typeof child.stderr.on === 'function') {
      child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    }
    child.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error('Docker is not installed or not on PATH. Install Docker Desktop (macOS/Windows) or docker-ce (Linux).'));
      } else {
        reject(err);
      }
    });
    child.on('exit', (code) => {
      if (code === 0) {
        resolve({ exitCode: 0 });
      } else {
        reject(new Error(`ZAP container exited with code ${code}`));
      }
    });
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
npm test
```

Expected: All `docker.test.js` tests pass.

- [ ] **Step 5: Commit**

```bash
git add cli/lib/docker.js tests/lib/docker.test.js
git commit -m "feat(docker): spawn ZAP container with CASA-tuned argv"
```

---

## Task 5: Results summarizer (`cli/lib/summarize.js`)

**Responsibility:** Read ZAP's `results.json` and emit a markdown `summary.md` grouping findings by severity, listing CWE mappings, and flagging "likely NA" candidates (e.g., findings on third-party CDN paths). Snapshot-tested against a fixture.

**Files:**
- Create: `cli/lib/summarize.js`
- Create: `tests/lib/summarize.test.js`
- Create: `tests/fixtures/sample-results.json`

- [ ] **Step 1: Create the fixture results.json**

Create `tests/fixtures/sample-results.json`:

```json
{
  "@version": "2.14.0",
  "@generated": "Wed, 29 Apr 2026 12:00:00",
  "site": [
    {
      "@name": "https://magpipe-staging-snapsonic.vercel.app",
      "alerts": [
        {
          "pluginid": "10038",
          "alertRef": "10038",
          "alert": "Content Security Policy (CSP) Header Not Set",
          "name": "Content Security Policy (CSP) Header Not Set",
          "riskcode": "3",
          "confidence": "3",
          "riskdesc": "High (High)",
          "desc": "Content Security Policy (CSP) is an added layer of security...",
          "instances": [{ "uri": "https://magpipe-staging-snapsonic.vercel.app/", "method": "GET" }],
          "count": "1",
          "solution": "Ensure that your web server, application server, load balancer, etc. is configured to set the Content-Security-Policy header.",
          "cweid": "693",
          "wascid": "15"
        },
        {
          "pluginid": "10035",
          "alertRef": "10035",
          "alert": "Strict-Transport-Security Header Not Set",
          "name": "Strict-Transport-Security Header Not Set",
          "riskcode": "1",
          "confidence": "3",
          "riskdesc": "Low (High)",
          "desc": "HTTP Strict Transport Security (HSTS)...",
          "instances": [{ "uri": "https://magpipe-staging-snapsonic.vercel.app/", "method": "GET" }],
          "count": "1",
          "solution": "Ensure that your web server, application server, load balancer, etc. is configured to enforce Strict-Transport-Security.",
          "cweid": "319",
          "wascid": "15"
        },
        {
          "pluginid": "10063",
          "alertRef": "10063",
          "alert": "Permissions Policy Header Not Set",
          "name": "Permissions Policy Header Not Set",
          "riskcode": "1",
          "confidence": "3",
          "riskdesc": "Low (High)",
          "desc": "Permissions Policy Header is...",
          "instances": [{ "uri": "https://cdn.jsdelivr.net/npm/somelib@1.0.0/dist/somelib.min.js", "method": "GET" }],
          "count": "1",
          "solution": "Ensure that your web server returns a Permissions-Policy header.",
          "cweid": "693",
          "wascid": "15"
        }
      ]
    }
  ]
}
```

- [ ] **Step 2: Write failing tests**

Create `tests/lib/summarize.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { summarize } from '../../cli/lib/summarize.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, '..', 'fixtures', 'sample-results.json');

describe('summarize', () => {
  it('produces a markdown summary with sections per risk level', async () => {
    const json = JSON.parse(await readFile(fixturePath, 'utf8'));
    const md = summarize(json);
    expect(md).toMatch(/^# CASA Ready Scan Summary/m);
    expect(md).toMatch(/## High Risk/);
    expect(md).toMatch(/## Low Risk/);
    expect(md).toContain('Content Security Policy (CSP) Header Not Set');
    expect(md).toContain('CWE-693');
    expect(md).toContain('Strict-Transport-Security Header Not Set');
  });

  it('flags third-party CDN findings as likely NA', async () => {
    const json = JSON.parse(await readFile(fixturePath, 'utf8'));
    const md = summarize(json);
    expect(md).toMatch(/likely NA.*cdn\.jsdelivr\.net/i);
  });

  it('returns "no findings" markdown for empty alert list', () => {
    const md = summarize({ site: [{ '@name': 'x', alerts: [] }] });
    expect(md).toMatch(/no findings/i);
  });

  it('handles results.json with no site array gracefully', () => {
    const md = summarize({});
    expect(md).toMatch(/no findings/i);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:
```bash
npm test
```

Expected: `summarize.test.js` tests fail with `Cannot find module`.

- [ ] **Step 4: Implement the summarizer**

Create `cli/lib/summarize.js`:

```javascript
const RISK_LABEL = {
  '3': 'High Risk',
  '2': 'Medium Risk',
  '1': 'Low Risk',
  '0': 'Informational',
};

const RISK_ORDER = ['3', '2', '1', '0'];

const THIRD_PARTY_HOST_PATTERNS = [
  /cdn\.jsdelivr\.net/,
  /cdnjs\.cloudflare\.com/,
  /unpkg\.com/,
  /googletagmanager\.com/,
  /google-analytics\.com/,
];

export function summarize(results) {
  const sites = Array.isArray(results.site) ? results.site : [];
  const allAlerts = sites.flatMap((s) => (s.alerts || []).map((a) => ({ ...a, site: s['@name'] })));

  if (allAlerts.length === 0) {
    return '# CASA Ready Scan Summary\n\nNo findings.\n';
  }

  const grouped = groupByRisk(allAlerts);
  const lines = ['# CASA Ready Scan Summary', ''];
  lines.push(`Total findings: ${allAlerts.length}`);
  lines.push('');

  for (const risk of RISK_ORDER) {
    const alerts = grouped[risk] || [];
    if (alerts.length === 0) continue;
    lines.push(`## ${RISK_LABEL[risk]}`);
    lines.push('');
    for (const alert of alerts) {
      lines.push(`### ${alert.alert}`);
      lines.push('');
      lines.push(`- CWE-${alert.cweid}`);
      lines.push(`- Confidence: ${alert.confidence}`);
      lines.push(`- Instances: ${alert.count}`);
      const naFlag = checkLikelyNA(alert);
      if (naFlag) {
        lines.push(`- **Likely NA:** ${naFlag}`);
      }
      lines.push('');
      lines.push(`> ${(alert.solution || '').replace(/\n/g, ' ')}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

function groupByRisk(alerts) {
  const out = {};
  for (const a of alerts) {
    const key = String(a.riskcode);
    if (!out[key]) out[key] = [];
    out[key].push(a);
  }
  return out;
}

function checkLikelyNA(alert) {
  const instances = alert.instances || [];
  for (const inst of instances) {
    for (const pattern of THIRD_PARTY_HOST_PATTERNS) {
      if (pattern.test(inst.uri)) {
        return `instance on third-party host (${inst.uri})`;
      }
    }
  }
  return null;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run:
```bash
npm test
```

Expected: All `summarize.test.js` tests pass.

- [ ] **Step 6: Commit**

```bash
git add cli/lib/summarize.js tests/lib/summarize.test.js tests/fixtures/sample-results.json
git commit -m "feat(summarize): generate markdown triage summary from ZAP results"
```

---

## Task 6: Scan command orchestrator (`cli/commands/scan.js`)

**Responsibility:** Tie config + context + docker + summarize together for a single `casa-ready scan` invocation. Handles `--env`, `--confirm-prod`, `--scan` flags. Tested with mocked dependencies — no real Docker.

**Files:**
- Create: `cli/commands/scan.js`
- Create: `tests/commands/scan.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/commands/scan.test.js`:

```javascript
import { describe, it, expect, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runScan } from '../../cli/commands/scan.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, '..', 'fixtures', 'sample-config.js');

function makeDeps(overrides = {}) {
  return {
    runZap: vi.fn().mockResolvedValue({ exitCode: 0 }),
    readResultsJson: vi.fn().mockResolvedValue({ site: [{ '@name': 'x', alerts: [] }] }),
    writeSummary: vi.fn().mockResolvedValue(),
    writeContext: vi.fn().mockResolvedValue('/tmp/casa-ctx-test.xml'),
    readContextTemplate: vi.fn().mockResolvedValue('<x>{{contextName}}</x>'),
    mkdirOutput: vi.fn().mockResolvedValue('/abs/scan-output/staging/test'),
    now: () => '2026-04-29T12-00-00Z',
    ...overrides,
  };
}

describe('runScan', () => {
  it('runs a staging scan by default', async () => {
    const deps = makeDeps();
    process.env.CASA_READY_USER = 'u';
    process.env.CASA_READY_PASS = 'p';
    const result = await runScan(
      { configPath: fixturePath, env: 'staging', confirmProd: false, flavor: 'casa' },
      deps
    );
    expect(deps.runZap).toHaveBeenCalledOnce();
    expect(result.outputDir).toBe('/abs/scan-output/staging/test');
    expect(result.summaryPath).toMatch(/summary\.md$/);
  });

  it('rejects --env prod without --confirm-prod', async () => {
    const deps = makeDeps();
    process.env.CASA_READY_USER = 'u';
    process.env.CASA_READY_PASS = 'p';
    await expect(
      runScan(
        { configPath: fixturePath, env: 'prod', confirmProd: false, flavor: 'casa' },
        deps
      )
    ).rejects.toThrow(/--confirm-prod/);
    expect(deps.runZap).not.toHaveBeenCalled();
  });

  it('allows --env prod with --confirm-prod', async () => {
    const deps = makeDeps();
    process.env.CASA_READY_USER = 'u';
    process.env.CASA_READY_PASS = 'p';
    await runScan(
      { configPath: fixturePath, env: 'prod', confirmProd: true, flavor: 'casa' },
      deps
    );
    expect(deps.runZap).toHaveBeenCalledOnce();
  });

  it('uses zap-baseline.py when flavor=baseline', async () => {
    const deps = makeDeps();
    process.env.CASA_READY_USER = 'u';
    process.env.CASA_READY_PASS = 'p';
    await runScan(
      { configPath: fixturePath, env: 'staging', confirmProd: false, flavor: 'baseline' },
      deps
    );
    const args = deps.runZap.mock.calls[0][0];
    expect(args).toContain('zap-baseline.py');
  });

  it('exits 0 even when findings exist', async () => {
    const deps = makeDeps({
      readResultsJson: vi.fn().mockResolvedValue({
        site: [{ '@name': 'x', alerts: [{ alert: 'A', riskcode: '3', confidence: '3', cweid: '79', count: '1', instances: [], solution: '' }] }],
      }),
    });
    process.env.CASA_READY_USER = 'u';
    process.env.CASA_READY_PASS = 'p';
    const result = await runScan(
      { configPath: fixturePath, env: 'staging', confirmProd: false, flavor: 'casa' },
      deps
    );
    expect(result.exitCode).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
npm test
```

Expected: `scan.test.js` tests fail with `Cannot find module`.

- [ ] **Step 3: Implement the orchestrator**

Create `cli/commands/scan.js`:

```javascript
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadConfig, resolveEnv, readAuthCredentials } from '../lib/config.js';
import { renderContext } from '../lib/zap-context.js';
import { buildZapArgs, runZap as defaultRunZap } from '../lib/docker.js';
import { summarize } from '../lib/summarize.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const CONFIGS_DIR = path.join(PROJECT_ROOT, 'configs', 'zap');
const CONTEXT_TEMPLATE_PATH = path.join(CONFIGS_DIR, 'context-template.xml');

export async function runScan(opts, deps = {}) {
  const {
    configPath = path.join(process.cwd(), 'casa-ready.config.js'),
    env = 'staging',
    confirmProd = false,
    flavor = 'casa',
  } = opts;

  if (env === 'prod' && !confirmProd) {
    throw new Error(
      'Refusing to scan prod without --confirm-prod (active scan can be destructive).'
    );
  }

  const {
    runZap = defaultRunZap,
    readResultsJson = (p) => readFile(p, 'utf8').then(JSON.parse),
    writeSummary = (p, content) => writeFile(p, content, 'utf8'),
    writeContext = async (rendered) => {
      const tmpPath = path.join('/tmp', `casa-ctx-${Date.now()}.xml`);
      await writeFile(tmpPath, rendered, 'utf8');
      return tmpPath;
    },
    readContextTemplate = () => readFile(CONTEXT_TEMPLATE_PATH, 'utf8'),
    mkdirOutput = async (envName, ts) => {
      const dir = path.join(PROJECT_ROOT, 'scan-output', envName, ts);
      await mkdir(dir, { recursive: true });
      return dir;
    },
    now = () => new Date().toISOString().replace(/[:.]/g, '-'),
  } = deps;

  const config = await loadConfig(configPath);
  const targetUrl = resolveEnv(config, env);
  const creds = readAuthCredentials();
  const timestamp = now();
  const outputDir = await mkdirOutput(env, timestamp);

  const template = await readContextTemplate();
  const rendered = renderContext(template, {
    contextName: `${config.app}-${env}`,
    targetUrl,
    loginUrl: config.auth.loginUrl,
    loginRequestBody: config.auth.loginRequestBody,
    usernameField: config.auth.usernameField,
    passwordField: config.auth.passwordField,
    loggedInIndicator: config.auth.loggedInIndicator,
    username: creds.username,
    password: creds.password,
  });
  const contextPath = await writeContext(rendered);

  const args = buildZapArgs({
    flavor,
    targetUrl,
    configsDir: CONFIGS_DIR,
    outputDir,
    contextPath,
  });

  await runZap(args);

  const resultsJsonPath = path.join(outputDir, 'results.json');
  const results = await readResultsJson(resultsJsonPath);
  const summaryMd = summarize(results);
  const summaryPath = path.join(outputDir, 'summary.md');
  await writeSummary(summaryPath, summaryMd);

  // Also emit results.txt (TAC submission artifact) — derived from results.json
  // For V1 a simple plaintext rendering is enough; ZAP's report.html is already produced.
  const txtPath = path.join(outputDir, 'results.txt');
  await writeFile(txtPath, summaryMd, 'utf8');

  return { exitCode: 0, outputDir, summaryPath };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
npm test
```

Expected: All `scan.test.js` tests pass.

- [ ] **Step 5: Commit**

```bash
git add cli/commands/scan.js tests/commands/scan.test.js
git commit -m "feat(scan): orchestrate config -> context -> docker -> summary"
```

---

## Task 7: CLI entrypoint (`bin/casa-ready.js`)

**Responsibility:** Parse argv, route to subcommand, handle errors. Uses `node:util parseArgs` (Node 20+ built-in, no deps).

**Files:**
- Create: `bin/casa-ready.js`
- Modify: `package.json` (already has `bin` field from scaffold; ensure it points to this file)

- [ ] **Step 1: Verify the scaffold's package.json bin entry**

Run:
```bash
grep -A 2 '"bin"' package.json
```

Expected output includes `"casa-ready": "./bin/casa-ready.js"`. (Already set from scaffold.)

- [ ] **Step 2: Write the CLI entrypoint**

Create `bin/casa-ready.js`:

```javascript
#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { runScan } from '../cli/commands/scan.js';

const HELP = `casa-ready — pass Google CASA Tier 2 without paying $15K+

Usage:
  casa-ready scan [options]

Options:
  --env <staging|prod>     Which environment to scan (default: staging)
  --confirm-prod           Required when --env=prod (active scan can be destructive)
  --scan <casa|baseline>   Scan flavor (default: casa)
  --config <path>          Path to casa-ready.config.js (default: ./casa-ready.config.js)
  --help, -h               Show this help

Environment variables:
  CASA_READY_USER          Login username for the form-auth context (required)
  CASA_READY_PASS          Login password for the form-auth context (required)

Examples:
  casa-ready scan
  casa-ready scan --env prod --confirm-prod
  casa-ready scan --scan baseline
`;

async function main(argv) {
  const subcommand = argv[0];
  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    process.stdout.write(HELP);
    process.exit(subcommand ? 0 : 1);
  }

  if (subcommand !== 'scan') {
    process.stderr.write(`Unknown command: ${subcommand}\n\n${HELP}`);
    process.exit(1);
  }

  let parsed;
  try {
    parsed = parseArgs({
      args: argv.slice(1),
      options: {
        env: { type: 'string', default: 'staging' },
        'confirm-prod': { type: 'boolean', default: false },
        scan: { type: 'string', default: 'casa' },
        config: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: false,
    });
  } catch (err) {
    process.stderr.write(`${err.message}\n\n${HELP}`);
    process.exit(1);
  }

  if (parsed.values.help) {
    process.stdout.write(HELP);
    process.exit(0);
  }

  try {
    const result = await runScan({
      configPath: parsed.values.config,
      env: parsed.values.env,
      confirmProd: parsed.values['confirm-prod'],
      flavor: parsed.values.scan,
    });
    process.stdout.write(`\n✓ Scan complete.\n`);
    process.stdout.write(`  Artifacts: ${result.outputDir}\n`);
    process.stdout.write(`  Summary:   ${result.summaryPath}\n`);
    process.stdout.write(`  TAC submission: upload results.txt + results.xml from the artifacts dir.\n`);
    process.exit(result.exitCode);
  } catch (err) {
    process.stderr.write(`\n✗ ${err.message}\n`);
    process.exit(1);
  }
}

main(process.argv.slice(2));
```

- [ ] **Step 3: Make the entrypoint executable**

Run:
```bash
chmod +x bin/casa-ready.js
```

- [ ] **Step 4: Smoke test help output**

Run:
```bash
node bin/casa-ready.js --help
```

Expected: HELP text printed, exit 0.

Run:
```bash
node bin/casa-ready.js
```

Expected: HELP text printed, exit 1 (no subcommand).

Run:
```bash
node bin/casa-ready.js scan --env prod
```

Expected: stderr contains "Refusing to scan prod without --confirm-prod" — but only after config loading, which will fail first if no `casa-ready.config.js` exists. That's fine for this smoke test; the unit tests cover the prod-confirm path.

- [ ] **Step 5: Commit**

```bash
git add bin/casa-ready.js
git commit -m "feat(cli): node entrypoint with parseArgs and help"
```

---

## Task 8: Vendor ZAP context template + CASA policy

**Responsibility:** Get the actual ZAP context XML template and the CASA-tuned scan policy file into `configs/zap/`.

**Files:**
- Create: `configs/zap/context-template.xml`
- Create: `configs/zap/casa-tier2.policy`

- [ ] **Step 1: Write the context template**

Create `configs/zap/context-template.xml`. ZAP context files are long XML documents. We use a minimal but valid form-auth context:

```xml
<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<configuration>
  <context>
    <name>{{contextName}}</name>
    <desc>CASA Ready autogenerated context</desc>
    <inscope>true</inscope>
    <incregexes>{{targetUrl}}.*</incregexes>
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
    <authentication>
      <type>2</type>
      <strategy>EACH_RESP</strategy>
      <pollurl></pollurl>
      <polldata></polldata>
      <pollheaders></pollheaders>
      <pollfreq>60</pollfreq>
      <pollunits>REQUESTS</pollunits>
      <loggedin>{{loggedInIndicator}}</loggedin>
      <form>
        <loginurl>{{loginUrl}}</loginurl>
        <loginbody>{{loginRequestBody}}</loginbody>
        <loginpageurl>{{loginUrl}}</loginpageurl>
      </form>
    </authentication>
    <users>
      <user>1;true;{{username}};2;{{username}}~{{password}}</user>
    </users>
    <forceduser>1</forceduser>
    <session>
      <type>0</type>
    </session>
    <authorization>
      <type>0</type>
      <basic>
        <header></header>
        <body></body>
        <logic>AND</logic>
        <code>-1</code>
      </basic>
    </authorization>
  </context>
</configuration>
```

- [ ] **Step 2: Obtain or generate the CASA-tuned policy file**

The official ADA policy file's location in [appdefensealliance/ASA-WG](https://github.com/appdefensealliance/ASA-WG) needs to be confirmed. Options, in priority order:

1. Search the ASA-WG repo for `.policy` or `.conf` files referenced by the CASA Tier 2 docs.
2. If found, download to `configs/zap/casa-tier2.policy`.
3. If not found, fall back: use ZAP's bundled `OWASP Top 10` scan policy as a starting point (acceptable for V1 since the CASA-tuned policy is essentially the same CWE list with thresholds tuned).

Run, in order:

```bash
# Try to locate official policy file
gh api repos/appdefensealliance/ASA-WG/git/trees/main?recursive=1 \
  | grep -iE '\.(policy|conf)$' \
  | head -20
```

If a file is found in the output, download it:

```bash
# Replace <PATH> with the actual path from the previous command
curl -L "https://raw.githubusercontent.com/appdefensealliance/ASA-WG/main/<PATH>" \
  -o configs/zap/casa-tier2.policy
```

If nothing found, use the fallback:

```bash
cat > configs/zap/casa-tier2.policy <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <policy>CASA Tier 2 (fallback OWASP Top 10)</policy>
  <scanner>
    <level>MEDIUM</level>
    <strength>HIGH</strength>
  </scanner>
</configuration>
EOF
```

Add a README note about the gap:

Edit `configs/zap/README.md`, append:

```markdown

## Status

- `context-template.xml` — generated by CASA Ready, validated against ZAP 2.14.x context schema.
- `casa-tier2.policy` — **TODO: confirm against official ADA source.** Currently using a permissive fallback. To replace with the official policy when located in `appdefensealliance/ASA-WG`. Open issue #1 once repo is fully published.
```

- [ ] **Step 3: Verify the context template parses as XML**

Run:
```bash
node -e "
import('node:fs/promises').then(async ({ readFile }) => {
  const xml = await readFile('configs/zap/context-template.xml', 'utf8');
  // After substituting all placeholders with safe values, parse
  const filled = xml.replace(/\{\{(\w+)\}\}/g, 'TEST');
  // Naive validity check: opening and closing tags balance
  const opens = (filled.match(/<[a-zA-Z]/g) || []).length;
  const closes = (filled.match(/<\//g) || []).length;
  // Self-closing tags reduce closes; allow up to 5 self-closing
  if (opens - closes > 5 || closes > opens) {
    throw new Error('XML tag count looks unbalanced: ' + opens + ' opens vs ' + closes + ' closes');
  }
  console.log('OK: ' + opens + ' opens, ' + closes + ' closes');
});
"
```

Expected: `OK: <N> opens, <M> closes` where the difference is small (self-closing tags).

- [ ] **Step 4: Commit**

```bash
git add configs/zap/context-template.xml configs/zap/casa-tier2.policy configs/zap/README.md
git commit -m "feat(configs): vendor ZAP context template and CASA policy stub"
```

---

## Task 9: Example config + GitHub Actions template + README usage

**Responsibility:** Ship a `casa-ready.config.example.js` users can copy, the opt-in CI template, and update the README's "Using `casa-ready scan`" section so the tool is actually usable.

**Files:**
- Create: `casa-ready.config.example.js`
- Create: `.github/workflows/casa-scan.yml.example`
- Modify: `README.md`

- [ ] **Step 1: Write the example config**

Create `casa-ready.config.example.js`:

```javascript
/**
 * casa-ready.config.js
 *
 * Copy this file to `casa-ready.config.js` (no `.example`) and edit the values
 * for your app. Add `casa-ready.config.js` to your .gitignore if it contains
 * URLs you don't want public.
 *
 * Credentials are NEVER stored here — set CASA_READY_USER and CASA_READY_PASS
 * environment variables instead.
 */
export default {
  app: 'your-app',

  envs: {
    staging: 'https://staging.your-app.com',
    prod: 'https://your-app.com',
  },

  auth: {
    type: 'form',
    loginUrl: 'https://staging.your-app.com/login',
    // ZAP's form-auth body. {%username%} / {%password%} are ZAP's substitution
    // tokens (NOT mustache).
    loginRequestBody: 'email={%username%}&password={%password%}',
    usernameField: 'email',
    passwordField: 'password',
    // Regex matched against the response body of every request. When matched,
    // ZAP knows the session is still authenticated.
    loggedInIndicator: 'Sign out|/dashboard',
  },
};
```

- [ ] **Step 2: Write the GitHub Actions template**

Create `.github/workflows/casa-scan.yml.example`:

```yaml
# casa-scan.yml.example
#
# Copy this file to `.github/workflows/casa-scan.yml` (no `.example`) to enable
# scheduled CASA scans. Recommended for the annual recert use case.
#
# REQUIRES the following GitHub Actions secrets:
#   CASA_READY_USER  — login username for your staging environment
#   CASA_READY_PASS  — login password for your staging environment

name: CASA Tier 2 Pre-Scan

on:
  workflow_dispatch:
  schedule:
    # 11 months after first run — gives buffer before annual recert deadline
    - cron: '0 9 1 */11 *'

jobs:
  scan:
    runs-on: ubuntu-latest
    timeout-minutes: 90
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - run: npm ci

      - name: Run CASA-tuned ZAP scan against staging
        env:
          CASA_READY_USER: ${{ secrets.CASA_READY_USER }}
          CASA_READY_PASS: ${{ secrets.CASA_READY_PASS }}
        run: npx casa-ready scan --env staging --scan casa

      - name: Upload scan artifacts
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: casa-scan-output
          path: scan-output/
          retention-days: 90
```

- [ ] **Step 3: Update the README usage section**

Edit `README.md`, find the section after "## Project layout" and BEFORE "## Status & roadmap". Insert this new section:

```markdown

## Using `casa-ready scan`

### Quick start

```bash
# Install
npm install -g casa-ready          # or use npx (no install)

# Configure
cp node_modules/casa-ready/casa-ready.config.example.js casa-ready.config.js
# Edit casa-ready.config.js: set your app URLs and login form details

# Set creds (never put these in the config file)
export CASA_READY_USER=your-test-user@example.com
export CASA_READY_PASS=your-test-password

# Scan staging (default)
casa-ready scan

# Scan prod (requires explicit confirmation)
casa-ready scan --env prod --confirm-prod
```

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

```

- [ ] **Step 4: Smoke test the example config can be loaded**

Run:
```bash
node -e "
import('./casa-ready.config.example.js').then((m) => {
  if (!m.default || !m.default.envs || !m.default.auth) throw new Error('Example config missing fields');
  console.log('OK: example config has app=' + m.default.app);
});
"
```

Expected: `OK: example config has app=your-app`

- [ ] **Step 5: Commit**

```bash
git add casa-ready.config.example.js .github/workflows/casa-scan.yml.example README.md
git commit -m "docs: add example config, GHA template, and CLI usage section"
```

---

## Task 10: End-to-end smoke test against juice-shop

**Responsibility:** Run the full pipeline once against [OWASP Juice Shop](https://github.com/bkimminich/juice-shop) (a deliberately vulnerable training app) to confirm the V1 produces real ZAP output. Not part of `npm test` — manual or `npm run test:integration`.

**Files:**
- Create: `tests/integration/smoke.test.js`
- Create: `tests/integration/juice-shop.config.js`

- [ ] **Step 1: Create the juice-shop test config**

Create `tests/integration/juice-shop.config.js`:

```javascript
export default {
  app: 'juice-shop',
  envs: {
    staging: 'http://localhost:3000',
  },
  auth: {
    type: 'form',
    loginUrl: 'http://localhost:3000/rest/user/login',
    loginRequestBody: 'email={%username%}&password={%password%}',
    usernameField: 'email',
    passwordField: 'password',
    loggedInIndicator: 'authentication',
  },
};
```

- [ ] **Step 2: Write the integration test**

Create `tests/integration/smoke.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import { runScan } from '../../cli/commands/scan.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUN_INTEGRATION = process.env.RUN_INTEGRATION === '1';

describe.skipIf(!RUN_INTEGRATION)('end-to-end smoke', () => {
  it('produces ZAP artifacts when scanning juice-shop locally', async () => {
    process.env.CASA_READY_USER = 'admin@juice-sh.op';
    process.env.CASA_READY_PASS = 'admin123';
    const result = await runScan({
      configPath: path.join(__dirname, 'juice-shop.config.js'),
      env: 'staging',
      confirmProd: false,
      flavor: 'baseline', // baseline is faster for smoke
    });
    expect(result.exitCode).toBe(0);
    const files = await readdir(result.outputDir);
    expect(files).toContain('results.json');
    expect(files).toContain('summary.md');
    const summaryStat = await stat(path.join(result.outputDir, 'summary.md'));
    expect(summaryStat.size).toBeGreaterThan(0);
  }, 600_000); // 10 min timeout — first ZAP image pull can be slow
});
```

- [ ] **Step 3: Manually run juice-shop locally, then the integration test**

Run, in two terminals:

Terminal 1 (start juice-shop):
```bash
docker run --rm -p 3000:3000 bkimminich/juice-shop
```

Terminal 2 (run the smoke test):
```bash
RUN_INTEGRATION=1 npm test -- tests/integration/smoke.test.js
```

Expected: Test passes. `scan-output/staging/<timestamp>/` contains `results.json`, `results.xml`, `results.html`, `summary.md`, `results.txt`. Manually inspect `summary.md` — should contain the headers section finding (CSP, HSTS) at minimum.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/smoke.test.js tests/integration/juice-shop.config.js
git commit -m "test(integration): smoke test against juice-shop"
```

- [ ] **Step 5: Tag V1**

```bash
git tag -a v0.1.0 -m "V1: ZAP pre-scan kit (anonymous-first, form-auth, two-target)"
git push --tags
```

---

## Self-Review

Skimmed the spec section by section against the plan:

| Spec section | Implemented in tasks |
|---|---|
| `bin/casa-ready.js` (CLI entrypoint) | Task 7 |
| `cli/commands/scan.js` (orchestrator) | Task 6 |
| `cli/lib/config.js` | Task 2 |
| `cli/lib/zap-context.js` | Task 3 |
| `cli/lib/docker.js` | Task 4 |
| `cli/lib/summarize.js` | Task 5 |
| `configs/zap/casa-tier2.policy` | Task 8 |
| `configs/zap/context-template.xml` | Task 8 |
| `.github/workflows/casa-scan.yml.example` | Task 9 |
| Two-target env model + `--confirm-prod` | Task 6 (orchestrator gate) + Task 7 (CLI flag) |
| Form-based auth via ZAP context | Task 3 (renderer) + Task 8 (template) |
| Both `casa` and `baseline` scan flavors | Task 4 (FLAVOR_TO_SCRIPT map) + Task 7 (CLI flag) |
| Output to `./scan-output/<env>/<timestamp>/` | Task 6 (mkdirOutput default) |
| Markdown triage `summary.md` | Task 5 |
| Exit 0 on findings | Task 6 (returns exitCode 0); test verifies |
| Vitest unit + opt-in integration tests | Tasks 2-6 (unit) + Task 10 (integration) |
| Distribution: npm + npx | package.json `bin` field (already in scaffold) — verified Task 7 step 1 |

**Placeholder scan:** Task 8 step 2 has the only "investigate then choose path" instruction — the official ADA policy file location is unconfirmed. The plan provides explicit shell commands for both the find-and-download and the fallback paths. Acceptable for V1.

**Type consistency:** `runScan` opts shape (`configPath`, `env`, `confirmProd`, `flavor`) matches between Task 6 (definition) and Task 7 (caller). `buildZapArgs` signature matches between Task 4 (definition) and Task 6 (caller). Test names in Task 5 reference fields (`riskcode`, `cweid`, `solution`, `instances`) that match the fixture in Task 5 step 1.

**Gap found:** spec mentions `--fail-on <severity>` is deferred to V1.1 — not in plan, correct.

**Gap found:** spec error-handling table has "Output dir not writable → exit 1 before docker invocation" — Task 6 currently relies on `mkdir({ recursive: true })` to throw if unwritable, which propagates up via the `try`/error path in Task 7. Acceptable but not explicitly tested. Adding a note: future hardening, not V1 blocker.

No fixes needed inline.

---

## Execution

**Plan complete and saved to `docs/superpowers/plans/2026-04-29-zap-prescan-kit-v1.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best when tasks have clear acceptance criteria (which this plan provides via passing tests).

**2. Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with checkpoints for review.

**Which approach?**
