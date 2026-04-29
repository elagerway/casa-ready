import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
    deleteContext: vi.fn().mockResolvedValue(),
    readContextTemplate: vi.fn().mockResolvedValue('<x>{{contextName}}</x>'),
    mkdirOutput: vi.fn().mockResolvedValue('/abs/scan-output/staging/test'),
    now: () => '2026-04-29T12-00-00Z',
    ...overrides,
  };
}

describe('runScan', () => {
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

  it('runs a staging scan by default', async () => {
    const deps = makeDeps();
    const result = await runScan(
      { configPath: fixturePath, env: 'staging', confirmProd: false, flavor: 'casa' },
      deps
    );
    expect(deps.runZap).toHaveBeenCalledOnce();
    expect(result.outputDir).toBe('/abs/scan-output/staging/test');
    expect(result.summaryPath).toMatch(/summary\.md$/);
    expect(result.txtPath).toMatch(/results\.txt$/);
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
    expect(deps.runZap).toHaveBeenCalledOnce();
  });

  it('uses zap-baseline.py when flavor=baseline', async () => {
    const deps = makeDeps();
    await runScan(
      { configPath: fixturePath, env: 'staging', confirmProd: false, flavor: 'baseline' },
      deps
    );
    const args = deps.runZap.mock.calls[0][0];
    expect(args).toContain('zap-baseline.py');
  });

  it('exits 0 even when findings exist, AND writes both summary.md and results.txt', async () => {
    const deps = makeDeps({
      readResultsJson: vi.fn().mockResolvedValue({
        site: [
          {
            '@name': 'x',
            alerts: [
              {
                alert: 'A',
                riskcode: '3',
                confidence: '3',
                cweid: '79',
                count: '1',
                instances: [],
                solution: '',
              },
            ],
          },
        ],
      }),
    });
    const result = await runScan(
      { configPath: fixturePath, env: 'staging', confirmProd: false, flavor: 'casa' },
      deps
    );
    expect(result.exitCode).toBe(0);
    expect(deps.writeSummary).toHaveBeenCalledTimes(2); // summary.md + results.txt
  });

  it('cleans up the temp context file on success', async () => {
    const deps = makeDeps();
    await runScan(
      { configPath: fixturePath, env: 'staging', confirmProd: false, flavor: 'casa' },
      deps
    );
    expect(deps.deleteContext).toHaveBeenCalledWith('/tmp/casa-ctx-test.xml');
    expect(deps.deleteContext).toHaveBeenCalledTimes(1);
  });

  it('cleans up the temp context file even when runZap rejects (credential leak prevention)', async () => {
    const deps = makeDeps({
      runZap: vi.fn().mockRejectedValue(new Error('docker exploded')),
    });
    await expect(
      runScan(
        { configPath: fixturePath, env: 'staging', confirmProd: false, flavor: 'casa' },
        deps
      )
    ).rejects.toThrow(/docker exploded/);
    expect(deps.deleteContext).toHaveBeenCalledWith('/tmp/casa-ctx-test.xml');
  });

  it('default mkdirOutput resolves under process.cwd(), not the install dir', async () => {
    // Regression test for the v0.1.0 final-review critical:
    // PROJECT_ROOT (= install location) is wrong for global installs and
    // for node_modules-installed devDeps; only cwd is reliable.
    let capturedDir = null;
    const deps = makeDeps({
      mkdirOutput: undefined, // force the production default
    });
    // Spy on the real mkdir behavior by hooking deeper: we can't easily
    // intercept the default mkdirOutput closure, so we run runScan with
    // a doomed runZap that rejects right after mkdirOutput is called,
    // then read the directory path from the (still-mocked) deleteContext call
    // — actually simpler: assert via the result.outputDir on a successful run.
    deps.mkdirOutput = undefined;
    deps.runZap = vi.fn().mockResolvedValue({ exitCode: 0 });
    const result = await runScan(
      { configPath: fixturePath, env: 'staging', confirmProd: false, flavor: 'casa' },
      deps
    );
    expect(result.outputDir.startsWith(process.cwd())).toBe(true);
    expect(result.outputDir).toContain('scan-output/staging/');
    // Cleanup: the test created a real timestamped directory under cwd
    const { rm } = await import('node:fs/promises');
    await rm(path.join(process.cwd(), 'scan-output'), { recursive: true, force: true });
  });

  it('surfaces a useful error when readResultsJson fails (e.g. ZAP crashed)', async () => {
    const deps = makeDeps({
      readResultsJson: vi.fn().mockRejectedValue(
        new Error('Could not read ZAP results at /abs/scan-output/staging/test/results.json: ENOENT, no such file or directory. This usually means the ZAP scan exited before writing results.json — check the container logs above.')
      ),
    });
    await expect(
      runScan(
        { configPath: fixturePath, env: 'staging', confirmProd: false, flavor: 'casa' },
        deps
      )
    ).rejects.toThrow(/scan exited before writing results\.json/);
    // Cleanup must still happen on this failure path
    expect(deps.deleteContext).toHaveBeenCalled();
  });
});
