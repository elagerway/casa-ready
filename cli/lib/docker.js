import { spawn as nodeSpawn } from 'node:child_process';

const FLAVOR_TO_SCRIPT = {
  casa: 'zap-full-scan.py',
  baseline: 'zap-baseline.py',
};

export function buildZapArgs({
  flavor,
  targetUrl,
  configsDir,
  outputDir,
  contextPath,
}) {
  const script = FLAVOR_TO_SCRIPT[flavor];
  if (!script) {
    throw new Error(`Unknown scan flavor: ${flavor}`);
  }
  return [
    'run',
    '--rm',
    '-v',
    `${configsDir}:/zap/configs:ro`,
    '-v',
    `${outputDir}:/zap/wrk:rw`,
    '-v',
    `${contextPath}:${contextPath}:ro`,
    'zaproxy/zap-stable',
    script,
    '-t',
    targetUrl,
    '-c',
    '/zap/configs/casa-tier2.policy',
    '-n',
    contextPath,
    '-J',
    'results.json',
    '-x',
    'results.xml',
    '-r',
    'results.html',
  ];
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
        reject(new Error('Docker is not installed or not on PATH. Install Docker Desktop (macOS/Windows) or docker-ce (Linux).'));
      } else {
        reject(err);
      }
    });
    child.on('exit', (code) => {
      if (code === 0) {
        resolve({ exitCode: 0 });
      } else {
        reject(new Error(`ZAP container exited with code ${code}`));
      }
    });
  });
}
