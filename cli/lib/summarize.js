const RISK_LABEL = {
  '3': 'High Risk',
  '2': 'Medium Risk',
  '1': 'Low Risk',
  '0': 'Informational',
};

const RISK_ORDER = ['3', '2', '1', '0'];

const DEFAULT_THIRD_PARTY_HOST_PATTERNS = [
  /cdn\.jsdelivr\.net/,
  /cdnjs\.cloudflare\.com/,
  /unpkg\.com/,
  /googletagmanager\.com/,
  /google-analytics\.com/,
];

/**
 * Reduce a parsed ZAP results.json into a markdown triage summary.
 *
 * @param {object} results — parsed ZAP results.json (see fixture)
 * @param {object} [options]
 * @param {RegExp[]} [options.extraThirdPartyPatterns] — additional host
 *   regexes to treat as third-party (e.g. user's own CDN, fastly, akamai).
 *   Merged with the default list; not a replacement.
 */
export function summarize(results, options = {}) {
  const sites = Array.isArray(results.site) ? results.site : [];
  const allAlerts = sites.flatMap((s) =>
    (s.alerts || []).map((a) => ({ ...a, site: s['@name'] }))
  );

  const heading = options.targetName
    ? `# CASA Ready Scan Summary — ${options.targetName}`
    : '# CASA Ready Scan Summary';

  if (allAlerts.length === 0) {
    return `${heading}\n\nNo findings.\n`;
  }

  const thirdPartyPatterns = [
    ...DEFAULT_THIRD_PARTY_HOST_PATTERNS,
    ...(options.extraThirdPartyPatterns || []),
  ];

  const grouped = groupByRisk(allAlerts);
  const lines = [heading, ''];
  lines.push(`Total findings: ${allAlerts.length}`);
  lines.push('');

  for (const risk of RISK_ORDER) {
    const alerts = grouped[risk] || [];
    if (alerts.length === 0) continue;
    lines.push(`## ${RISK_LABEL[risk]}`);
    lines.push('');
    for (const alert of alerts) {
      lines.push(`### ${alert.alert}`);
      lines.push('');
      lines.push(alert.cweid ? `- CWE-${alert.cweid}` : '- CWE: N/A');
      lines.push(`- Confidence: ${alert.confidence}`);
      lines.push(`- Instances: ${alert.count}`);
      const naFlag = checkLikelyNA(alert, thirdPartyPatterns);
      if (naFlag) {
        lines.push(`- **Likely NA:** ${naFlag}`);
      }
      lines.push('');
      lines.push(`> ${(alert.solution || '').replace(/\r?\n/g, ' ')}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

function groupByRisk(alerts) {
  const out = {};
  for (const a of alerts) {
    const key = String(a.riskcode);
    if (!out[key]) out[key] = [];
    out[key].push(a);
  }
  return out;
}

function checkLikelyNA(alert, patterns) {
  const instances = alert.instances || [];
  if (instances.length === 0) return null;

  const cdnHits = instances.filter((inst) =>
    patterns.some((p) => p.test(inst.uri))
  );
  if (cdnHits.length === 0) return null;

  // Only flag as fully NA when EVERY instance is on a third-party host.
  // A mixed alert (some first-party, some third-party) is still a real finding
  // for the first-party instances — call that out instead of dismissing it.
  if (cdnHits.length === instances.length) {
    return `all instances on third-party hosts (${cdnHits[0].uri})`;
  }
  return `${cdnHits.length}/${instances.length} instances on third-party hosts (${cdnHits[0].uri}) — first-party instances still need triage`;
}
