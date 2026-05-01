import path from 'node:path';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadConfig, resolveTargets, readAuthCredentials } from '../lib/config.js';
import { getContext as defaultGetAuthContext } from '../lib/auth/index.js';
import { buildZapArgs, runZap as defaultRunZap } from '../lib/docker.js';
import { summarize } from '../lib/summarize.js';
import { aggregateTargets } from '../lib/targets-summary.js';
import { resolveSeedUrls as defaultResolveSeedUrls } from '../lib/seed-urls.js';
import { renderOpenApiYaml } from '../lib/scan-flavors/oauth-callback.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const CONFIGS_DIR = path.join(PROJECT_ROOT, 'configs', 'zap');

export async function runScan(opts, deps = {}) {
  const {
    configPath = path.join(process.cwd(), 'casa-ready.yml'),
    env = 'staging',
    target: targetFilter,
    confirmProd = false,
    flavor = 'casa',
  } = opts;

  if (env === 'prod' && !confirmProd) {
    throw new Error(
      'Refusing to scan prod without --confirm-prod (active scan can be destructive).'
    );
  }

  const {
    runZap = defaultRunZap,
    readResultsJson = async (p) => {
      let raw;
      try {
        raw = await readFile(p, 'utf8');
      } catch (err) {
        throw new Error(
          `Could not read ZAP results at ${p}: ${err.message}. ` +
            `This usually means the ZAP scan exited before writing results.json — check the container logs above.`
        );
      }
      try {
        return JSON.parse(raw);
      } catch (err) {
        throw new Error(`ZAP results at ${p} is not valid JSON: ${err.message}`);
      }
    },
    writeSummary = (p, content) => writeFile(p, content, 'utf8'),
    writeContext = async (rendered, runId) => {
      const tmpPath = path.join(tmpdir(), `casa-ctx-${runId}.xml`);
      await writeFile(tmpPath, rendered, 'utf8');
      return tmpPath;
    },
    deleteContext = (p) => unlink(p).catch(() => {}),
    getAuthContext = defaultGetAuthContext,
    resolveSeedUrls = defaultResolveSeedUrls,
    writeSeedFile = async (urls, runId) => {
      const tmpPath = path.join(tmpdir(), `casa-seeds-${runId}.txt`);
      await writeFile(tmpPath, urls.join('\n') + '\n', 'utf8');
      return tmpPath;
    },
    deleteSeedFile = (p) => unlink(p).catch(() => {}),
    writeOpenApiFile = async (yamlBody, runId) => {
      const tmpPath = path.join(tmpdir(), `casa-openapi-${runId}.yaml`);
      await writeFile(tmpPath, yamlBody, 'utf8');
      return tmpPath;
    },
    deleteOpenApiFile = (p) => unlink(p).catch(() => {}),
    mkdirOutput = async (envName, ts, targetName) => {
      const dir = path.join(process.cwd(), 'scan-output', envName, ts, targetName);
      await mkdir(dir, { recursive: true });
      return dir;
    },
    now = () => new Date().toISOString().replace(/[:.]/g, '-'),
  } = deps;

  const config = await loadConfig(configPath);
  const targets = resolveTargets(config, env, targetFilter);
  const credentials = readAuthCredentials();
  const timestamp = now();

  const targetResults = []; // { name, outputDir, summaryMd } | (failure entry below)
  const failures = []; // { name, outputDir, error, stage }

  // Sequential by design — ZAP is CPU/memory intensive; running multiple
  // containers in parallel saturates Docker Desktop quickly. Parallelism
  // is a V1.2+ concern with explicit resource budgeting.
  for (const target of targets) {
    const result = await runOneTarget({
      target,
      env,
      timestamp,
      credentials,
      runZap,
      readResultsJson,
      writeSummary,
      writeContext,
      deleteContext,
      getAuthContext,
      resolveSeedUrls,
      writeSeedFile,
      deleteSeedFile,
      writeOpenApiFile,
      deleteOpenApiFile,
      mkdirOutput,
      flavor,
    });
    if (result.error) {
      failures.push(result);
      targetResults.push({ name: target.name, outputDir: result.outputDir, summaryMd: null });
    } else {
      targetResults.push(result);
    }
  }

  // Top-level aggregated summary
  const topLevelDir = path.join(process.cwd(), 'scan-output', env, timestamp);
  await mkdir(topLevelDir, { recursive: true });
  const aggregateMd = aggregateTargets({
    app: config.app,
    env,
    timestamp,
    successes: targetResults.filter((r) => r.summaryMd),
    failures,
  });
  await writeSummary(path.join(topLevelDir, 'summary.md'), aggregateMd);
  await writeSummary(path.join(topLevelDir, 'results.txt'), aggregateMd);

  return {
    exitCode: failures.length === 0 ? 0 : 1,
    outputDir: topLevelDir,
    summaryPath: path.join(topLevelDir, 'summary.md'),
    txtPath: path.join(topLevelDir, 'results.txt'),
    targets: targetResults,
    failures,
  };
}

