import { describe, it, expect } from 'vitest';
import { renderJson } from '../../cli/lib/triage/render-json.js';

describe('renderJson', () => {
  it('produces structured object with summary + findings + failures', () => {
    const out = renderJson({
      runId: 'scan-output/prod/2026-05-01',
      generatedAt: '2026-05-01T22:36:00Z',
      targetsIncluded: ['api'],
      failures: [],
      findings: [
        {
          targetName: 'api',
          alertName: 'Cross-Domain Misconfiguration',
          pluginId: 10098,
          cweId: 264,
          riskCode: 2,
          instanceCount: 1,
          category: 'actionable',
          ruleSlug: 'cross-domain-misconfiguration',
          suggestedSaqSection: '2.4',
          suggestedSaqSectionTitle: 'Network Security',
          evidence: [{ uri: 'https://api.example.com/u', method: 'OPTIONS', param: '' }],
        },
      ],
    });

    expect(out.runId).toBe('scan-output/prod/2026-05-01');
    expect(out.summary).toBeDefined();
    expect(out.summary.totalUniqueAlerts).toBe(1);
    expect(out.summary.byCategory.actionable.unique).toBe(1);
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0].alertName).toBe('Cross-Domain Misconfiguration');
    expect(out.findings[0].evidence[0].uri).toBe('https://api.example.com/u');
    expect(out.failures).toEqual([]);
  });

  it('serializes to valid JSON', () => {
    const out = renderJson({
      runId: 'r', generatedAt: 'g', targetsIncluded: [], failures: [], findings: [],
    });
    const roundtrip = JSON.parse(JSON.stringify(out));
    expect(roundtrip).toEqual(out);
  });

  it('counts categories correctly', () => {
    const out = renderJson({
      runId: 'r', generatedAt: 'g', targetsIncluded: ['api'], failures: [],
      findings: [
        { category: 'actionable', instanceCount: 3, evidence: [] },
        { category: 'actionable', instanceCount: 1, evidence: [] },
        { category: 'noise', instanceCount: 5, evidence: [] },
      ],
    });
    expect(out.summary.byCategory.actionable.unique).toBe(2);
    expect(out.summary.byCategory.actionable.instances).toBe(4);
    expect(out.summary.byCategory.noise.unique).toBe(1);
    expect(out.summary.byCategory.noise.instances).toBe(5);
  });

  // Item #5: confidence field must be emitted in each finding
  it('emits confidence field in each finding', () => {
    const out = renderJson({
      runId: 'r', generatedAt: 'g', targetsIncluded: ['api'], failures: [],
      findings: [
        {
          targetName: 'api',
          alertName: 'Test Alert',
          pluginId: 12345,
          cweId: 200,
          riskCode: 2,
          confidence: 3,
          instanceCount: 1,
          category: 'actionable',
          ruleSlug: null,
          ruleSourceFile: null,
          ruleSourcePath: null,
          suggestedSaqSection: null,
          suggestedSaqSectionTitle: null,
          evidence: [],
        },
      ],
    });
    expect(out.findings[0]).toHaveProperty('confidence');
    expect(out.findings[0].confidence).toBe(3);
  });

  it('emits confidence: null when confidence is null (absent/absent-guarded)', () => {
    const out = renderJson({
      runId: 'r', generatedAt: 'g', targetsIncluded: ['api'], failures: [],
      findings: [
        {
          targetName: 'api',
          alertName: 'No Confidence Alert',
          pluginId: null,
          cweId: null,
          riskCode: null,
          confidence: null,
          instanceCount: 0,
          category: 'unknown',
          ruleSlug: null,
          ruleSourceFile: null,
          ruleSourcePath: null,
          suggestedSaqSection: null,
          suggestedSaqSectionTitle: null,
          evidence: [],
        },
      ],
    });
    expect(out.findings[0]).toHaveProperty('confidence');
    expect(out.findings[0].confidence).toBeNull();
  });
});
