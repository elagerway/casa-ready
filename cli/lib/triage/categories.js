// Canonical CASA triage category taxonomy — single source of truth.
// Renderers, the classifier, and the rules-KB validation all import from here.

// Display/iteration order. 'unknown' is the sentinel for alerts with no matching rule.
export const CATEGORY_ORDER = ['actionable', 'saq-explainable', 'noise', 'unknown'];

// The category that classify() assigns when no rule matches an alert.
export const UNKNOWN_CATEGORY = 'unknown';

// Categories a rule FILE may declare in frontmatter (excludes the 'unknown' sentinel,
// which is assigned at classify time, never authored).
export const RULE_CATEGORIES = ['actionable', 'saq-explainable', 'noise'];
