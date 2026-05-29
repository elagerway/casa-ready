import { describe, it, expect, beforeAll } from 'vitest';
import { classify } from '../../cli/lib/triage/classify.js';
import { loadRulesIndex } from '../../cli/lib/triage/rules-loader.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RULES_DIR = path.join(__dirname, '..', '..', 'configs', 'casa', 'rules');

async function loadFixture(name) {
  const raw = await readFile(path.join(__dirname, 'fixtures', name), 'utf8');
  return JSON.parse(raw);
}

describe('classify', () => {
  let rulesIndex;
  beforeAll(async () => {
    rulesIndex = await loadRulesIndex(RULES_DIR);
  });

  it('classifies known plugin IDs into their rule categories', async () => {
    const results = await loadFixture('magpipe-results.json');
    const classified = classify({ results, rulesIndex, targetName: 'api' });

    expect(classified.findings).toHaveLength(3);
    const corsFinding = classified.findings.find((f) => f.alertName === 'Cross-Domain Misconfiguration');
    expect(corsFinding.category).toBe('actionable');
    expect(corsFinding.ruleSlug).toBe('cross-domain-misconfiguration');
    expect(corsFinding.suggestedSaqSection).toBe('2.4');

    const errorFinding = classified.findings.find((f) => f.alertName === 'Application Error Disclosure');
    expect(errorFinding.category).toBe('saq-explainable');

    const stripeFinding = classified.findings.find((f) => f.alertName === 'Cross-Domain JavaScript Source File Inclusion');
    expect(stripeFinding.category).toBe('noise');
  });

  it('counts instances per finding', async () => {
    const results = await loadFixture('magpipe-results.json');
    const classified = classify({ results, rulesIndex, targetName: 'api' });
    const errorFinding = classified.findings.find((f) => f.alertName === 'Application Error Disclosure');
    expect(errorFinding.instanceCount).toBe(2);
    expect(errorFinding.evidence).toHaveLength(2);
  });

  it('marks unmapped findings as Unknown', async () => {
    const results = await loadFixture('all-unknown-scan.json');
    const classified = classify({ results, rulesIndex, targetName: 'web' });
    expect(classified.findings).toHaveLength(1);
    expect(classified.findings[0].category).toBe('unknown');
    expect(classified.findings[0].ruleSlug).toBeNull();
  });

  it('returns empty findings for empty scans', async () => {
    const results = await loadFixture('empty-scan.json');
    const classified = classify({ results, rulesIndex, targetName: 'api' });
    expect(classified.findings).toHaveLength(0);
  });

  it('aggregates findings across multiple targets when called multiple times', async () => {
    const results1 = await loadFixture('magpipe-results.json');
    const c1 = classify({ results: results1, rulesIndex, targetName: 'api' });
    const c2 = classify({ results: results1, rulesIndex, targetName: 'web' });
    // Each call returns its own per-target classification — aggregation is the orchestrator's job
    expect(c1.targetName).toBe('api');
    expect(c2.targetName).toBe('web');
  });

  it('preserves evidence URIs in classified findings', async () => {
    const results = await loadFixture('magpipe-results.json');
    const classified = classify({ results, rulesIndex, targetName: 'api' });
    const corsFinding = classified.findings.find((f) => f.alertName === 'Cross-Domain Misconfiguration');
    expect(corsFinding.evidence[0].uri).toBe('https://hldlhskdpnyrqemyxidg.supabase.co/functions/v1/users');
  });
});
