import { RESULTS_FILENAME } from '../scan-output.js';

const ZAP_IMAGE = 'zaproxy/zap-stable';
const ZAP_CONTEXT_PATH = '/zap/context.xml';
// Descriptor lives at /zap/ root, NOT inside /zap/wrk/ (bind-mounted from
// outputDir) and NOT inside /zap/configs/ (mounted :ro — Docker can't create
// a new mountpoint there). Same lesson as v0.4.1/v0.4.2 seed-file fixes.
const ZAP_DESCRIPTOR_PATH = '/zap/oauth-callback.json';
const ZAP_HOOK_PATH = '/zap/configs/oauth-callback-hook.py';

/**
 * Build docker argv for an OAuth callback active scan.
 *
 * Uses zap-full-scan.py (active scan, owns the lifecycle) pointed at the exact
 * callback URL, plus oauth-callback-hook.py which seeds the parameterized
 * request(s) — GET query and/or POST form body — into ZAP's Sites tree from
 * the mounted descriptor. ZAP's active scanner then mutates callbackParams
 * looking for injection, XSS in error responses, and open redirect on
 * redirect_uri. No zap-api-scan.py, so no host-root normalization.
 */
export function buildArgs({
  targetUrl,
  configsDir,
  outputDir,
  contextPath,
  descriptorPath,
  containerName = null,
}) {
  if (!descriptorPath) {
    throw new Error(
      'descriptorPath is required for oauth-callback scan flavor (orchestrator must write the JSON descriptor and pass its path)'
    );
  }

  const args = ['run', '--rm'];
  if (containerName) {
    args.push('--name', containerName);
  }
  args.push(
    '-v',
    `${configsDir}:/zap/configs:ro`,
    '-v',
    `${outputDir}:/zap/wrk:rw`,
    '-v',
    `${contextPath}:${ZAP_CONTEXT_PATH}:ro`,
    '-v',
    `${descriptorPath}:${ZAP_DESCRIPTOR_PATH}:ro`,
    ZAP_IMAGE,
    'zap-full-scan.py',
    '-t',
    targetUrl,
    '-n',
    ZAP_CONTEXT_PATH,
    '-J',
    RESULTS_FILENAME,
    '-x',
    'results.xml',
    '-r',
    'results.html',
    '--hook',
    ZAP_HOOK_PATH
  );

  return args;
}
