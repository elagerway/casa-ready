import { describe, it, expect } from 'vitest';
import { buildArgs } from '../../../cli/lib/scan-flavors/baseline.js';

describe('scan-flavors/baseline', () => {
  const baseOpts = {
    targetUrl: 'https://example.com',
    configsDir: '/abs/configs/zap',
    outputDir: '/abs/scan-output/staging/2026-04-29T12-00-00Z',
    contextPath: '/tmp/casa-ctx-abc.xml',
  };

  it('uses zap-baseline.py as the scan script', () => {
    const args = buildArgs(baseOpts);
    expect(args).toContain('zap-baseline.py');
    expect(args).not.toContain('zap-full-scan.py');
  });

  it('emits the standard mount + report flag set', () => {
    const args = buildArgs(baseOpts);
    expect(args).toContain('-v');
    expect(args).toContain('/abs/configs/zap:/zap/configs:ro');
    expect(args).toContain('/abs/scan-output/staging/2026-04-29T12-00-00Z:/zap/wrk:rw');
    expect(args).toContain('/tmp/casa-ctx-abc.xml:/zap/context.xml:ro');
    expect(args).toContain('-J');
    expect(args).toContain('results.json');
    expect(args).toContain('-x');
    expect(args).toContain('results.xml');
    expect(args).toContain('-r');
    expect(args).toContain('results.html');
  });

  it('emits replacer -z config when replacerHeaders is supplied', () => {
    const args = buildArgs({
      ...baseOpts,
      replacerHeaders: [{ name: 'Authorization', value: 'Bearer eyJabc' }],
    });
    expect(args).toContain('-z');
    const zIdx = args.indexOf('-z');
    expect(args[zIdx + 1]).toContain('replacer.full_list(0).matchstr=Authorization');
    expect(args[zIdx + 1]).toContain('replacer.full_list(0).replacement=Bearer eyJabc');
  });

  it('emits --name and --hook + extra mount when containerName + seed file are provided', () => {
    const args = buildArgs({
      ...baseOpts,
      containerName: 'casa-ready-spa-runId',
      seedFilePath: '/tmp/seed-urls-abc.txt',
    });
    expect(args).toContain('--name');
    expect(args).toContain('casa-ready-spa-runId');
    expect(args).toContain('/tmp/seed-urls-abc.txt:/zap/configs/seed-urls.txt:ro');
    expect(args).toContain('--hook');
    expect(args).toContain('/zap/configs/seed-spider-hook.py');
  });

  it('omits --hook when seedFilePath is not provided (no extra seeds)', () => {
    const args = buildArgs(baseOpts);
    expect(args).not.toContain('--hook');
  });

  it('renders multiple replacer headers with correct index suffixes (0, 1, 2)', () => {
    const args = buildArgs({
      ...baseOpts,
      replacerHeaders: [
        { name: 'Authorization', value: 'Bearer eyJabc' },
        { name: 'apikey', value: 'public-anon-xyz' },
        { name: 'X-Custom', value: 'third' },
      ],
    });
    const zIdx = args.indexOf('-z');
    const zValue = args[zIdx + 1];
    // Each header gets its own indexed rule. The (0)/(1)/(2) suffixes are
    // load-bearing — supabase-jwt always emits two headers, and ZAP needs
    // each rule under a unique index or it silently overwrites them.
    expect(zValue).toContain('replacer.full_list(0).matchstr=Authorization');
    expect(zValue).toContain('replacer.full_list(1).matchstr=apikey');
    expect(zValue).toContain('replacer.full_list(2).matchstr=X-Custom');
    expect(zValue).toContain('replacer.full_list(0).replacement=Bearer eyJabc');
    expect(zValue).toContain('replacer.full_list(1).replacement=public-anon-xyz');
    expect(zValue).toContain('replacer.full_list(2).replacement=third');
  });
});
