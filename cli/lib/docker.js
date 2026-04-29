import { spawn as nodeSpawn } from 'node:child_process';

const ZAP_IMAGE = 'zaproxy/zap-stable';
const ZAP_POLICY_PATH = '/zap/configs/casa-tier2.policy';
const ZAP_CONTEXT_PATH = '/zap/context.xml';

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

  args.push(
    ZAP_IMAGE,
    script,
    '-t',
    targetUrl,
    '-c',
    ZAP_POLICY_PATH,
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
      if (code === 0) {
        resolve({ exitCode: 0 });
      } else if (signal) {
        // Container was killed (OOM, docker stop, timeout). `code` is null in
        // this case, so the previous "exited with code null" message was junk.
        reject(new Error(`ZAP container was killed by signal ${signal}`));
      } else {
        reject(new Error(`ZAP container exited with code ${code}`));
      }
    });
  });
}
