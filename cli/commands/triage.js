import path from 'node:path';
import { runTriage } from '../lib/triage/index.js';

export async function runTriageCommand(opts) {
  const {
    scanRunPath,
    target,
    rulesDir,
    json: emitJson = false,
  } = opts;

  let result;
  try {
    result = await runTriage({
      scanRunPath,
      targetFilter: target,
      rulesDir,
      emitJson,
    });
  } catch (err) {
    if (err.code === 'NO_SCAN_OUTPUT') {
      process.stderr.write(`✗ ${err.message}\n`);
      return { exitCode: 2 };
    }
    throw err;
  }

  const { mdPath, jsonPath, actionableCount, totalCount } = result;
  const relMd = path.relative(process.cwd(), mdPath);

  if (totalCount === 0) {
    process.stdout.write(`\n✓ Triage complete. Wrote ${relMd} (0 findings).\n\n`);
    process.stdout.write(`Next step:\n  → You're clear. Proceed to TAC portal upload.\n`);
    return { exitCode: 0 };
  }

  if (actionableCount === 0) {
    process.stdout.write(`\n✓ Triage complete. Wrote ${relMd} (${totalCount} findings, 0 Actionable).\n\n`);
    process.stdout.write(`Next step:\n`);
    process.stdout.write(`  → No code changes needed. Open Claude Code and ask "help me refine my CASA SAQ answers"\n`);
    process.stdout.write(`    — the casa-ready:triage-findings skill will personalize the answer templates.\n`);
    process.stdout.write(`  → Or paste the SAQ-explainable section into your TAC submission as-is.\n`);
    if (jsonPath) {
      process.stdout.write(`\n  (triage.json also written for programmatic consumption.)\n`);
    }
    return { exitCode: 0 };
  }

  process.stdout.write(`\n✓ Triage complete. Wrote ${relMd} (${totalCount} findings, ${actionableCount} Actionable).\n\n`);
  process.stdout.write(`Next step:\n`);
  process.stdout.write(`  → Open Claude Code in this repo and ask "triage my CASA findings"\n`);
  process.stdout.write(`    The casa-ready:triage-findings skill will read triage.md, locate the\n`);
  process.stdout.write(`    Actionable findings in your code, and propose patches.\n\n`);
  process.stdout.write(`  (For CI: exit code 1 indicates Actionable findings present. Gate as needed.)\n`);
  if (jsonPath) {
    process.stdout.write(`\n  (triage.json also written for programmatic consumption.)\n`);
  }
  return { exitCode: 1 };
}
