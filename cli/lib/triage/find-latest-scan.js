import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * Find the newest scan-output/<env>/<timestamp>/ directory under cwd (or given root).
 * Timestamps are ISO strings with `:` and `.` replaced by `-`, so lexicographic sort
 * matches chronological order.
 *
 * @param {string} cwd — directory containing scan-output/
 * @returns {Promise<string|null>} absolute path to newest run dir, or null if none
 */
export async function findLatestScanRun(cwd = process.cwd()) {
  const scanRoot = path.join(cwd, 'scan-output');
  let envEntries;
  try {
    envEntries = await readdir(scanRoot);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }

  const candidates = [];
  for (const env of envEntries) {
    const envPath = path.join(scanRoot, env);
    let s;
    try {
      s = await stat(envPath);
    } catch {
      continue;
    }
    if (!s.isDirectory()) continue;

    let runEntries;
    try {
      runEntries = await readdir(envPath);
    } catch {
      continue;
    }
    for (const ts of runEntries) {
      const runPath = path.join(envPath, ts);
      try {
        const rs = await stat(runPath);
        if (rs.isDirectory()) candidates.push({ path: runPath, ts });
      } catch {
        continue;
      }
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
  return candidates[0].path;
}
