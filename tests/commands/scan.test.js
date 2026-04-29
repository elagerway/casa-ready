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
