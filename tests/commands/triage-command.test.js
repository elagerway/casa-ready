/**
 * Tests for runTriageCommand (Fix #1):
 * Verifies that the CLI correctly surfaces scan failures in exit code and output.
 *
 * (a) all-failed: every target directory has no results.json → exitCode 2, no "You're clear"
 * (b) partial: one target has results.json (with findings), one has no results.json
 *     → exitCode 1, output contains "⚠ Note:" warning about failed target
 * (c) genuine clean: one target with empty-scan results → exitCode 0, output contains "You're clear"
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, mkdir, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTriageCommand } from '../../cli/commands/triage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, '..', 'triage', 'fixtures');

describe('runTriageCommand — failure surface (Fix #1)', () => {
  let stdoutOutput = '';
  let stderrOutput = '';
  let stdoutSpy;
  let stderrSpy;

  afterEach(() => {
    stdoutSpy?.mockRestore();
    stderrSpy?.mockRestore();
    stdoutOutput = '';
    stderrOutput = '';
  });

  function spyOutput() {
    stdoutOutput = '';
    stderrOutput = '';
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutOutput += String(chunk);
      return true;
    });
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrOutput += String(chunk);
      return true;
    });
  }

  it('(a) all-failed: exits 2 and never says "You\'re clear" when all targets have no results.json', async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), 'triage-cmd-test-'));
    try {
      // Create a target directory with no results.json
      await mkdir(path.join(tmp, 'api'));
      spyOutput();
      const result = await runTriageCommand({ scanRunPath: tmp });
      const combined = stdoutOutput + stderrOutput;
      expect(result.exitCode).toBe(2);
      expect(combined).toMatch(/failed to scan/i);
      expect(combined).not.toContain("You're clear");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('(b) partial: exits 1 with actionable findings and warns about failed target', async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), 'triage-cmd-test-'));
    try {
      // api: has results.json with actionable findings
      await mkdir(path.join(tmp, 'api'));
      await copyFile(
        path.join(FIXTURES, 'magpipe-results.json'),
        path.join(tmp, 'api', 'results.json')
      );
      // web: missing results.json (failed target)
      await mkdir(path.join(tmp, 'web'));
      spyOutput();
      const result = await runTriageCommand({ scanRunPath: tmp });
      const combined = stdoutOutput + stderrOutput;
      expect(result.exitCode).toBe(1);
      // Must contain the partial-failure warning
      expect(combined).toMatch(/⚠ Note:/);
      expect(combined).toMatch(/failed to scan/i);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('(c) genuine clean: exits 0 and says "You\'re clear" when all targets scanned OK and no findings', async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), 'triage-cmd-test-'));
    try {
      // api: has empty-scan results.json (no findings)
      await mkdir(path.join(tmp, 'api'));
      await copyFile(
        path.join(FIXTURES, 'empty-scan.json'),
        path.join(tmp, 'api', 'results.json')
      );
      spyOutput();
      const result = await runTriageCommand({ scanRunPath: tmp });
      const combined = stdoutOutput + stderrOutput;
      expect(result.exitCode).toBe(0);
      expect(combined).toContain("You're clear");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
