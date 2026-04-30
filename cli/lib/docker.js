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
 *
 * `replacerHeaders` (v0.2.4): array of `{ name, value }` static headers to
 * inject into every in-scope request via ZAP's replacer addon. Used by the
 * supabase-jwt auth path to attach `Authorization: Bearer <jwt>` and
 * `apikey: <anon>` after our Node-side login. See the renderReplacerZArg
 * comment for the shlex-quoting nuance.
 *
 * `scriptPath` is preserved for backward compatibility with the form-auth
 * dispatcher's contract, but is unused as of v0.2.4 — the supabase-jwt path
 * no longer needs in-ZAP scripts. A future script-based auth would register
 * via the --hook mechanism, not via the (broken) `-z 'script.load(...)'`
 * pattern that v0.1–0.2.3 attempted.
 */
export function buildZapArgs({
  flavor,
  targetUrl,
  configsDir,
  outputDir,
  contextPath,
  scriptPath: _scriptPath = null,
  replacerHeaders = null,
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

  const replacerZArg = renderReplacerZArg(replacerHeaders);
  if (replacerZArg) {
    args.push('-z', replacerZArg);
  }

  return args;
}

/**
 * Render replacer-rule headers as a single -z value for zap-baseline.py.
 *
 * zap-baseline.py shlex-splits the -z value and appends each token to the ZAP
 * daemon CLI as raw args. So this function must produce a string that, when
 * shlex-split, yields a clean sequence of `-config key=value` token pairs.
 * Values that contain spaces (e.g. `Bearer <jwt>`) are wrapped in single
 * quotes so shlex preserves them as one token; embedded single quotes are
 * escaped using the canonical sh idiom `'\''`.
 *
 * The `enabled=true`, `regex=false`, empty `initiators` (= apply to all),
 * and `matchtype=REQ_HEADER` keys are required for ZAP to actually fire the
 * rule. Omitting any of them silently disables injection.
 */
function renderReplacerZArg(replacerHeaders) {
  if (!replacerHeaders || replacerHeaders.length === 0) return null;
  const parts = [];
  replacerHeaders.forEach((h, i) => {
    const prefix = `replacer.full_list(${i})`;
    parts.push('-config', shellQuoteForShlex(`${prefix}.description=casa-ready-${h.name}`));
    parts.push('-config', shellQuoteForShlex(`${prefix}.enabled=true`));
    parts.push('-config', shellQuoteForShlex(`${prefix}.matchtype=REQ_HEADER`));
    parts.push('-config', shellQuoteForShlex(`${prefix}.matchstr=${h.name}`));
    parts.push('-config', shellQuoteForShlex(`${prefix}.regex=false`));
    parts.push('-config', shellQuoteForShlex(`${prefix}.replacement=${h.value}`));
    parts.push('-config', shellQuoteForShlex(`${prefix}.initiators=`));
  });
  return parts.join(' ');
}

function shellQuoteForShlex(s) {
  // Always wrap in single quotes; that survives shlex.split with any value.
  // Embedded ' becomes '\'' (close, escaped quote, reopen).
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
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
