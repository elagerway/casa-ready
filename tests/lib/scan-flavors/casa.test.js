import { describe, it, expect } from 'vitest';
import { buildArgs } from '../../../cli/lib/scan-flavors/casa.js';

describe('scan-flavors/casa', () => {
  const baseOpts = {
    targetUrl: 'https://example.com',
    configsDir: '/abs/configs/zap',
    outputDir: '/abs/out',
    contextPath: '/tmp/ctx.xml',
  };

  it('uses zap-full-scan.py', () => {
    const args = buildArgs(baseOpts);
    expect(args).toContain('zap-full-scan.py');
    expect(args).not.toContain('zap-baseline.py');
  });

  it('shares the mount + report shape with baseline', () => {
    const args = buildArgs(baseOpts);
    expect(args).toContain('-J');
    expect(args).toContain('results.json');
  });
});
