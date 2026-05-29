import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../../cli/lib/triage/render-md.js';

const sampleClassified = {
  runId: 'scan-output/prod/2026-05-01T22-35-47-153Z',
  generatedAt: '2026-05-01T22:36:00Z',
  targetsIncluded: ['api', 'web'],
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
      ruleSourceFile: 'cross-domain-misconfiguration.md',
      suggestedSaqSection: '2.4',
      suggestedSaqSectionTitle: 'Network Security',
      evidence: [{ uri: 'https://api.example.com/users', method: 'OPTIONS', param: '', evidence: '' }],
      rawSolution: '<p>Fix CORS.</p>',
    },
    {
      targetName: 'api',
      alertName: 'Application Error Disclosure',
      pluginId: 90022,
      cweId: 200,
      riskCode: 2,
      instanceCount: 2,
      category: 'saq-explainable',
      ruleSlug: 'application-error-disclosure',
      ruleSourceFile: 'application-error-disclosure.md',
      suggestedSaqSection: '3.1',
      suggestedSaqSectionTitle: 'Error Handling',
      evidence: [
        { uri: 'https://api.example.com/feed', method: 'GET', param: '', evidence: '' },
        { uri: 'https://api.example.com/profile', method: 'GET', param: '', evidence: '' },
      ],
      rawSolution: '<p>Review.</p>',
    },
  ],
};

