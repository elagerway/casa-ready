import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { runScan } from '../../cli/commands/scan.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const RUN = process.env.RUN_INTEGRATION === '1';

describe.skipIf(!RUN)('oauth-callback flavor (integration)', () => {
  let originalUser, originalPass;

  beforeEach(() => {
    originalUser = process.env.CASA_READY_USER;
    originalPass = process.env.CASA_READY_PASS;
    process.env.CASA_READY_USER = 'unused';
    process.env.CASA_READY_PASS = 'unused';
  });

  afterEach(() => {
    if (originalUser === undefined) delete process.env.CASA_READY_USER;
    else process.env.CASA_READY_USER = originalUser;
    if (originalPass === undefined) delete process.env.CASA_READY_PASS;
    else process.env.CASA_READY_PASS = originalPass;
  });

  it('produces ZAP artifacts for an oauth-callback target', async () => {
    // Build a single-target oauth-callback config pointing at juice-shop's
    // login endpoint. juice-shop accepts random query params and returns
    // useful errors, which exercises the full zap-api-scan flow without
    // needing a real OAuth provider.
    const tmpDir = path.join(tmpdir(), 'casa-oauth-smoke-' + Date.now());
    await mkdir(tmpDir, { recursive: true });
    const ymlPath = path.join(tmpDir, 'casa-ready.yml');
    await writeFile(
      ymlPath,
      `app: juice-shop-oauth-smoke
envs:
  staging:
    targets:
      - name: callback
        url: http://host.docker.internal:3000/rest/user/login
        auth: { type: none }
        scan: oauth-callback
        callbackParams:
          email: test@x.com
          password: test
`,
      'utf8'
    );

    try {
      const result = await runScan({
        configPath: ymlPath,
        env: 'staging',
        confirmProd: false,
      });
      // runScan collapses ZAP's exit code: 0 = no per-target failures, 1 = at
      // least one target threw. We don't care WHAT ZAP found here — only that
      // the orchestrator completed and wrote artifacts.
      expect([0, 1]).toContain(result.exitCode);
      const targetDir = path.join(result.outputDir, 'callback');
      const summary = await readFile(path.join(targetDir, 'summary.md'), 'utf8');
      expect(summary).toContain('# CASA Ready Scan Summary');
    } finally {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 600_000); // 10 minute timeout — active scan can take a while
});
