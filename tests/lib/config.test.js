import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { loadConfig, resolveTargets, readAuthCredentials } from '../../cli/lib/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, '..', 'fixtures', 'multi-target-config.js');

describe('loadConfig', () => {
  it('loads a valid multi-target config file', async () => {
    const config = await loadConfig(fixturePath);
    expect(config.app).toBe('magpipe');
    expect(config.envs.staging.targets).toHaveLength(2);
    expect(config.envs.staging.targets[0].name).toBe('spa');
    expect(config.envs.staging.targets[1].name).toBe('api');
  });

  it('throws a clear error when the file does not exist', async () => {
    await expect(loadConfig('/nonexistent/path.js')).rejects.toThrow(
      /could not load config/i
    );
  });

  it('throws when envs[env].targets is missing', async () => {
    const tmpDir = path.join(__dirname, '..', 'fixtures', 'tmp');
    const tmpPath = path.join(tmpDir, 'no-targets.js');
    await mkdir(tmpDir, { recursive: true });
    await writeFile(
      tmpPath,
      `export default { app: "x", envs: { staging: {} } };`
    );
    try {
      await expect(loadConfig(tmpPath)).rejects.toThrow(/targets.*non-empty array/i);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('throws when two targets in the same env share a name', async () => {
    const tmpDir = path.join(__dirname, '..', 'fixtures', 'tmp');
    const tmpPath = path.join(tmpDir, 'dup-target.js');
    await mkdir(tmpDir, { recursive: true });
    await writeFile(
      tmpPath,
      `export default { app: "x", envs: { staging: { targets: [
        { name: "a", url: "https://x", auth: { type: "form", loginUrl: "u", loginRequestBody: "b", usernameField: "u", passwordField: "p", loggedInIndicator: "i" } },
        { name: "a", url: "https://y", auth: { type: "form", loginUrl: "u", loginRequestBody: "b", usernameField: "u", passwordField: "p", loggedInIndicator: "i" } }
      ] } } };`
    );
    try {
      await expect(loadConfig(tmpPath)).rejects.toThrow(/duplicate target name/i);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('throws when auth.type is unknown', async () => {
    const tmpDir = path.join(__dirname, '..', 'fixtures', 'tmp');
    const tmpPath = path.join(tmpDir, 'bad-auth.js');
    await mkdir(tmpDir, { recursive: true });
    await writeFile(
      tmpPath,
      `export default { app: "x", envs: { staging: { targets: [
        { name: "a", url: "https://x", auth: { type: "bogus" } }
      ] } } };`
    );
    try {
      await expect(loadConfig(tmpPath)).rejects.toThrow(/unknown auth\.type.*bogus.*form.*supabase-jwt/i);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('throws when supabase-jwt auth is missing apiKey', async () => {
    const tmpDir = path.join(__dirname, '..', 'fixtures', 'tmp');
    const tmpPath = path.join(tmpDir, 'no-apikey.js');
    await mkdir(tmpDir, { recursive: true });
    await writeFile(
      tmpPath,
      `export default { app: "x", envs: { staging: { targets: [
        { name: "a", url: "https://x", auth: { type: "supabase-jwt", loginUrl: "https://y" } }
      ] } } };`
    );
    try {
      await expect(loadConfig(tmpPath)).rejects.toThrow(/auth\.apiKey/i);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('throws when target.url is not http(s)', async () => {
    const tmpDir = path.join(__dirname, '..', 'fixtures', 'tmp');
    const tmpPath = path.join(tmpDir, 'bad-url.js');
    await mkdir(tmpDir, { recursive: true });
    await writeFile(
      tmpPath,
      `export default { app: "x", envs: { staging: { targets: [
        { name: "a", url: "ftp://x", auth: { type: "form", loginUrl: "u", loginRequestBody: "b", usernameField: "u", passwordField: "p", loggedInIndicator: "i" } }
      ] } } };`
    );
    try {
      await expect(loadConfig(tmpPath)).rejects.toThrow(/url.*http/i);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('resolveTargets', () => {
  it('returns all targets for a known env', async () => {
    const config = await loadConfig(fixturePath);
    const targets = resolveTargets(config, 'staging');
    expect(targets).toHaveLength(2);
    expect(targets.map((t) => t.name)).toEqual(['spa', 'api']);
  });

  it('throws on unknown env', async () => {
    const config = await loadConfig(fixturePath);
    expect(() => resolveTargets(config, 'qa')).toThrow(/unknown env: qa/i);
  });

  it('filters by target name when provided', async () => {
    const config = await loadConfig(fixturePath);
    const targets = resolveTargets(config, 'staging', 'spa');
    expect(targets).toHaveLength(1);
    expect(targets[0].name).toBe('spa');
  });

  it('throws when filter target name does not exist', async () => {
    const config = await loadConfig(fixturePath);
    expect(() => resolveTargets(config, 'staging', 'nope')).toThrow(
      /target.*nope.*not found.*spa.*api/i
    );
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
