import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { loadConfig, resolveTargets, readAuthCredentials } from '../../cli/lib/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, '..', 'fixtures', 'multi-target-config.yml');

describe('loadConfig (YAML)', () => {
  it('loads a valid multi-target YAML config', async () => {
    const config = await loadConfig(fixturePath);
    expect(config.app).toBe('magpipe');
    expect(config.envs.staging.targets).toHaveLength(2);
    expect(config.envs.staging.targets[0].name).toBe('spa');
    expect(config.envs.staging.targets[1].name).toBe('api');
  });

  it('throws a clear error when the file does not exist', async () => {
    await expect(loadConfig('/nonexistent/casa-ready.yml')).rejects.toThrow(
      /not found.*casa-ready init/i
    );
  });

  it('throws a migration error when only the legacy .js config exists', async () => {
    const tmpDir = path.join(__dirname, '..', 'fixtures', 'tmp-migration');
    const ymlPath = path.join(tmpDir, 'casa-ready.yml');
    const jsPath = path.join(tmpDir, 'casa-ready.config.js');
    await mkdir(tmpDir, { recursive: true });
    await writeFile(jsPath, 'export default {};');
    try {
      await expect(loadConfig(ymlPath)).rejects.toThrow(
        /legacy.*v0\.2.*casa-ready init|see.*MIGRATION/i
      );
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('throws on invalid YAML syntax', async () => {
    const tmpDir = path.join(__dirname, '..', 'fixtures', 'tmp-bad-yaml');
    const tmpPath = path.join(tmpDir, 'casa-ready.yml');
    await mkdir(tmpDir, { recursive: true });
    await writeFile(tmpPath, 'app: magpipe\n  bad indent');
    try {
      await expect(loadConfig(tmpPath)).rejects.toThrow(/yaml/i);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('expands ${VAR} references via process.env', async () => {
    const tmpDir = path.join(__dirname, '..', 'fixtures', 'tmp-env');
    const tmpPath = path.join(tmpDir, 'casa-ready.yml');
    await mkdir(tmpDir, { recursive: true });
    await writeFile(
      tmpPath,
      `app: x
envs:
  staging:
    targets:
      - name: api
        url: https://x.supabase.co/functions/v1
        auth:
          type: supabase-jwt
          loginUrl: https://x.supabase.co/auth/v1/token?grant_type=password
          apiKey: \${TEST_ANON_KEY}
          refreshSeconds: 3300
`
    );
    process.env.TEST_ANON_KEY = 'expanded-value';
    try {
      const config = await loadConfig(tmpPath);
      expect(config.envs.staging.targets[0].auth.apiKey).toBe('expanded-value');
    } finally {
      delete process.env.TEST_ANON_KEY;
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('throws when a referenced env var is missing, with the dotted path', async () => {
    const tmpDir = path.join(__dirname, '..', 'fixtures', 'tmp-missing-env');
    const tmpPath = path.join(tmpDir, 'casa-ready.yml');
    await mkdir(tmpDir, { recursive: true });
    await writeFile(
      tmpPath,
      `app: x
envs:
  staging:
    targets:
      - name: api
        url: https://x.supabase.co/functions/v1
        auth:
          type: supabase-jwt
          loginUrl: https://x.supabase.co/auth/v1/token
          apiKey: \${MISSING_KEY_XYZ}
`
    );
    delete process.env.MISSING_KEY_XYZ;
    try {
      await expect(loadConfig(tmpPath)).rejects.toThrow(
        /MISSING_KEY_XYZ.*envs\.staging\.targets\.0\.auth\.apiKey/
      );
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('throws on schema validation failure with useful message', async () => {
    const tmpDir = path.join(__dirname, '..', 'fixtures', 'tmp-bad-shape');
    const tmpPath = path.join(tmpDir, 'casa-ready.yml');
    await mkdir(tmpDir, { recursive: true });
    await writeFile(tmpPath, 'app: x\nenvs: {}');
    try {
      await expect(loadConfig(tmpPath)).rejects.toThrow(/validation/i);
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
    expect(readAuthCredentials()).toEqual({ username: 'erik@snapsonic.com', password: 'hunter2' });
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
