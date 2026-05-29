import { describe, it, expect } from 'vitest';
import { findLatestScanRun } from '../../cli/lib/triage/find-latest-scan.js';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

describe('findLatestScanRun', () => {
  it('finds newest <env>/<timestamp>/ dir under scan-output/', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'find-latest-'));
    try {
      const scanOutput = path.join(root, 'scan-output');
      await mkdir(path.join(scanOutput, 'staging', '2026-04-30T20-21-18-097Z'), { recursive: true });
      await mkdir(path.join(scanOutput, 'prod', '2026-05-01T22-35-47-153Z'), { recursive: true });
      await mkdir(path.join(scanOutput, 'prod', '2026-04-29T10-00-00-000Z'), { recursive: true });

      const found = await findLatestScanRun(root);
      expect(found).toBe(path.join(scanOutput, 'prod', '2026-05-01T22-35-47-153Z'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('returns null when scan-output/ does not exist', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'find-latest-'));
    try {
      const found = await findLatestScanRun(root);
      expect(found).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('returns null when scan-output/ is empty', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'find-latest-'));
    try {
      await mkdir(path.join(root, 'scan-output'), { recursive: true });
      const found = await findLatestScanRun(root);
      expect(found).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('skips non-directory entries', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'find-latest-'));
    try {
      const scanOutput = path.join(root, 'scan-output');
      await mkdir(path.join(scanOutput, 'staging', '2026-05-01T22-00-00-000Z'), { recursive: true });
      // Files at the env level should be skipped
      const { writeFile } = await import('node:fs/promises');
      await writeFile(path.join(scanOutput, '.DS_Store'), '', 'utf8');
      const found = await findLatestScanRun(root);
      expect(found).toBe(path.join(scanOutput, 'staging', '2026-05-01T22-00-00-000Z'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