describe('renderMarkdown', () => {
  it('emits required heading + summary + sections', () => {
    const md = renderMarkdown(sampleClassified);
    expect(md).toMatch(/^# CASA Ready Triage/);
    expect(md).toContain('## Summary');
    expect(md).toContain('## Actionable');
    expect(md).toContain('## SAQ-explainable');
    expect(md).toContain('Cross-Domain Misconfiguration');
    expect(md).toContain('Application Error Disclosure');
  });

  it('includes evidence URIs in body', () => {
    const md = renderMarkdown(sampleClassified);
    expect(md).toContain('https://api.example.com/users');
    expect(md).toContain('https://api.example.com/feed');
  });

  it('includes rule file reference for each finding', () => {
    const md = renderMarkdown(sampleClassified);
    expect(md).toContain('configs/casa/rules/cross-domain-misconfiguration.md');
  });

  it('includes suggested SAQ section for each rule-matched finding', () => {
    const md = renderMarkdown(sampleClassified);
    expect(md).toContain('§2.4');
    expect(md).toContain('Network Security');
  });

  it('emits Next step block at the end', () => {
    const md = renderMarkdown(sampleClassified);
    expect(md).toMatch(/Next step:/);
    expect(md).toMatch(/casa-ready:triage-findings/);
  });

  it('handles zero-findings scans', () => {
    const md = renderMarkdown({
      runId: 'scan-output/prod/2026-05-01',
      generatedAt: '2026-05-01T22:36:00Z',
      targetsIncluded: ['api'],
      failures: [],
      findings: [],
    });
    expect(md).toMatch(/No findings to triage/);
    expect(md).toMatch(/Next step:/);
  });

  it('renders Failures section when failures present', () => {
    const md = renderMarkdown({
      runId: 'scan-output/prod/2026-05-01',
      generatedAt: '2026-05-01T22:36:00Z',
      targetsIncluded: ['api'],
      failures: [{ name: 'oauth-callback', error: 'URL_NOT_IN_CONTEXT', stage: 'runZap' }],
      findings: [],
    });
    expect(md).toContain('## Failures');
    expect(md).toContain('oauth-callback');
    expect(md).toContain('URL_NOT_IN_CONTEXT');
  });

  it('groups by category in fixed order: Actionable → SAQ-explainable → Noise → Unknown', () => {
    const md = renderMarkdown({
      runId: 'scan-output/prod/2026-05-01',
      generatedAt: '2026-05-01T22:36:00Z',
      targetsIncluded: ['api'],
      failures: [],
      findings: [
        { ...sampleClassified.findings[0], category: 'noise' },
        { ...sampleClassified.findings[1], category: 'actionable' },
        { ...sampleClassified.findings[0], alertName: 'X', category: 'unknown' },
      ],
    });
    const idxAct = md.indexOf('## Actionable');
    const idxNoise = md.indexOf('## Noise');
    const idxUnk = md.indexOf('## Unknown');
    expect(idxAct).toBeGreaterThan(0);
    expect(idxNoise).toBeGreaterThan(idxAct);
    expect(idxUnk).toBeGreaterThan(idxNoise);
  });

  // Regression: Bug 1 — well-formed finding headings for all 4 cweId/pluginId combinations
  it('renders well-formed ### headings for all cweId/pluginId combinations', () => {
    const basefinding = {
      targetName: 'api',
      alertName: 'Alert',
      riskCode: 2,
      instanceCount: 1,
      category: 'actionable',
      ruleSlug: null,
      ruleSourceFile: null,
      suggestedSaqSection: null,
      suggestedSaqSectionTitle: null,
      evidence: [{ uri: 'https://example.com', method: 'GET', param: '', evidence: '' }],
    };

    // both cweId and pluginId present
    const mdBoth = renderMarkdown({
      runId: 'scan-output/prod/2026-05-01',
      generatedAt: '2026-05-01T22:36:00Z',
      targetsIncluded: ['api'],
      failures: [],
      findings: [{ ...basefinding, cweId: 264, pluginId: 10098 }],
    });

    // cweId only (no pluginId)
    const mdCweOnly = renderMarkdown({
      runId: 'scan-output/prod/2026-05-01',
      generatedAt: '2026-05-01T22:36:00Z',
      targetsIncluded: ['api'],
      failures: [],
      findings: [{ ...basefinding, cweId: 200, pluginId: null }],
    });

    // pluginId only (no cweId — null)
    const mdPluginOnly = renderMarkdown({
      runId: 'scan-output/prod/2026-05-01',
      generatedAt: '2026-05-01T22:36:00Z',
      targetsIncluded: ['api'],
      failures: [],
      findings: [{ ...basefinding, cweId: null, pluginId: 10098 }],
    });

    // neither (both null)
    const mdNeither = renderMarkdown({
      runId: 'scan-output/prod/2026-05-01',
      generatedAt: '2026-05-01T22:36:00Z',
      targetsIncluded: ['api'],
      failures: [],
      findings: [{ ...basefinding, cweId: null, pluginId: null }],
    });

    // pluginId only with cweId=0 (ZAP emits cweid="0" for some alerts)
    const mdCweZero = renderMarkdown({
      runId: 'scan-output/prod/2026-05-01',
      generatedAt: '2026-05-01T22:36:00Z',
      targetsIncluded: ['api'],
      failures: [],
      findings: [{ ...basefinding, cweId: 0, pluginId: 10098 }],
    });

    // Extract the ### heading lines
    const heading = (md) => md.split('\n').find((l) => l.startsWith('### Alert'));

    expect(heading(mdBoth)).toBe('### Alert (CWE-264, plugin 10098)');
    expect(heading(mdCweOnly)).toBe('### Alert (CWE-200)');
    expect(heading(mdPluginOnly)).toBe('### Alert (plugin 10098)');
    expect(heading(mdNeither)).toBe('### Alert');
    expect(heading(mdCweZero)).toBe('### Alert (plugin 10098)');

    // Additional negative assertions: no malformed headings
    // No leading comma in bracket, no stray unmatched closing paren
    for (const md of [mdBoth, mdCweOnly, mdPluginOnly, mdNeither, mdCweZero]) {
      const h = heading(md);
      expect(h).not.toMatch(/\(,/);               // no "(, ..."
      expect(h).not.toMatch(/, plugin.*\)[^(]/);  // no ", plugin N)" without an opening "("
      // heading either ends with no paren, or has balanced parens
      const opens = (h.match(/\(/g) || []).length;
      const closes = (h.match(/\)/g) || []).length;
      expect(opens).toBe(closes);
    }
  });

  // Regression: Bug 2 — failures-only run must NOT emit "You're clear" / "Proceed to TAC portal upload"
  it('failures-only run emits re-run message, not "You\'re clear"', () => {
    const md = renderMarkdown({
      runId: 'scan-output/prod/2026-05-01',
      generatedAt: '2026-05-01T22:36:00Z',
      targetsIncluded: [],
      failures: [{ name: 'oauth-callback', error: 'URL_NOT_IN_CONTEXT', stage: 'runZap' }],
      findings: [],
    });

    expect(md).not.toContain("You're clear");
    expect(md).not.toContain('Proceed to TAC portal upload');
    expect(md).toContain('failed to scan');
    expect(md).toContain('casa-ready scan');
  });
});
