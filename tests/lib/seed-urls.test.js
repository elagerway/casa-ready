import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveSeedUrls } from '../../cli/lib/seed-urls.js';

describe('resolveSeedUrls', () => {
  const baseTarget = { name: 't', auth: { type: 'none' } };

  it('returns just target.url when no seeds configured', async () => {
    const target = { ...baseTarget, url: 'https://api.example.com' };
    expect(await resolveSeedUrls(target)).toEqual(['https://api.example.com']);
  });

  it('appends explicit seedUrls (full URLs) after target.url', async () => {
    const target = {
      ...baseTarget,
      url: 'https://api.example.com',
      seedUrls: ['https://api.example.com/foo', 'https://api.example.com/bar'],
    };
    expect(await resolveSeedUrls(target)).toEqual([
      'https://api.example.com',
      'https://api.example.com/foo',
      'https://api.example.com/bar',
    ]);
  });

  it('prefixes leading-slash seedUrls with target origin', async () => {
    const target = {
      ...baseTarget,
      url: 'https://api.example.com/v1',
      seedUrls: ['/v1/foo', '/healthz'],
    };
    expect(await resolveSeedUrls(target)).toEqual([
      'https://api.example.com/v1',
      'https://api.example.com/v1/foo',
      'https://api.example.com/healthz',
    ]);
  });

  it('appends path-only seedUrls (no leading slash) to target.url', async () => {
    const target = {
      ...baseTarget,
      url: 'https://api.example.com/v1',
      seedUrls: ['gmail-inbox'],
    };
    expect(await resolveSeedUrls(target)).toEqual([
      'https://api.example.com/v1',
      'https://api.example.com/v1/gmail-inbox',
    ]);
  });

  it('globs seedDir subdirectories and appends each name to target.url', async () => {
    const tmpDir = await mkdtemp(path.join(tmpdir(), 'seed-test-'));
    try {
      await mkdir(path.join(tmpDir, 'gmail-inbox'));
      await mkdir(path.join(tmpDir, 'gmail-send'));
      await writeFile(path.join(tmpDir, 'README.md'), '');
      const target = { ...baseTarget, url: 'https://api.example.com/v1', seedDir: tmpDir };
      const result = await resolveSeedUrls(target);
      expect(result).toContain('https://api.example.com/v1/gmail-inbox');
      expect(result).toContain('https://api.example.com/v1/gmail-send');
      expect(result.filter((u) => u.endsWith('README.md'))).toEqual([]);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('skips dotfiles and underscore-prefixed dirs (Supabase _shared convention)', async () => {
    const tmpDir = await mkdtemp(path.join(tmpdir(), 'seed-test-'));
    try {
      await mkdir(path.join(tmpDir, '_shared'));
      await mkdir(path.join(tmpDir, '.git'));
      await mkdir(path.join(tmpDir, 'real-fn'));
      const target = { ...baseTarget, url: 'https://x.com', seedDir: tmpDir };
      const result = await resolveSeedUrls(target);
      expect(result).toContain('https://x.com/real-fn');
      expect(result).not.toContain('https://x.com/_shared');
      expect(result).not.toContain('https://x.com/.git');
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('throws if seedDir does not exist, naming the absolute path', async () => {
    const target = { ...baseTarget, url: 'https://x.com', seedDir: '/nonexistent/xyz/123' };
    await expect(resolveSeedUrls(target)).rejects.toThrow(
      /seedDir does not exist.*\/nonexistent\/xyz\/123/
    );
  });

  it('warns and falls back when seedDir is empty (no failure)', async () => {
    const tmpDir = await mkdtemp(path.join(tmpdir(), 'seed-test-'));
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const target = { ...baseTarget, url: 'https://x.com', seedDir: tmpDir };
      const result = await resolveSeedUrls(target);
      expect(result).toEqual(['https://x.com']);
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringMatching(/seedDir.*no subdirectories/));
    } finally {
      stderrSpy.mockRestore();
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('combines seedDir and seedUrls, dedupes preserving order', async () => {
    const tmpDir = await mkdtemp(path.join(tmpdir(), 'seed-test-'));
    try {
      await mkdir(path.join(tmpDir, 'foo'));
      const target = {
        ...baseTarget,
        url: 'https://x.com',
        seedDir: tmpDir,
        seedUrls: ['https://x.com/foo', 'https://x.com/bar'],
      };
      const result = await resolveSeedUrls(target);
      expect(result).toEqual(['https://x.com', 'https://x.com/foo', 'https://x.com/bar']);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('resolves relative seedDir against cwd argument', async () => {
    const cwdDir = await mkdtemp(path.join(tmpdir(), 'cwd-'));
    try {
      await mkdir(path.join(cwdDir, 'sub'));
      await mkdir(path.join(cwdDir, 'sub', 'fn'));
      const target = { ...baseTarget, url: 'https://x.com', seedDir: 'sub' };
      const result = await resolveSeedUrls(target, cwdDir);
      expect(result).toContain('https://x.com/fn');
    } finally {
      await rm(cwdDir, { recursive: true, force: true });
    }
  });
});
