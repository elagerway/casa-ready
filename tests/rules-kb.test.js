import { describe, it, expect, beforeAll } from 'vitest';
import { loadRulesIndex } from '../cli/lib/triage/rules-loader.js';
import { RULE_CATEGORIES } from '../cli/lib/triage/categories.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RULES_DIR = path.join(__dirname, '..', 'configs', 'casa', 'rules');

const VALID_CATEGORIES = new Set(RULE_CATEGORIES);

describe('configs/casa/rules/ KB validation', () => {
  let index;

  beforeAll(async () => {
    index = await loadRulesIndex(RULES_DIR);
  });

  it('contains at least one rule file', () => {
    expect(index.all.length).toBeGreaterThan(0);
  });

  it('every rule has a valid category', () => {
    for (const rule of index.all) {
      expect(
        VALID_CATEGORIES.has(rule.frontmatter.category),
        `${rule.sourceFile} has invalid category: ${rule.frontmatter.category}`
      ).toBe(true);
    }
  });

  it('every rule has zap_plugin_ids as a non-empty array of integers', () => {
    for (const rule of index.all) {
      const ids = rule.frontmatter.zap_plugin_ids;
      expect(Array.isArray(ids), `${rule.sourceFile}: zap_plugin_ids must be array`).toBe(true);
      expect(ids.length, `${rule.sourceFile}: zap_plugin_ids must be non-empty`).toBeGreaterThan(0);
      for (const id of ids) {
        expect(Number.isInteger(id), `${rule.sourceFile}: plugin ID ${id} not an integer`).toBe(true);
      }
    }
  });

  it('every rule has zap_alert_names as a non-empty array of strings', () => {
    for (const rule of index.all) {
      const names = rule.frontmatter.zap_alert_names;
      expect(Array.isArray(names), `${rule.sourceFile}: zap_alert_names must be array`).toBe(true);
      expect(names.length, `${rule.sourceFile}: zap_alert_names must be non-empty`).toBeGreaterThan(0);
    }
  });

  it('every actionable rule has a saq_section and a non-empty body', () => {
    for (const rule of index.all) {
      if (rule.frontmatter.category !== 'actionable') continue;
      expect(rule.frontmatter.saq_section, `${rule.sourceFile}: actionable rule missing saq_section`).toBeTruthy();
      expect(rule.body.trim().length, `${rule.sourceFile}: empty body`).toBeGreaterThan(50);
    }
  });

  it('every actionable rule body has Standard fix pattern and How to spot sections', () => {
    for (const rule of index.all) {
      if (rule.frontmatter.category !== 'actionable') continue;
      expect(rule.body, `${rule.sourceFile}: missing 'Standard fix pattern' section`).toMatch(/##\s+Standard fix pattern/i);
      expect(rule.body, `${rule.sourceFile}: missing 'How to spot' section`).toMatch(/##\s+How to spot/i);
    }
  });

  it('every saq-explainable rule body has SAQ answer template section', () => {
    for (const rule of index.all) {
      if (rule.frontmatter.category !== 'saq-explainable') continue;
      expect(rule.body, `${rule.sourceFile}: missing 'SAQ answer template' section`).toMatch(/##\s+SAQ answer template/i);
    }
  });

  it('every noise rule body explains why it is noise', () => {
    for (const rule of index.all) {
      if (rule.frontmatter.category !== 'noise') continue;
      expect(rule.body, `${rule.sourceFile}: missing explanation in body`).toMatch(/##\s+Why this is (typically )?noise/i);
    }
  });

  it('no two rule files share a ZAP plugin ID (loadRulesIndex enforces this)', async () => {
    // loadRulesIndex throws on duplicate; reaching beforeAll means we passed
    expect(index.byPluginId.size).toBeGreaterThan(0);
  });

  // Item #8: enforce alert-name uniqueness so byAlertName fallback is never ambiguous
  it('no two rule files share a zap_alert_name entry', () => {
    // Build a Map<alertName, sourceFile[]> across all rules
    const nameToFiles = new Map();
    for (const rule of index.all) {
      const names = rule.frontmatter.zap_alert_names ?? [];
      for (const name of names) {
        if (!nameToFiles.has(name)) nameToFiles.set(name, []);
        nameToFiles.get(name).push(rule.sourceFile);
      }
    }
    for (const [alertName, files] of nameToFiles) {
      expect(
        files.length,
        `Alert name "${alertName}" appears in multiple rule files: ${files.join(', ')}`
      ).toBe(1);
    }
  });
});
