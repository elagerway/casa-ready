#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { runScan } from '../cli/commands/scan.js';

const HELP = `casa-ready — pass Google CASA Tier 2 without paying $15K+

Usage:
  casa-ready scan [options]

Options:
  --env <staging|prod>     Which environment to scan (default: staging)
  --confirm-prod           Required when --env=prod (active scan can be destructive)
  --scan <casa|baseline>   Scan flavor (default: casa)
  --config <path>          Path to casa-ready.config.js (default: ./casa-ready.config.js)
  --help, -h               Show this help

Environment variables:
  CASA_READY_USER          Login username for the form-auth context (required)
  CASA_READY_PASS          Login password for the form-auth context (required)

Examples:
  casa-ready scan
  casa-ready scan --env prod --confirm-prod
  casa-ready scan --scan baseline
`;

async function main(argv) {
  const subcommand = argv[0];
  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    process.stdout.write(HELP);
    process.exit(subcommand ? 0 : 1);
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
      confirmProd: parsed.values['confirm-prod'],
      flavor: parsed.values.scan,
    });
    process.stdout.write(`\n✓ Scan complete.\n`);
    process.stdout.write(`  Artifacts: ${result.outputDir}\n`);
    process.stdout.write(`  Summary:   ${result.summaryPath}\n`);
    process.stdout.write(
      `  TAC submission: upload the contents of the artifacts directory to the CASA portal.\n`
    );
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
