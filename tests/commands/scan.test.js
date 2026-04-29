import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runScan } from '../../cli/commands/scan.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, '..', 'fixtures', 'multi-target-config.js');

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
});
