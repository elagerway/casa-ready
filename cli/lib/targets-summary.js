/**
 * Aggregate per-target scan summaries into a single top-level summary.
 *
 * @param {object} input
 * @param {string} input.app — app name from config
 * @param {string} input.env — env name (staging|prod)
 * @param {string} input.timestamp — ISO-like timestamp string for this run
 * @param {Array<{name, outputDir, summaryMd}>} input.successes
 * @param {Array<{name, outputDir, error, stage}>} input.failures
 * @returns {string} markdown
 */
export function aggregateTargets({ app, env, timestamp, successes, failures }) {
  const lines = [`# CASA Ready Scan — ${app} (${env})`, ''];
  lines.push(`Run: ${timestamp}`);
  lines.push(`Targets: ${successes.length + failures.length} (${successes.length} succeeded, ${failures.length} failed)`);
  lines.push('');

  for (const success of successes) {
    lines.push(`## Target: ${success.name}`);
    lines.push('');
    lines.push(`Artifacts: \`${success.outputDir}\``);
    lines.push('');
    // Strip the per-target summary's own H1 to avoid heading collisions
    const body = success.summaryMd.replace(/^# .*\n+/, '');
    lines.push(body);
    lines.push('');
  }

  if (failures.length > 0) {
    lines.push('## Failed targets');
    lines.push('');
    if (successes.length === 0) {
      lines.push('All targets failed.');
      lines.push('');
    }
    for (const failure of failures) {
      lines.push(`### ${failure.name}`);
      lines.push('');
      lines.push(`- Stage: ${failure.stage}`);
      lines.push(`- Error: ${failure.error.message}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}
