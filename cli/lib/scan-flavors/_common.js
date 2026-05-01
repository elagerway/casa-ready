const ZAP_IMAGE = 'zaproxy/zap-stable';
const ZAP_CONTEXT_PATH = '/zap/context.xml';
const ZAP_SEED_FILE_PATH = '/zap/configs/seed-urls.txt';
const ZAP_HOOK_PATH = '/zap/configs/seed-spider-hook.py';

/**
 * Build docker argv shared by zap-baseline.py and zap-full-scan.py flavors.
 * They differ only in scriptName. Spider seeds and replacer headers are
 * threaded through identically.
 *
 * Caller passes:
 *   scriptName        — 'zap-baseline.py' or 'zap-full-scan.py'
 *   targetUrl         — primary scan target (becomes the spider's first seed)
 *   configsDir        — host path mounted to /zap/configs
 *   outputDir         — host path mounted to /zap/wrk (ZAP writes results here)
 *   contextPath       — host path of the rendered context XML
 *   replacerHeaders   — optional [{name,value}] for Bearer/apikey injection
 *   containerName     — optional --name for `docker ps` visibility
 *   seedFilePath      — optional host path to seed-urls.txt; triggers --hook
 */
export function buildCommonArgs({
  scriptName,
  targetUrl,
  configsDir,
  outputDir,
  contextPath,
  replacerHeaders = null,
  containerName = null,
  seedFilePath = null,
}) {
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
    `${contextPath}:${ZAP_CONTEXT_PATH}:ro`
  );
  if (seedFilePath) {
    // Mount the seed-urls.txt that the orchestrator wrote, so the
    // seed-spider-hook.py inside the container can read it.
    args.push('-v', `${seedFilePath}:${ZAP_SEED_FILE_PATH}:ro`);
  }

  args.push(
    ZAP_IMAGE,
    scriptName,
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

  if (seedFilePath) {
    args.push('--hook', ZAP_HOOK_PATH);
  }

  const replacerZArg = renderReplacerZArg(replacerHeaders);
  if (replacerZArg) {
    args.push('-z', replacerZArg);
  }

  return args;
}

/**
 * Render replacer-rule headers as a single -z value for the ZAP wrapper
 * scripts. The wrapper shlex-splits the value into ZAP daemon CLI args, so
 * each `-config key=value` token gets its own shell-escaped pair. Values
 * with spaces (e.g. `Bearer <jwt>`) are single-quoted so shlex preserves
 * them as one token.
 *
 * The full set of keys per rule (description, enabled, matchtype, matchstr,
 * regex, replacement, initiators) are required — omitting any silently
 * disables the replacer.
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
