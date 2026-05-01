import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * Resolve all seed URLs for a target.
 *
 * Returns an array starting with target.url, then any seedDir-derived seeds
 * (each subdirectory name appended to target.url), then any explicit seedUrls
 * (path-only entries are prefixed with the target's origin or appended to
 * target.url depending on whether they have a leading slash). Final list is
 * deduped while preserving first-occurrence order.
 *
 * Throws if seedDir is set but the directory doesn't exist (catches typos
 * and missing project paths). Warns to stderr — does not throw — when
 * seedDir exists but contains no subdirectories (early-development case).
 *
 * @param {object} target — TargetSchema-shaped object
 * @param {string} cwd — base for resolving relative seedDir (default: process.cwd())
 * @returns {Promise<string[]>} deduped seed URLs in stable order
 */
export async function resolveSeedUrls(target, cwd = process.cwd()) {
  const seeds = [target.url];

  if (target.seedDir) {
    const dirSeeds = await globSeedDir(target, cwd);
    seeds.push(...dirSeeds);
  }

  if (target.seedUrls && target.seedUrls.length > 0) {
    for (const seed of target.seedUrls) {
      seeds.push(resolveRelativeUrl(seed, target.url));
    }
  }

  return Array.from(new Set(seeds));
}

async function globSeedDir(target, cwd) {
  const absDir = path.isAbsolute(target.seedDir)
    ? target.seedDir
    : path.join(cwd, target.seedDir);

  let entries;
  try {
    entries = await readdir(absDir);
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`seedDir does not exist: ${absDir}`);
    }
    throw err;
  }

  const subdirs = [];
  for (const entry of entries) {
    if (entry.startsWith('.') || entry.startsWith('_')) continue;
    const stats = await stat(path.join(absDir, entry));
    if (stats.isDirectory()) {
      subdirs.push(entry);
    }
  }

  if (subdirs.length === 0) {
    process.stderr.write(
      `Warning: seedDir at ${absDir} contains no subdirectories — falling back to seedUrls only\n`
    );
    return [];
  }

  return subdirs.map((name) => `${trimTrailingSlash(target.url)}/${name}`);
}

function resolveRelativeUrl(url, baseUrl) {
  if (/^https?:\/\//.test(url)) return url;
  const base = new URL(baseUrl);
  if (url.startsWith('/')) {
    return `${base.protocol}//${base.host}${url}`;
  }
  return `${trimTrailingSlash(baseUrl)}/${url}`;
}

function trimTrailingSlash(url) {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}
