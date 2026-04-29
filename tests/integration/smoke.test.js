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

  it('produces ZAP artifacts when scanning juice-shop locally', async () => {
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
    expect(files).toContain('results.txt'); // TAC portal submission artifact
    const summaryStat = await stat(path.join(result.outputDir, 'summary.md'));
    expect(summaryStat.size).toBeGreaterThan(0);
  }, 600_000); // 10 min timeout — first ZAP image pull can be slow
});
