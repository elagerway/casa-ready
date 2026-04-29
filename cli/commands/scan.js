import path from 'node:path';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadConfig, resolveEnv, readAuthCredentials } from '../lib/config.js';
import { renderContext } from '../lib/zap-context.js';
import { buildZapArgs, runZap as defaultRunZap } from '../lib/docker.js';
import { summarize } from '../lib/summarize.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const CONFIGS_DIR = path.join(PROJECT_ROOT, 'configs', 'zap');
const CONTEXT_TEMPLATE_PATH = path.join(CONFIGS_DIR, 'context-template.xml');

export async function runScan(opts, deps = {}) {
  const {
    configPath = path.join(process.cwd(), 'casa-ready.config.js'),
    env = 'staging',
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
    writeContext = async (rendered) => {
      const tmpPath = path.join(tmpdir(), `casa-ctx-${Date.now()}.xml`);
      await writeFile(tmpPath, rendered, 'utf8');
      return tmpPath;
    },
    deleteContext = (p) => unlink(p).catch(() => {}),
    readContextTemplate = () => readFile(CONTEXT_TEMPLATE_PATH, 'utf8'),
    mkdirOutput = async (envName, ts) => {
      const dir = path.join(PROJECT_ROOT, 'scan-output', envName, ts);
      await mkdir(dir, { recursive: true });
      return dir;
    },
    now = () => new Date().toISOString().replace(/[:.]/g, '-'),
  } = deps;

  const config = await loadConfig(configPath);
  const targetUrl = resolveEnv(config, env);
  const creds = readAuthCredentials();
  const timestamp = now();
  const outputDir = await mkdirOutput(env, timestamp);

  const template = await readContextTemplate();
  const rendered = renderContext(template, {
    contextName: `${config.app}-${env}`,
    targetUrl,
    loginUrl: config.auth.loginUrl,
    loginRequestBody: config.auth.loginRequestBody,
    usernameField: config.auth.usernameField,
    passwordField: config.auth.passwordField,
    loggedInIndicator: config.auth.loggedInIndicator,
    username: creds.username,
    password: creds.password,
  });
  const contextPath = await writeContext(rendered);

  // Cleanup the context file (which contains the plaintext password) on every
  // exit path — success or failure. Best-effort; deleteContext swallows errors.
  try {
    const args = buildZapArgs({
      flavor,
      targetUrl,
      configsDir: CONFIGS_DIR,
      outputDir,
      contextPath,
    });

    await runZap(args);

    const resultsJsonPath = path.join(outputDir, 'results.json');
    const results = await readResultsJson(resultsJsonPath);
    const summaryMd = summarize(results);
    const summaryPath = path.join(outputDir, 'summary.md');
    await writeSummary(summaryPath, summaryMd);

    // Also emit results.txt (TAC submission artifact). For V1 this is the same
    // as the markdown summary; the orchestrator could later format differently.
    // Uses deps.writeSummary (not raw writeFile) so tests can mock both writes.
    const txtPath = path.join(outputDir, 'results.txt');
    await writeSummary(txtPath, summaryMd);

    return { exitCode: 0, outputDir, summaryPath, txtPath };
  } finally {
    await deleteContext(contextPath);
  }
}
