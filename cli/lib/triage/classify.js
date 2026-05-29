/**
 * Classify a single target's ZAP results.json against the rules index.
 *
 * @param {object} args
 * @param {object} args.results — parsed ZAP results.json
 * @param {object} args.rulesIndex — from loadRulesIndex()
 * @param {string} args.targetName — for cross-target aggregation later
 * @returns {{ targetName: string, findings: Array }}
 */
export function classify({ results, rulesIndex, targetName }) {
  const sites = Array.isArray(results.site) ? results.site : [];
  const findings = [];

  for (const site of sites) {
    const alerts = Array.isArray(site.alerts) ? site.alerts : [];
    for (const alert of alerts) {
      const pluginId = alert.pluginid ? parseInt(alert.pluginid, 10) : null;
      const rule = rulesIndex.byPluginId.get(pluginId)
        ?? rulesIndex.byAlertName.get(alert.alert)
        ?? rulesIndex.byAlertName.get(alert.name);

      const instances = Array.isArray(alert.instances) ? alert.instances : [];
      const evidence = instances.map((inst) => ({
        uri: inst.uri,
        method: inst.method,
        param: inst.param || '',
        evidence: inst.evidence || '',
      }));

      findings.push({
        targetName,
        siteName: site['@name'],
        alertName: alert.alert,
        pluginId,
        cweId: alert.cweid ? parseInt(alert.cweid, 10) : null,
        riskCode: parseInt(alert.riskcode, 10),
        confidence: parseInt(alert.confidence, 10),
        instanceCount: parseInt(alert.count, 10) || instances.length,
        evidence,
        rawSolution: alert.solution || '',
        rawDescription: alert.desc || '',
        // Rule-derived fields (null if no rule matches)
        ruleSlug: rule?.frontmatter.slug ?? null,
        category: rule?.frontmatter.category ?? 'unknown',
        suggestedSaqSection: rule?.frontmatter.saq_section ?? null,
        suggestedSaqSectionTitle: rule?.frontmatter.saq_section_title ?? null,
        ruleSourceFile: rule?.sourceFile ?? null,
        ruleSourcePath: rule?.sourcePath ?? null,
      });
    }
  }

  return { targetName, findings };
}
