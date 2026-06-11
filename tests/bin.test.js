import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const repoRoot = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const BIN = path.join(repoRoot, 'bin', 'casa-ready.js');

describe('casa-ready --version', () => {
  it('prints the package.json version and exits 0', async () => {
    const pkg = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
    const { stdout } = await execFileAsync(process.execPath, [BIN, '--version']);
    expect(stdout).toBe(`${pkg.version}\n`);
  });

  it('accepts -v as an alias', async () => {
    const pkg = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
    const { stdout } = await execFileAsync(process.execPath, [BIN, '-v']);
    expect(stdout).toBe(`${pkg.version}\n`);
  });
});
