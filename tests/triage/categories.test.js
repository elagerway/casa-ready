import { describe, it, expect } from 'vitest';
import { CATEGORY_ORDER, UNKNOWN_CATEGORY, RULE_CATEGORIES } from '../../cli/lib/triage/categories.js';

describe('triage/categories', () => {
  it('CATEGORY_ORDER contains UNKNOWN_CATEGORY', () => {
    expect(CATEGORY_ORDER).toContain(UNKNOWN_CATEGORY);
  });

  it('RULE_CATEGORIES does NOT contain UNKNOWN_CATEGORY', () => {
    expect(RULE_CATEGORIES).not.toContain(UNKNOWN_CATEGORY);
  });

  it('RULE_CATEGORIES is a strict subset of CATEGORY_ORDER', () => {
    for (const cat of RULE_CATEGORIES) {
      expect(CATEGORY_ORDER).toContain(cat);
    }
  });

  it('CATEGORY_ORDER has exactly one more entry than RULE_CATEGORIES (the unknown sentinel)', () => {
    expect(CATEGORY_ORDER.length).toBe(RULE_CATEGORIES.length + 1);
  });
});
