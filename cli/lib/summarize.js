const RISK_LABEL = {
  '3': 'High Risk',
  '2': 'Medium Risk',
  '1': 'Low Risk',
  '0': 'Informational',
};

const RISK_ORDER = ['3', '2', '1', '0'];

const THIRD_PARTY_HOST_PATTERNS = [
  /cdn\.jsdelivr\.net/,
  /cdnjs\.cloudflare\.com/,
  /unpkg\.com/,
  /googletagmanager\.com/,
  /google-analytics\.com/,
];

export function summarize(results) {
  const sites = Array.isArray(results.site) ? results.site : [];
  const allAlerts = sites.flatMap((s) => (s.alerts || []).map((a) => ({ ...a, site: s['@name'] })));

  if (allAlerts.length === 0) {
    return '# CASA Ready Scan Summary\n\nNo findings.\n';
  }

  const grouped = groupByRisk(allAlerts);
  const lines = ['# CASA Ready Scan Summary', ''];
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
      lines.push(`- CWE-${alert.cweid}`);
      lines.push(`- Confidence: ${alert.confidence}`);
      lines.push(`- Instances: ${alert.count}`);
      const naFlag = checkLikelyNA(alert);
      if (naFlag) {
        lines.push(`- **Likely NA:** ${naFlag}`);
      }
      lines.push('');
      lines.push(`> ${(alert.solution || '').replace(/\n/g, ' ')}`);
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

function checkLikelyNA(alert) {
  const instances = alert.instances || [];
  for (const inst of instances) {
    for (const pattern of THIRD_PARTY_HOST_PATTERNS) {
      if (pattern.test(inst.uri)) {
        return `instance on third-party host (${inst.uri})`;
      }
    }
  }
  return null;
}
