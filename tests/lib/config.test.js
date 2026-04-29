import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdir, writeFile, rm } from 'node:fs/promises';
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
    const tmpDir = path.join(__dirname, '..', 'fixtures', 'tmp');
    const tmpPath = path.join(tmpDir, 'bad-config.js');
    await mkdir(tmpDir, { recursive: true });
    await writeFile(tmpPath, 'export default { app: "x" };');
    try {
      await expect(loadConfig(tmpPath)).rejects.toThrow(/envs/);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('throws when envs is an array (not an object map)', async () => {
    const tmpDir = path.join(__dirname, '..', 'fixtures', 'tmp');
    const tmpPath = path.join(tmpDir, 'envs-as-array.js');
    await mkdir(tmpDir, { recursive: true });
    await writeFile(
      tmpPath,
      `export default { app: "x", envs: ["staging"], auth: { type: "form", loginUrl: "u", loginRequestBody: "b", usernameField: "u", passwordField: "p", loggedInIndicator: "i" } };`
    );
    try {
      await expect(loadConfig(tmpPath)).rejects.toThrow(/envs.*object mapping/i);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('throws when an env value is not a string', async () => {
    const tmpDir = path.join(__dirname, '..', 'fixtures', 'tmp');
    const tmpPath = path.join(tmpDir, 'envs-bad-value.js');
    await mkdir(tmpDir, { recursive: true });
    await writeFile(
      tmpPath,
      `export default { app: "x", envs: { staging: null }, auth: { type: "form", loginUrl: "u", loginRequestBody: "b", usernameField: "u", passwordField: "p", loggedInIndicator: "i" } };`
    );
    try {
      await expect(loadConfig(tmpPath)).rejects.toThrow(/envs\.staging.*non-empty URL string/i);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('throws a clear error when the config uses a relative import', async () => {
    const tmpDir = path.join(__dirname, '..', 'fixtures', 'tmp');
    const tmpPath = path.join(tmpDir, 'relative-import.js');
    await mkdir(tmpDir, { recursive: true });
    await writeFile(
      tmpPath,
      `import x from './nonexistent.js'; export default { app: "x", envs: {}, auth: {} };`
    );
    try {
      await expect(loadConfig(tmpPath)).rejects.toThrow(/relative imports are not supported/i);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
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
