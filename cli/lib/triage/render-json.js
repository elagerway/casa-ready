const CATEGORIES = ['actionable', 'saq-explainable', 'noise', 'unknown'];

/**
 * Render aggregated classified findings into a structured object suitable for JSON.stringify.
 * Same input shape as renderMarkdown.
 */
export function renderJson({ runId, generatedAt, targetsIncluded, failures, findings }) {
  const byCategory = {};
  for (const cat of CATEGORIES) {
    const matching = findings.filter((f) => f.category === cat);
    byCategory[cat] = {
      unique: matching.length,
      instances: matching.reduce((s, f) => s + (f.instanceCount || 0), 0),
    };
  }

  return {
    schemaVersion: 1,
    runId,
    generatedAt,
    targetsIncluded: [...targetsIncluded],
    summary: {
      totalUniqueAlerts: findings.length,
      totalInstances: findings.reduce((s, f) => s + (f.instanceCount || 0), 0),
      byCategory,
    },
    findings: findings.map((f) => ({
      targetName: f.targetName,
      alertName: f.alertName,
      pluginId: f.pluginId,
      cweId: f.cweId,
      riskCode: f.riskCode,
      instanceCount: f.instanceCount,
      category: f.category,
      ruleSlug: f.ruleSlug,
      ruleSourceFile: f.ruleSourceFile,
      suggestedSaqSection: f.suggestedSaqSection,
      suggestedSaqSectionTitle: f.suggestedSaqSectionTitle,
      evidence: (f.evidence || []).map((e) => ({
        uri: e.uri, method: e.method, param: e.param || '',
      })),
    })),
    failures: failures.map((f) => ({
      targetName: f.name, error: f.error, stage: f.stage,
    })),
  };
}
