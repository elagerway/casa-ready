import { spawn as nodeSpawn } from 'node:child_process';

const ZAP_IMAGE = 'zaproxy/zap-stable';
const ZAP_CONTEXT_PATH = '/zap/context.xml';

// ZAP exit code semantics for zap-baseline.py / zap-full-scan.py:
//   0 = no findings
//   1 = errors found (HIGH severity rule fired)
//   2 = warnings found (MEDIUM severity rule fired)
//   3 = both errors AND warnings
// Codes 1-3 are the SUCCESS path for a security scanner — finding things is
// the whole point. Treat them as resolve, not reject. Anything 4+ (or signal
// kill) means ZAP itself broke.
const ZAP_SCAN_COMPLETED_CODES = new Set([0, 1, 2, 3]);

const FLAVOR_TO_SCRIPT = {
  casa: 'zap-full-scan.py',
  baseline: 'zap-baseline.py',
};

/**
 * Build the docker argv for a ZAP scan.
 *
 * The user-supplied `contextPath` is mounted to a fixed in-container path
 * (`/zap/context.xml`) — this keeps Docker Desktop on macOS happy (which only
 * shares a limited set of host paths) and avoids any : / , characters in the
 * host path breaking the volume mount string.
 */
export function buildZapArgs({
  flavor,
  targetUrl,
  configsDir,
  outputDir,
  contextPath,
  scriptPath = null,
}) {
  const script = FLAVOR_TO_SCRIPT[flavor];
  if (!script) {
    throw new Error(`Unknown scan flavor: ${flavor}`);
  }

  const args = [
    'run',
    '--rm',
    '-v',
    `${configsDir}:/zap/configs:ro`,
    '-v',
    `${outputDir}:/zap/wrk:rw`,
    '-v',
    `${contextPath}:${ZAP_CONTEXT_PATH}:ro`,
  ];

  // Mount the auth script (if any) into a known location inside the container.
  let containerScriptPath = null;
  if (scriptPath) {
    const filename = scriptPath.split('/').pop();
    containerScriptPath = `/zap/configs/${filename}`;
    args.push('-v', `${scriptPath}:${containerScriptPath}:ro`);
  }

  // NOTE: V1 shipped with -c /zap/configs/casa-tier2.policy, but the file
  // we vendored is XML (ZAP GUI's policy export format). The -c flag for
  // zap-baseline.py / zap-full-scan.py expects a tab-separated config
  // (PLUGINID\tTHRESHOLD\tSTRENGTH per row). ZAP silently fell back to
  // built-in defaults the entire time. Until a real ADA-tuned TSV policy
  // ships, omit -c entirely so we don't ship a confusing warning every scan.
  args.push(
    ZAP_IMAGE,
    script,
    '-t',
    targetUrl,
    '-n',
    ZAP_CONTEXT_PATH,
    '-J',
    'results.json',
    '-x',
    'results.xml',
    '-r',
    'results.html'
  );

  // Register the auth script with ZAP via -z config so the context's
  // <script> reference resolves at scan time. The script's "name" inside
  // ZAP's script registry must match the <script><name> in the context XML
  // (currently 'supabase-jwt-auth', set by the supabase-jwt context template).
  if (scriptPath) {
    // TODO(V1.2): when a 2nd script-based auth ships, parameterize the
    // script name (currently hardcoded 'supabase-jwt-auth') by passing it
    // through from the auth module alongside scriptPath.
    args.push(
      '-z',
      `script.load(name='supabase-jwt-auth',type='authentication',engine='Oracle Nashorn',file='${containerScriptPath}')`
    );
  }

  return args;
}

export function runZap(args, { spawnFn = nodeSpawn } = {}) {
  return new Promise((resolve, reject) => {
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
