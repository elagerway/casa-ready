import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { summarize } from '../../cli/lib/summarize.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, '..', 'fixtures', 'sample-results.json');

describe('summarize', () => {
  it('produces a markdown summary with sections per risk level', async () => {
    const json = JSON.parse(await readFile(fixturePath, 'utf8'));
    const md = summarize(json);
    expect(md).toMatch(/^# CASA Ready Scan Summary/m);
    expect(md).toMatch(/## High Risk/);
    expect(md).toMatch(/## Low Risk/);
    expect(md).toContain('Content Security Policy (CSP) Header Not Set');
    expect(md).toContain('CWE-693');
    expect(md).toContain('Strict-Transport-Security Header Not Set');
  });

  it('flags third-party CDN findings as likely NA', async () => {
    const json = JSON.parse(await readFile(fixturePath, 'utf8'));
    const md = summarize(json);
    expect(md).toMatch(/likely NA.*cdn\.jsdelivr\.net/i);
  });

  it('returns "no findings" markdown for empty alert list', () => {
    const md = summarize({ site: [{ '@name': 'x', alerts: [] }] });
    expect(md).toMatch(/no findings/i);
  });

  it('handles results.json with no site array gracefully', () => {
    const md = summarize({});
    expect(md).toMatch(/no findings/i);
  });
});
