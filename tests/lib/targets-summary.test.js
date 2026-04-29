import { describe, it, expect } from 'vitest';
import { aggregateTargets } from '../../cli/lib/targets-summary.js';
import {
  successfulTargetSummary,
  successfulApiTargetSummary,
  failedTarget,
} from '../fixtures/failed-target-fixtures.js';

describe('aggregateTargets', () => {
  it('produces a top-level summary with sections per successful target', () => {
    const md = aggregateTargets({
      app: 'magpipe',
      env: 'staging',
      timestamp: '2026-04-29T12-00-00Z',
      successes: [successfulTargetSummary, successfulApiTargetSummary],
      failures: [],
    });
    expect(md).toMatch(/^# CASA Ready Scan — magpipe \(staging\)/m);
    expect(md).toContain('## Target: spa');
    expect(md).toContain('## Target: api');
    expect(md).toContain('CSP Header Not Set');
    expect(md).toContain('Missing API rate limit');
    expect(md).not.toMatch(/## Failed targets/); // no failures
  });

  it('includes a "Failed targets" section when failures present', () => {
    const md = aggregateTargets({
      app: 'magpipe',
      env: 'staging',
      timestamp: '2026-04-29T12-00-00Z',
      successes: [successfulTargetSummary],
      failures: [failedTarget],
    });
    expect(md).toContain('## Failed targets');
    expect(md).toContain('### api');
    expect(md).toContain('Stage: runZap');
    expect(md).toContain('ZAP container exited with code 2');
    // Successful target still shown
    expect(md).toContain('## Target: spa');
  });

  it('returns "all targets failed" markdown when successes is empty', () => {
    const md = aggregateTargets({
      app: 'magpipe',
      env: 'staging',
      timestamp: '2026-04-29T12-00-00Z',
      successes: [],
      failures: [failedTarget],
    });
    expect(md).toContain('## Failed targets');
    expect(md).toContain('All targets failed.');
  });

  it('renders a header with the run timestamp', () => {
    const md = aggregateTargets({
      app: 'magpipe',
      env: 'staging',
      timestamp: '2026-04-29T12-00-00Z',
      successes: [successfulTargetSummary],
      failures: [],
    });
    expect(md).toContain('Run: 2026-04-29T12-00-00Z');
  });
});
