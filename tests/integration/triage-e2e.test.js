import { describe, it, expect, beforeAll } from 'vitest';
import { runTriage } from '../../cli/lib/triage/index.js';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const SHOULD_RUN = process.env.RUN_INTEGRATION === '1';

describe.skipIf(!SHOULD_RUN)('triage e2e against Juice Shop scan output', () => {
  let scanRunDir;

  beforeAll(async () => {
    // Re-use the existing scan integration smoke's output path if available;
    // otherwise expect the user has run `npm run test:integration` first.
    // For v0.5.0, simplest path: pre-condition that scan-output/ exists with at least one run.
    const cwd = process.cwd();
    const scanOutput = path.join(cwd, 'scan-output');
    if (!existsSync(scanOutput)) {
      throw new Error(
        'No scan-output/ found. Run the scan integration test first: ' +
        'docker run --rm -p 3000:3000 bkimminich/juice-shop in another terminal, ' +
        'then RUN_INTEGRATION=1 npm run test:integration'
      );
    }
    // Use whatever's there; triage will auto-discover newest
  }, 60_000);

  it('triage produces triage.md with expected structure', async () => {
    const result = await runTriage({ emitJson: true });

    expect(result.runDir).toBeTruthy();
    expect(result.mdPath).toBeTruthy();
    expect(existsSync(result.mdPath)).toBe(true);

    const md = readFileSync(result.mdPath, 'utf8');
    expect(md).toMatch(/^# CASA Ready Triage/);
    expect(md).toContain('## Summary');
    // Juice Shop reliably trips at least one of CSP/HSTS/X-Content-Type-Options
    expect(md).toContain('## Actionable');
    expect(md).toMatch(/## Next step/);
  }, 30_000);

  it('triage.json parses and matches the markdown finding count', async () => {
    const result = await runTriage({ emitJson: true });
    expect(result.jsonPath).toBeTruthy();
    expect(existsSync(result.jsonPath)).toBe(true);
    const json = JSON.parse(readFileSync(result.jsonPath, 'utf8'));
    expect(json.schemaVersion).toBe(1);
    expect(json.summary.totalUniqueAlerts).toBe(result.totalCount);
  }, 10_000);
});
