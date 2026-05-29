import { describe, it, expect } from 'vitest';
import { parseRuleFile, loadRulesIndex } from '../../cli/lib/triage/rules-loader.js';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

describe('parseRuleFile', () => {
  it('parses frontmatter and body', () => {
    const raw = `---
name: Test Rule
slug: test-rule
zap_plugin_ids: [10001, 10002]
zap_alert_names: ["Test Alert"]
cwe: 200
category: actionable
saq_section: "1.1"
saq_section_title: Test Section
severity_override: null
---

# Test Rule

## What ZAP detects
Test detection content.
`;
    const parsed = parseRuleFile(raw, 'test-rule.md');
    expect(parsed.frontmatter.name).toBe('Test Rule');
    expect(parsed.frontmatter.zap_plugin_ids).toEqual([10001, 10002]);
    expect(parsed.frontmatter.category).toBe('actionable');
    expect(parsed.body).toContain('## What ZAP detects');
  });

  it('throws on missing closing frontmatter delimiter', () => {
    const raw = `---
name: Broken
no closing delimiter
`;
    expect(() => parseRuleFile(raw, 'broken.md')).toThrow(/frontmatter/i);
  });

  it('throws on invalid YAML in frontmatter', () => {
    const raw = `---
name: [unclosed
---
body
`;
    expect(() => parseRuleFile(raw, 'bad-yaml.md')).toThrow();
  });

  // Fix #3: CRLF tolerance
  it('parses CRLF-delimited frontmatter without throwing', () => {
    const raw = '---\r\nname: X\r\nslug: x\r\nzap_plugin_ids: []\r\nzap_alert_names: []\r\ncwe: null\r\ncategory: noise\r\nseverity_override: null\r\n---\r\nbody text here';
    const parsed = parseRuleFile(raw, 'crlf-rule.md');
    expect(parsed.frontmatter.name).toBe('X');
    expect(parsed.body).toContain('body text here');
  });

  // Fix #3: closing --- at EOF with no trailing newline
  it('parses frontmatter when closing --- is at EOF with no trailing newline', () => {
    const raw = '---\nname: Y\nslug: y\nzap_plugin_ids: []\nzap_alert_names: []\ncwe: null\ncategory: noise\nseverity_override: null\n---';
    const parsed = parseRuleFile(raw, 'no-trailing-newline.md');
    expect(parsed.frontmatter.name).toBe('Y');
    // body is empty/whitespace
    expect(parsed.body.trim()).toBe('');
  });
});

describe('loadRulesIndex', () => {
  it('indexes rule files by zap_plugin_id', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'rules-test-'));
    try {
      await writeFile(path.join(dir, 'rule-a.md'), `---
name: A
slug: rule-a
zap_plugin_ids: [10001]
zap_alert_names: ["Alert A"]
cwe: 200
category: actionable
saq_section: "1.1"
saq_section_title: Sec
severity_override: null
---
body A`, 'utf8');
      await writeFile(path.join(dir, 'rule-b.md'), `---
name: B
slug: rule-b
zap_plugin_ids: [10002, 10003]
zap_alert_names: ["Alert B"]
cwe: 264
category: noise
severity_override: null
---
body B`, 'utf8');

      const index = await loadRulesIndex(dir);
      expect(index.byPluginId.get(10001).frontmatter.slug).toBe('rule-a');
      expect(index.byPluginId.get(10002).frontmatter.slug).toBe('rule-b');
      expect(index.byPluginId.get(10003).frontmatter.slug).toBe('rule-b');
      expect(index.all).toHaveLength(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // Fix #2: sourcePath attached to each parsed rule
  it('attaches an absolute sourcePath to each parsed rule', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'rules-test-'));
    try {
      await writeFile(path.join(dir, 'rule-a.md'), `---
name: A
slug: rule-a
zap_plugin_ids: [20001]
zap_alert_names: ["Alert A"]
cwe: 200
category: actionable
saq_section: "1.1"
saq_section_title: Sec
severity_override: null
---
body A`, 'utf8');

      const index = await loadRulesIndex(dir);
      const rule = index.byPluginId.get(20001);
      expect(rule).toBeDefined();
      expect(typeof rule.sourcePath).toBe('string');
      expect(path.isAbsolute(rule.sourcePath)).toBe(true);
      expect(rule.sourcePath).toMatch(/rule-a\.md$/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('throws on duplicate plugin IDs across rule files', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'rules-test-'));
    try {
      const fm = (slug) => `---
name: ${slug}
slug: ${slug}
zap_plugin_ids: [10001]
zap_alert_names: ["X"]
cwe: 200
category: actionable
saq_section: "1.1"
saq_section_title: Sec
severity_override: null
---
body`;
      await writeFile(path.join(dir, 'a.md'), fm('a'), 'utf8');
      await writeFile(path.join(dir, 'b.md'), fm('b'), 'utf8');

      await expect(loadRulesIndex(dir)).rejects.toThrow(/duplicate plugin id/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
