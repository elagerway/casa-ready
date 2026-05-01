import { spawn as nodeSpawn } from 'node:child_process';
import { buildArgsFor } from './scan-flavors/index.js';

// ZAP exit code semantics for zap-baseline.py / zap-full-scan.py:
//   0 = no findings
//   1 = errors found (HIGH severity rule fired)
//   2 = warnings found (MEDIUM severity rule fired)
//   3 = both errors AND warnings
// Codes 1-3 are the SUCCESS path for a security scanner — finding things is
// the whole point. Treat them as resolve, not reject. Anything 4+ (or signal
// kill) means ZAP itself broke.
const ZAP_SCAN_COMPLETED_CODES = new Set([0, 1, 2, 3]);

/**
 * Build the docker argv for a ZAP scan.
 *
 * Delegates to the scan-flavors dispatcher (cli/lib/scan-flavors/index.js).
 * `buildZapArgs` is the public entry point; per-flavor argv construction
 * lives in cli/lib/scan-flavors/{baseline,casa,oauth-callback}.js.
 *
 * `scriptPath` is preserved for backward compatibility with the form-auth
 * dispatcher's contract, but is unused as of v0.2.4. A future script-based
 * auth would register via the --hook mechanism.
 */
export function buildZapArgs({
  flavor,
  targetUrl,
  configsDir,
  outputDir,
  contextPath,
  scriptPath: _scriptPath = null,
  replacerHeaders = null,
  containerName = null,
  seedFilePath = null,
  callbackParams = null,
}) {
  return buildArgsFor(flavor, {
    targetUrl,
    configsDir,
    outputDir,
    contextPath,
    replacerHeaders,
    containerName,
    seedFilePath,
    callbackParams,
  });
}

export function runZap(args, { spawnFn = nodeSpawn, log = (msg) => process.stdout.write(msg) } = {}) {
  return new Promise((resolve, reject) => {
    // Surface the container name so users can find it in Docker Desktop.
    const nameIdx = args.indexOf('--name');
    if (nameIdx !== -1 && args[nameIdx + 1]) {
      log(`Started ZAP container '${args[nameIdx + 1]}' (visible in Docker Desktop)\n`);
    }
    const child = spawnFn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    if (child.stdout && typeof child.stdout.on === 'function') {
      child.stdout.on('data', (chunk) => process.stdout.write(chunk));
    }
    if (child.stderr && typeof child.stderr.on === 'function') {
      child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    }
    child.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(
          new Error(
            'Docker is not installed or not on PATH. Install Docker Desktop (macOS/Windows) or docker-ce (Linux).'
          )
        );
      } else {
        reject(err);
      }
    });
    child.on('exit', (code, signal) => {
      if (signal) {
        // Container was killed (OOM, docker stop, timeout). `code` is null in
        // this case, so the previous "exited with code null" message was junk.
        reject(new Error(`ZAP container was killed by signal ${signal}`));
      } else if (ZAP_SCAN_COMPLETED_CODES.has(code)) {
        // ZAP completed scanning. Exit code 0 = clean; 1-3 = found things.
        // Either way, the scan succeeded and produced artifacts. Caller can
        // triage findings via the summary.md / results.json the orchestrator
        // writes — exit code from ZAP is too coarse for gating decisions.
        resolve({ exitCode: code });
      } else {
        reject(new Error(`ZAP container exited with code ${code}`));
      }
    });
  });
}
