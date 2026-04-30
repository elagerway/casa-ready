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

  it('includes target name in the title when options.targetName is provided', () => {
    const md = summarize(
      { site: [{ '@name': 'x', alerts: [] }] },
      { targetName: 'api' }
    );
    expect(md).toMatch(/^# CASA Ready Scan Summary — api/m);
  });

  it('handles results.json with no site array gracefully', () => {
    const md = summarize({});
    expect(md).toMatch(/no findings/i);
  });

  it('emits "CWE: N/A" when an alert has no cweid (real ZAP omits it on some informational findings)', () => {
    const md = summarize({
      site: [
        {
          '@name': 'x',
          alerts: [
            {
              alert: 'Mystery info',
              riskcode: '0',
              confidence: '1',
              count: '1',
              instances: [{ uri: 'https://x/' }],
              solution: '',
              // cweid intentionally absent
            },
          ],
        },
      ],
    });
    expect(md).toContain('- CWE: N/A');
    expect(md).not.toContain('CWE-undefined');
  });

  it('does NOT flag an alert with mixed first-party + third-party instances as fully NA', () => {
    const md = summarize({
      site: [
        {
          '@name': 'x',
          alerts: [
            {
              alert: 'Header missing',
              riskcode: '1',
              confidence: '3',
              cweid: '693',
              count: '2',
              instances: [
                { uri: 'https://magpipe.ai/page' },
                { uri: 'https://cdn.jsdelivr.net/lib.js' },
              ],
              solution: 'Set the header.',
            },
          ],
        },
      ],
    });
    // Expect a partial-NA note, not a "all instances" pure NA flag
    expect(md).toMatch(/1\/2 instances on third-party hosts/);
    expect(md).toMatch(/first-party instances still need triage/);
    expect(md).not.toMatch(/all instances on third-party hosts/);
  });

  it('flags fully NA when ALL instances are on third-party hosts', () => {
    const md = summarize({
      site: [
        {
          '@name': 'x',
          alerts: [
            {
              alert: 'CDN-only header',
              riskcode: '1',
              confidence: '3',
              cweid: '693',
              count: '2',
              instances: [
                { uri: 'https://cdn.jsdelivr.net/a.js' },
                { uri: 'https://unpkg.com/b.js' },
              ],
              solution: 'Set the header.',
            },
          ],
        },
      ],
    });
    expect(md).toMatch(/all instances on third-party hosts/);
  });

  it('respects options.extraThirdPartyPatterns to extend the default CDN list', () => {
    const md = summarize(
      {
        site: [
          {
            '@name': 'x',
            alerts: [
              {
                alert: 'CDN-only header',
                riskcode: '1',
                confidence: '3',
                cweid: '693',
                count: '1',
                instances: [{ uri: 'https://d111111abcdef8.cloudfront.net/asset.js' }],
                solution: 'Set the header.',
              },
            ],
          },
        ],
      },
      { extraThirdPartyPatterns: [/cloudfront\.net/] }
    );
    expect(md).toMatch(/all instances on third-party hosts.*cloudfront\.net/);
  });
});
