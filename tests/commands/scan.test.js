import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { rm } from 'node:fs/promises';
import { runScan } from '../../cli/commands/scan.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, '..', 'fixtures', 'multi-target-config.yml');

function makeDeps(overrides = {}) {
  return {
    runZap: vi.fn().mockResolvedValue({ exitCode: 0 }),
    readResultsJson: vi.fn().mockResolvedValue({ site: [{ '@name': 'x', alerts: [] }] }),
    writeSummary: vi.fn().mockResolvedValue(),
    writeContext: vi.fn().mockResolvedValue('/tmp/casa-ctx-test.xml'),
    deleteContext: vi.fn().mockResolvedValue(),
    getAuthContext: vi.fn().mockResolvedValue({
      contextXml: '<context>fake</context>',
      scriptPath: null,
    }),
    mkdirOutput: vi.fn().mockImplementation(async (envName, ts, targetName) =>
      `/abs/scan-output/${envName}/${ts}/${targetName}`
    ),
    now: () => '2026-04-29T12-00-00Z',
    ...overrides,
  };
}

describe('runScan (multi-target)', () => {
  let originalUser, originalPass;

  beforeEach(() => {
    originalUser = process.env.CASA_READY_USER;
    originalPass = process.env.CASA_READY_PASS;
    process.env.CASA_READY_USER = 'u';
    process.env.CASA_READY_PASS = 'p';
  });

  afterEach(() => {
    if (originalUser === undefined) delete process.env.CASA_READY_USER;
    else process.env.CASA_READY_USER = originalUser;
    if (originalPass === undefined) delete process.env.CASA_READY_PASS;
    else process.env.CASA_READY_PASS = originalPass;
  });

  // Even tests that mock `mkdirOutput` still trigger the top-level `mkdir`
  // for the env+timestamp aggregate dir (it's not dep-injected). Clean up
  // after every test so leaked dirs don't accumulate or create order
  // dependencies between tests.
  afterAll(async () => {
    await rm(path.join(process.cwd(), 'scan-output'), {
      recursive: true,
      force: true,
    });
  });

  it('defaults configPath to ./casa-ready.yml (v0.3.1 regression — was .config.js)', async () => {
    // Don't pass configPath; runScan should look for casa-ready.yml relative to
    // process.cwd(). The test expectation: the not-found error names the YAML
    // filename (proving the default landed on the right path), not the legacy
    // .config.js filename.
    const deps = makeDeps();
    await expect(
      runScan({ env: 'staging', confirmProd: false, flavor: 'casa' }, deps)
    ).rejects.toThrow(/casa-ready\.yml not found/);
  });

  it('runs all targets in the env when --target is not provided', async () => {
    const deps = makeDeps();
    const result = await runScan(
      { configPath: fixturePath, env: 'staging', confirmProd: false, flavor: 'casa' },
      deps
    );
    expect(deps.runZap).toHaveBeenCalledTimes(2); // spa + api
    expect(result.exitCode).toBe(0);
    expect(result.targets).toHaveLength(2);
    expect(result.failures).toHaveLength(0);
  });

  it('runs only the named target when --target is provided', async () => {
    const deps = makeDeps();
    const result = await runScan(
      { configPath: fixturePath, env: 'staging', target: 'spa', confirmProd: false, flavor: 'casa' },
      deps
    );
    expect(deps.runZap).toHaveBeenCalledTimes(1);
    expect(result.targets[0].name).toBe('spa');
  });

  it('rejects --env prod without --confirm-prod', async () => {
    const deps = makeDeps();
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
    await runScan(
      { configPath: fixturePath, env: 'prod', confirmProd: true, flavor: 'casa' },
      deps
    );
    expect(deps.runZap).toHaveBeenCalledTimes(1); // prod fixture has 1 target
  });

  it('uses zap-baseline.py when flavor=baseline (per-call)', async () => {
    const deps = makeDeps();
    await runScan(
      { configPath: fixturePath, env: 'staging', confirmProd: false, flavor: 'baseline' },
      deps
    );
    for (const call of deps.runZap.mock.calls) {
      expect(call[0]).toContain('zap-baseline.py');
    }
  });

  it('continues to next target when one target fails (best-effort)', async () => {
    const deps = makeDeps({
      runZap: vi
        .fn()
        .mockRejectedValueOnce(new Error('docker exploded on spa'))
        .mockResolvedValueOnce({ exitCode: 0 }),
    });
    const result = await runScan(
      { configPath: fixturePath, env: 'staging', confirmProd: false, flavor: 'casa' },
      deps
    );
    expect(deps.runZap).toHaveBeenCalledTimes(2);
    expect(result.exitCode).toBe(1); // any failure → non-zero
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].name).toBe('spa');
    expect(result.failures[0].error.message).toMatch(/docker exploded/);
    expect(result.targets).toHaveLength(2); // both attempted
  });

  it('cleans up the temp context file for each target on success', async () => {
    const deps = makeDeps();
    await runScan(
      { configPath: fixturePath, env: 'staging', confirmProd: false, flavor: 'casa' },
      deps
    );
    expect(deps.deleteContext).toHaveBeenCalledTimes(2);
  });

  it('cleans up the temp context file even when a target fails', async () => {
    const deps = makeDeps({
      runZap: vi.fn().mockRejectedValue(new Error('boom')),
    });
    await runScan(
      { configPath: fixturePath, env: 'staging', confirmProd: false, flavor: 'casa' },
      deps
    );
    // 2 targets, both failed, both cleaned up
    expect(deps.deleteContext).toHaveBeenCalledTimes(2);
  });

  it('writes a top-level summary with per-target sections', async () => {
    const deps = makeDeps();
    await runScan(
      { configPath: fixturePath, env: 'staging', confirmProd: false, flavor: 'casa' },
      deps
    );
    // Per-target writeSummary calls: each target writes summary.md + results.txt
    // = 4 per-target writes. Plus the 2 top-level (summary.md + results.txt) = 6.
    expect(deps.writeSummary).toHaveBeenCalledTimes(6);
    // Verify the top-level calls go to the env+timestamp dir, not a per-target subdir
    const topLevelCalls = deps.writeSummary.mock.calls.filter(
      ([p]) => !p.includes('/spa/') && !p.includes('/api/')
    );
    expect(topLevelCalls).toHaveLength(2);
  });

  it('default mkdirOutput resolves under process.cwd() per target subdir', async () => {
    const deps = makeDeps({ mkdirOutput: undefined });
    const result = await runScan(
      { configPath: fixturePath, env: 'staging', confirmProd: false, flavor: 'casa' },
      deps
    );
    for (const target of result.targets) {
      expect(target.outputDir.startsWith(process.cwd())).toBe(true);
      expect(target.outputDir).toMatch(/scan-output\/staging\/.*\/(spa|api)$/);
    }
    // Cleanup the real dirs
    const { rm } = await import('node:fs/promises');
    await rm(path.join(process.cwd(), 'scan-output'), { recursive: true, force: true });
  });

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
      // Track per-target writer calls to lock the lifecycle invariants:
      // - oauth-callback target uses writeOpenApiFile (NOT writeSeedFile)
      // - non-oauth-callback targets may use writeSeedFile but never writeOpenApiFile
      // Mock both writers; capture call args for assertion at the end.
      deps.writeOpenApiFile = vi.fn().mockResolvedValue('/tmp/casa-openapi-test.yaml');
      deps.deleteOpenApiFile = vi.fn().mockResolvedValue(undefined);
      deps.writeSeedFile = vi.fn().mockResolvedValue('/tmp/casa-seeds-test.txt');
      deps.deleteSeedFile = vi.fn().mockResolvedValue(undefined);
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
      // Lifecycle invariants: each writer/deleter is called exactly when
      // the per-target flavor needs it. The oauth-callback target writes
      // the synthetic OpenAPI file and doesn't write a seed file; the
      // supabase-jwt target (no seedDir/seedUrls in the fixture) writes
      // neither.
      expect(deps.writeOpenApiFile).toHaveBeenCalledTimes(1);
      expect(deps.deleteOpenApiFile).toHaveBeenCalledTimes(1);
      expect(deps.writeSeedFile).not.toHaveBeenCalled();
      expect(deps.deleteSeedFile).not.toHaveBeenCalled();
      // The OpenAPI YAML body passed to writeOpenApiFile must contain the
      // configured callbackParams as `example` values — proves the
      // synthesizer ran with the right inputs before the writer was called.
      // Note: YAML 1.1 treats bare `y` as boolean true, so the serializer
      // quotes it as 'y' to disambiguate. We accept either form.
      const yamlBody = deps.writeOpenApiFile.mock.calls[0][0];
      expect(yamlBody).toContain('example: x');
      expect(yamlBody).toMatch(/example: '?y'?/);
    } finally {
      await import('node:fs/promises').then((fs) =>
        fs.rm(tmpDir, { recursive: true, force: true })
      );
    }
  });
});
