const CATEGORY_ORDER = ['actionable', 'saq-explainable', 'noise', 'unknown'];
const CATEGORY_HEADING = {
  actionable: '## Actionable',
  'saq-explainable': '## SAQ-explainable',
  noise: '## Noise (third-party)',
  unknown: '## Unknown',
};
const CATEGORY_ACTION = {
  actionable: 'Code fix',
  'saq-explainable': 'SAQ answer text',
  noise: 'Dismiss',
  unknown: 'Manual review',
};

/**
 * Render aggregated classified findings into the triage.md contract.
 *
 * @param {object} args
 * @param {string} args.runId — scan-output/<env>/<ts>/ path string
 * @param {string} args.generatedAt — ISO timestamp
 * @param {string[]} args.targetsIncluded — successfully scanned target names
 * @param {Array} args.failures — { name, error, stage } per failed target
 * @param {Array} args.findings — classified findings (already aggregated cross-target)
 */
export function renderMarkdown({ runId, generatedAt, targetsIncluded, failures, findings }) {
  const lines = [];
  lines.push(`# CASA Ready Triage — ${runId.split('/').pop() ?? runId}`);
  lines.push('');
  lines.push(`**Scan run:** ${runId}`);
  lines.push(`**Targets included:** ${targetsIncluded.join(', ') || '(none)'}` +
    (failures.length ? ` (${failures.length} target(s) failed — see Failures)` : ''));
  const totalInstances = findings.reduce((s, f) => s + (f.instanceCount || 0), 0);
  lines.push(`**Total findings:** ${findings.length} unique alert types, ${totalInstances} instances`);
  lines.push(`**Generated:** ${generatedAt}`);
  lines.push('');

  if (findings.length === 0 && failures.length === 0) {
    lines.push('No findings to triage.');
    lines.push('');
    appendNextStep(lines, { actionableCount: 0, saqExplainableCount: 0 });
    return lines.join('\n');
  }

  // Summary table
  lines.push('## Summary');
  lines.push('');
  lines.push('| Category              | Unique alerts | Instances | Action required |');
  lines.push('|-----------------------|---------------|-----------|-----------------|');
  const counts = {};
  for (const cat of CATEGORY_ORDER) {
    const matching = findings.filter((f) => f.category === cat);
    counts[cat] = {
      unique: matching.length,
      instances: matching.reduce((s, f) => s + (f.instanceCount || 0), 0),
    };
  }
  for (const cat of CATEGORY_ORDER) {
    const c = counts[cat];
    lines.push(`| ${pad(labelFor(cat), 21)} | ${pad(String(c.unique), 13)} | ${pad(String(c.instances), 9)} | ${pad(CATEGORY_ACTION[cat], 15)} |`);
  }
  lines.push('');

  // Per-category sections
  for (const cat of CATEGORY_ORDER) {
    const matching = findings.filter((f) => f.category === cat);
    if (matching.length === 0) continue;
    lines.push(CATEGORY_HEADING[cat]);
    lines.push('');
    for (const f of matching) {
      lines.push(`### ${f.alertName}${f.cweId ? ` (CWE-${f.cweId}` : ''}${f.pluginId ? `, plugin ${f.pluginId})` : ')'}`);
      lines.push('');
      lines.push(`**Affected target:** ${f.targetName}`);
      lines.push(`**Instances:** ${f.instanceCount}`);
      if (f.ruleSourceFile) {
        lines.push(`**Rule:** configs/casa/rules/${f.ruleSourceFile}`);
      }
      if (f.suggestedSaqSection) {
        lines.push(`**Suggested SAQ section:** §${f.suggestedSaqSection} (${f.suggestedSaqSectionTitle ?? 'see rule file'})`);
      }
      lines.push('');
      lines.push('**Evidence (representative):**');
      const reps = f.evidence.slice(0, 3);
      for (const e of reps) {
        lines.push(`- \`${e.method} ${e.uri}\`${e.param ? ` (param: ${e.param})` : ''}`);
      }
      if (f.evidence.length > 3) lines.push(`- ... and ${f.evidence.length - 3} more (see results.html for full list)`);
      lines.push('');
      if (cat === 'actionable') {
        lines.push('**Why this is actionable:** see linked rule file for the standard fix pattern and CASA context.');
      } else if (cat === 'saq-explainable') {
        lines.push('**Why this isn\'t a code fix:** see linked rule file for the SAQ answer template.');
      } else if (cat === 'noise') {
        lines.push('**Why this is noise:** see linked rule file for the dismissal reasoning.');
      } else if (cat === 'unknown') {
        lines.push('**Why "Unknown":** No rule file exists for this alert type.');
        lines.push(`Suggested next step: read the ZAP HTML report for context (alongside this triage.md), and consider opening a PR adding configs/casa/rules/<slug>.md if it's a recurring CASA-relevant alert.`);
      }
      lines.push('');
    }
  }

  // Failures
  if (failures.length > 0) {
    lines.push('## Failures');
    lines.push('');
    lines.push('The following targets failed to scan and produced no findings to triage:');
    lines.push('');
    for (const f of failures) {
      lines.push(`- **${f.name}** (stage: ${f.stage}): ${f.error}`);
    }
    lines.push('');
  }

  appendNextStep(lines, {
    actionableCount: counts.actionable?.unique || 0,
    saqExplainableCount: counts['saq-explainable']?.unique || 0,
  });

  return lines.join('\n');
}

function appendNextStep(lines, { actionableCount, saqExplainableCount }) {
  lines.push('---');
  lines.push('');
  lines.push('## Next step:');
  lines.push('');
  if (actionableCount > 0) {
    lines.push('Open Claude Code in this repo and ask "triage my CASA findings".');
    lines.push('The casa-ready:triage-findings skill will read this file, locate the Actionable findings in your code, and propose patches.');
  } else if (saqExplainableCount > 0) {
    lines.push('No code changes needed. To refine the SAQ answer text using your specific evidence, open Claude Code and ask "help me refine my CASA SAQ answers".');
    lines.push('The casa-ready:triage-findings skill will personalize the templates from the rule files using your scan evidence.');
    lines.push('');
    lines.push('Alternatively, paste the SAQ-explainable section into your TAC submission as-is.');
  } else {
    lines.push('You\'re clear — no Actionable or SAQ-explainable findings. Proceed to TAC portal upload.');
  }
  lines.push('');
}

function labelFor(cat) {
  if (cat === 'actionable') return 'Actionable';
  if (cat === 'saq-explainable') return 'SAQ-explainable';
  if (cat === 'noise') return 'Noise (third-party)';
  return 'Unknown';
}

function pad(s, n) {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}
