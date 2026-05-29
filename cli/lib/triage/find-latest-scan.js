import { readdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * Find the newest scan-output/<env>/<timestamp>/ directory under cwd (or given root).
 * Timestamps are ISO strings with `:` and `.` replaced by `-`, so lexicographic sort
 * matches chronological order.
 *
 * Uses readdir with { withFileTypes: true } to avoid per-entry stat syscalls.
 * Note: withFileTypes + isDirectory() does NOT follow symlinks; a symlinked dir
 * reports as isSymbolicLink(). Machine-written scan output dirs are never symlinks,
 * so this is an acceptable trade-off.
 *
 * @param {string} cwd — directory containing scan-output/
 * @returns {Promise<string|null>} absolute path to newest run dir, or null if none
 */
export async function findLatestScanRun(cwd = process.cwd()) {
  const scanRoot = path.join(cwd, 'scan-output');
  let envDirents;
  try {
    envDirents = await readdir(scanRoot, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }

  const candidates = [];
  for (const envDirent of envDirents) {
    if (!envDirent.isDirectory()) continue;

    const envPath = path.join(scanRoot, envDirent.name);
    let runDirents;
    try {
      runDirents = await readdir(envPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const runDirent of runDirents) {
      if (!runDirent.isDirectory()) continue;
      const runPath = path.join(envPath, runDirent.name);
      candidates.push({ path: runPath, ts: runDirent.name });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
  return candidates[0].path;
}
