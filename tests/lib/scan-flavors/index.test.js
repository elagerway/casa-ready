import { describe, it, expect } from 'vitest';
import { buildArgsFor } from '../../../cli/lib/scan-flavors/index.js';

describe('scan-flavors dispatcher (buildArgsFor)', () => {
  const baseOpts = {
    targetUrl: 'https://example.com',
    configsDir: '/abs/configs/zap',
    outputDir: '/abs/out',
    contextPath: '/tmp/ctx.xml',
  };

  it('routes baseline to zap-baseline.py', () => {
    const args = buildArgsFor('baseline', baseOpts);
    expect(args).toContain('zap-baseline.py');
  });

  it('routes casa to zap-full-scan.py', () => {
    const args = buildArgsFor('casa', baseOpts);
    expect(args).toContain('zap-full-scan.py');
  });

  it('routes oauth-callback to zap-api-scan.py', () => {
    const args = buildArgsFor('oauth-callback', {
      ...baseOpts,
      callbackParams: { state: 'x' },
      openApiPath: '/tmp/oauth-openapi.yaml',
    });
    expect(args).toContain('zap-api-scan.py');
  });

  it('throws on unknown flavor with the known-flavor list', () => {
    expect(() => buildArgsFor('bogus', baseOpts)).toThrow(
      /unknown scan flavor: bogus.*known flavors:.*baseline.*casa.*oauth-callback/i
    );
  });
});
