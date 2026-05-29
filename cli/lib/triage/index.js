import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findLatestScanRun } from './find-latest-scan.js';
import { loadRulesIndex } from './rules-loader.js';
import { classify } from './classify.js';
import { renderMarkdown } from './render-md.js';
import { renderJson } from './render-json.js';
import { RESULTS_FILENAME } from '../scan-output.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const DEFAULT_RULES_DIR = path.join(PROJECT_ROOT, 'configs', 'casa', 'rules');

/**
 * Run the full triage pipeline.
 *
 * @param {object} opts
 * @param {string} [opts.scanRunPath] — explicit run dir; auto-detect if omitted
 * @param {string} [opts.targetFilter] — only include this target's findings
 * @param {string} [opts.rulesDir] — override built-in rules dir
 * @param {boolean} [opts.emitJson=false] — also write triage.json
 * @param {string} [opts.cwd=process.cwd()]
 * @returns {Promise<{ runDir: string, mdPath: string, jsonPath: string|null, actionableCount: number, totalCount: number }>}
 */
export async function runTriage(opts = {}) {
  const {
    scanRunPath,
    targetFilter,
    rulesDir = DEFAULT_RULES_DIR,
    emitJson = false,
    cwd = process.cwd(),
  } = opts;

  const runDir = scanRunPath ?? (await findLatestScanRun(cwd));
  if (!runDir) {
    const err = new Error('No scan output found. Run `casa-ready scan` first.');
    err.code = 'NO_SCAN_OUTPUT';
    throw err;
  }

  // Load rules KB
  const rulesIndex = await loadRulesIndex(rulesDir);

  // Walk per-target subdirs in runDir; each has results.json
  const entries = await readdir(runDir);
  const allClassifiedFindings = [];
  const targetsIncluded = [];
  const failures = [];

  for (const entry of entries) {
    const subPath = path.join(runDir, entry);
    let s;
    try {
      s = await stat(subPath);
    } catch {
      continue; // broken symlink or unreadable entry — skip
    }
    if (!s.isDirectory()) continue;
    if (targetFilter && entry !== targetFilter) continue;

    const resultsPath = path.join(subPath, RESULTS_FILENAME);
    let resultsRaw;
    try {
      resultsRaw = await readFile(resultsPath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') {
        // Per-target results.json missing — likely a target that failed mid-scan.
        // Look for evidence in the parent run's summary.md to record a failure.
        failures.push({ name: entry, error: 'results.json missing (target likely failed during scan)', stage: 'scan' });
        continue;
      }
      throw err;
    }
    let results;
    try {
      results = JSON.parse(resultsRaw);
    } catch (err) {
      failures.push({ name: entry, error: `results.json not valid JSON: ${err.message}`, stage: 'parse' });
      continue;
    }

    targetsIncluded.push(entry);
    const classified = classify({ results, rulesIndex, targetName: entry });
    allClassifiedFindings.push(...classified.findings);
  }

  const generatedAt = new Date().toISOString();
  const rel = path.relative(cwd, runDir);
  const runId = rel.startsWith('..') ? runDir : rel;

  // Attach ruleDisplayPath: repo-relative path when possible, else absolute.
  for (const f of allClassifiedFindings) {
    if (f.ruleSourcePath) {
      const r = path.relative(cwd, f.ruleSourcePath);
      f.ruleDisplayPath = r.startsWith('..') ? f.ruleSourcePath : r;
    } else {
      f.ruleDisplayPath = null;
    }
  }

  const aggregateInput = {
    runId,
    generatedAt,
    targetsIncluded,
    failures,
    findings: allClassifiedFindings,
  };

  const mdContent = renderMarkdown(aggregateInput);
  const mdPath = path.join(runDir, 'triage.md');
  await writeFile(mdPath, mdContent, 'utf8');

  let jsonPath = null;
  if (emitJson) {
    const jsonContent = renderJson(aggregateInput);
    jsonPath = path.join(runDir, 'triage.json');
    await writeFile(jsonPath, JSON.stringify(jsonContent, null, 2), 'utf8');
  }

  const actionableCount = allClassifiedFindings.filter((f) => f.category === 'actionable').length;

  return {
    runDir,
    mdPath,
    jsonPath,
    actionableCount,
    totalCount: allClassifiedFindings.length,
    failures,
    failureCount: failures.length,
  };
}
