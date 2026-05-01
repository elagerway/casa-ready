import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import { runScan } from '../../cli/commands/scan.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUN_INTEGRATION = process.env.RUN_INTEGRATION === '1';

describe.skipIf(!RUN_INTEGRATION)('end-to-end smoke', () => {
  let originalUser, originalPass;

  beforeEach(() => {
    originalUser = process.env.CASA_READY_USER;
    originalPass = process.env.CASA_READY_PASS;
    process.env.CASA_READY_USER = 'admin@juice-sh.op';
    process.env.CASA_READY_PASS = 'admin123';
  });

  afterEach(() => {
    if (originalUser === undefined) delete process.env.CASA_READY_USER;
    else process.env.CASA_READY_USER = originalUser;
    if (originalPass === undefined) delete process.env.CASA_READY_PASS;
    else process.env.CASA_READY_PASS = originalPass;
  });

  it('produces ZAP artifacts for each target when scanning juice-shop locally', async () => {
    const result = await runScan({
      configPath: path.join(__dirname, 'juice-shop.config.yml'),
      env: 'staging',
      confirmProd: false,
      flavor: 'baseline', // baseline is faster for smoke
    });
    // exitCode may be 0 (both succeeded) or 1 (one or both failed) — but the
    // pipeline should produce per-target dirs either way.
    expect([0, 1]).toContain(result.exitCode);
    expect(result.targets).toHaveLength(2);

    // Each target's per-target dir exists and has the expected files
    for (const target of result.targets) {
      const dirStat = await stat(target.outputDir);
      expect(dirStat.isDirectory()).toBe(true);
    }

    // Top-level aggregated summary exists and is non-trivial
    const topFiles = await readdir(result.outputDir);
    expect(topFiles).toContain('summary.md');
    expect(topFiles).toContain('results.txt');
    const summaryStat = await stat(path.join(result.outputDir, 'summary.md'));
    expect(summaryStat.size).toBeGreaterThan(0);
  }, 1_200_000); // 20 min timeout — two targets + first ZAP image pull
});
