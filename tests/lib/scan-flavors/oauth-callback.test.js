import { describe, it, expect } from 'vitest';
import { buildArgs } from '../../../cli/lib/scan-flavors/oauth-callback.js';

describe('scan-flavors/oauth-callback', () => {
  const baseOpts = {
    targetUrl: 'https://example.com/auth/google/callback',
    configsDir: '/abs/configs/zap',
    outputDir: '/abs/out',
    contextPath: '/tmp/ctx.xml',
    descriptorPath: '/tmp/oauth-callback-abc.json',
    containerName: 'casa-ready-callback-123',
  };

  it('uses zap-full-scan.py (not zap-api-scan.py)', () => {
    const args = buildArgs(baseOpts);
    expect(args).toContain('zap-full-scan.py');
    expect(args).not.toContain('zap-api-scan.py');
    expect(args.join(' ')).not.toMatch(/openapi/i);
  });

  it('registers the oauth-callback hook', () => {
    const args = buildArgs(baseOpts);
    const hookIdx = args.indexOf('--hook');
    expect(hookIdx).toBeGreaterThan(-1);
    expect(args[hookIdx + 1]).toBe('/zap/configs/oauth-callback-hook.py');
  });

  it('mounts the descriptor at /zap root (NOT inside /zap/wrk)', () => {
    const args = buildArgs(baseOpts);
    expect(args).toContain('/tmp/oauth-callback-abc.json:/zap/oauth-callback.json:ro');
    const descriptorMount = args.find((a) => a.startsWith('/tmp/oauth-callback-abc.json:'));
    expect(descriptorMount).not.toMatch(/:\/zap\/wrk\//);
  });

  it('targets the actual callback URL (no host-root normalization)', () => {
    const args = buildArgs(baseOpts);
    const tIdx = args.indexOf('-t');
    expect(args[tIdx + 1]).toBe('https://example.com/auth/google/callback');
  });

  it('preserves the standard mount + report flag set', () => {
    const args = buildArgs(baseOpts);
    expect(args).toContain('/abs/out:/zap/wrk:rw');
    expect(args).toContain('/tmp/ctx.xml:/zap/context.xml:ro');
    expect(args).toContain('-J');
    expect(args).toContain('results.json');
  });

  it('throws when descriptorPath is missing', () => {
    const opts = { ...baseOpts };
    delete opts.descriptorPath;
    expect(() => buildArgs(opts)).toThrow(/descriptorPath.*required/i);
  });
});
