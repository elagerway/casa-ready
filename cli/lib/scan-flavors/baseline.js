import { buildCommonArgs } from './_common.js';

/**
 * Build docker argv for a baseline (passive) ZAP scan.
 *
 * Passive scan: spider only, no active probes. Safe to run against prod.
 * Maps to ZAP's zap-baseline.py wrapper. ~3 minutes for a small SPA target.
 */
export function buildArgs(opts) {
  return buildCommonArgs({ ...opts, scriptName: 'zap-baseline.py' });
}
