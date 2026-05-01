import { buildCommonArgs } from './_common.js';

/**
 * Build docker argv for a CASA-tier (active) ZAP scan.
 *
 * Active scan: spider + probe attacks. NOT safe for prod by default —
 * the orchestrator gates this behind --confirm-prod when env=prod.
 * Maps to ZAP's zap-full-scan.py wrapper. ~30+ minutes for any real target.
 */
export function buildArgs(opts) {
  return buildCommonArgs({ ...opts, scriptName: 'zap-full-scan.py' });
}