async function runOneTarget({
  target,
  env,
  timestamp,
  credentials,
  runZap,
  readResultsJson,
  writeSummary,
  writeContext,
  deleteContext,
  getAuthContext,
  resolveSeedUrls,
  writeSeedFile,
  deleteSeedFile,
  writeOpenApiFile,
  deleteOpenApiFile,
  mkdirOutput,
  flavor,
}) {
  const runId = `${target.name}-${Date.now()}`;
  let contextPath = null;
  let outputDir;
  let seedFilePath = null;
  let openApiPath = null;

  try {
    // Inside the try so an mkdirOutput failure (e.g. disk full, permission
    // denied on this target's subdir) gets collected into the failures list
    // instead of aborting the whole run — preserves best-effort semantics.
    outputDir = await mkdirOutput(env, timestamp, target.name);

    const { contextXml, scriptPath, replacerHeaders } = await getAuthContext({
      target,
      credentials,
      configsDir: CONFIGS_DIR,
      runId,
    });
    contextPath = await writeContext(contextXml, runId);

    // Per-target scan flavor override — falls back to global --scan flag.
    const targetFlavor = target.scan ?? flavor;

    // For baseline/casa: resolve seed URLs and write to a temp file the
    // hook script will read. Skip for oauth-callback (uses synthetic OpenAPI).
    if (targetFlavor !== 'oauth-callback') {
      const seedUrls = await resolveSeedUrls(target);
      // Only mount/write if we actually have extras beyond target.url.
      if (seedUrls.length > 1) {
        seedFilePath = await writeSeedFile(seedUrls, runId);
      }
    }

    // For oauth-callback: synthesize the OpenAPI doc from callbackParams.
    if (targetFlavor === 'oauth-callback') {
      const yamlBody = renderOpenApiYaml({ url: target.url, params: target.callbackParams });
      openApiPath = await writeOpenApiFile(yamlBody, runId);
    }

    const args = buildZapArgs({
      flavor: targetFlavor,
      targetUrl: target.url,
      configsDir: CONFIGS_DIR,
      outputDir,
      contextPath,
      scriptPath,
      replacerHeaders,
      containerName: `casa-ready-${target.name}-${runId}`,
      seedFilePath,
      callbackParams: target.callbackParams,
      openApiPath,
    });

    await runZap(args);

    const resultsJsonPath = path.join(outputDir, 'results.json');
    const results = await readResultsJson(resultsJsonPath);
    const summaryMd = summarize(results, { targetName: target.name });
    await writeSummary(path.join(outputDir, 'summary.md'), summaryMd);
    await writeSummary(path.join(outputDir, 'results.txt'), summaryMd);

    return { name: target.name, outputDir, summaryMd };
  } catch (error) {
    return {
      name: target.name,
      outputDir,
      error,
      stage: detectStage(error),
    };
  } finally {
    if (contextPath) {
      await deleteContext(contextPath);
    }
    if (seedFilePath) {
      await deleteSeedFile(seedFilePath);
    }
    if (openApiPath) {
      await deleteOpenApiFile(openApiPath);
    }
  }
}

function detectStage(error) {
  // Best-effort stage classification from error message — for the failure summary.
  // Known gaps: errors with novel wording fall through to 'unknown'. Matching is
  // string-based by design (Errors don't carry typed stages); accept some misses.
  const msg = String(error?.message || '');
  if (/exited with code|killed by signal|Docker is not installed/.test(msg)) return 'runZap';
  if (/Could not read ZAP results|not valid JSON/.test(msg)) return 'readResults';
  if (/Could not load config/.test(msg)) return 'loadConfig';
  if (/auth\.|supabase-jwt|form-context-template|context-template/.test(msg))
    return 'getAuthContext';
  if (/ENOENT|EACCES|EROFS|ENOSPC/.test(msg)) return 'mkdirOutput';
  return 'unknown';
}
