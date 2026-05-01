#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { runScan } from '../cli/commands/scan.js';

const HELP = `casa-ready — open-source toolkit for Google CASA Tier 2

Usage:
  casa-ready init                              Generate casa-ready.yml interactively
  casa-ready scan [options]                    Run a CASA-tuned scan

Options:
  --env <staging|prod>     Which environment to scan (default: staging)
  --target <name>          Scan only the named target (default: all targets in env)
  --confirm-prod           Required when --env=prod (active scan can be destructive)
  --scan <casa|baseline>   Scan flavor (default: casa)
  --config <path>          Path to casa-ready.yml (default: ./casa-ready.yml)
  --help, -h               Show this help

Environment variables:
  CASA_READY_USER          Login username for the form-auth context (required)
  CASA_READY_PASS          Login password for the form-auth context (required)

Examples:
  casa-ready init                               # interactive scaffold for new projects
  casa-ready scan                               # all targets in staging
  casa-ready scan --target spa                  # only the 'spa' target
  casa-ready scan --env prod --confirm-prod     # all targets in prod
  casa-ready scan --scan baseline               # passive scan only (faster)
`;

async function main(argv) {
  const subcommand = argv[0];
  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    process.stdout.write(HELP);
    process.exit(subcommand ? 0 : 1);
  }

  if (subcommand === 'init') {
    try {
      const { runInit } = await import('../cli/commands/init.js');
      const result = await runInit();
      if (result.aborted) {
        process.stdout.write('\nAborted. casa-ready.yml unchanged.\n');
        process.exit(0);
      }
      process.stdout.write(`\n✓ Wrote ${result.written}\n`);
      process.stdout.write(
        `  Next: export CASA_READY_USER=...; export CASA_READY_PASS=...; casa-ready scan\n`
      );
      process.exit(0);
    } catch (err) {
      process.stderr.write(`\n✗ ${err.message}\n`);
      process.exit(1);
    }
  }

  if (subcommand !== 'scan') {
    process.stderr.write(`Unknown command: ${subcommand}\n\n${HELP}`);
    process.exit(1);
  }

  let parsed;
  try {
    parsed = parseArgs({
      args: argv.slice(1),
      options: {
        env: { type: 'string', default: 'staging' },
        target: { type: 'string' },
        'confirm-prod': { type: 'boolean', default: false },
        scan: { type: 'string', default: 'casa' },
        config: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: false,
    });
  } catch (err) {
    process.stderr.write(`${err.message}\n\n${HELP}`);
    process.exit(1);
  }

  if (parsed.values.help) {
    process.stdout.write(HELP);
    process.exit(0);
  }

  try {
    const result = await runScan({
      configPath: parsed.values.config,
      env: parsed.values.env,
      target: parsed.values.target,
      confirmProd: parsed.values['confirm-prod'],
      flavor: parsed.values.scan,
    });
    const failed = result.failures.length;
    const total = result.targets.length;
    if (failed === 0) {
      process.stdout.write(`\n✓ Scan complete (${total}/${total} targets succeeded).\n`);
    } else if (failed === total) {
      process.stdout.write(`\n✗ Scan failed: 0/${total} targets succeeded.\n`);
    } else {
      process.stdout.write(`\n⚠ Scan partial: ${total - failed}/${total} targets succeeded.\n`);
    }
    process.stdout.write(`  Artifacts: ${result.outputDir}\n`);
    process.stdout.write(`  Summary:   ${result.summaryPath}\n`);
    if (failed === 0) {
      process.stdout.write(
        `  TAC submission: upload the contents of the artifacts directory to the CASA portal.\n`
      );
    } else {
      process.stdout.write(
        `  Inspect ${result.summaryPath} for per-target failure details before submitting.\n`
      );
    }
    process.exit(result.exitCode);
  } catch (err) {
    process.stderr.write(`\n✗ ${err.message}\n`);
    process.exit(1);
  }
}

main(process.argv.slice(2)).catch((err) => {
  // Defensive — every async path inside main() catches its own errors and
  // calls process.exit, so we shouldn't reach this. But if something throws
  // synchronously before the first await (e.g., a future refactor moves
  // runScan above the try-catch), we'd otherwise get an
  // UnhandledPromiseRejectionWarning instead of the clean ✗ message users
  // expect.
  process.stderr.write(`\n✗ ${err.message}\n`);
  process.exit(1);
});
