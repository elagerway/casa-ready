import { describe, it, expect } from 'vitest';
import { buildArgs, renderOpenApiYaml } from '../../../cli/lib/scan-flavors/oauth-callback.js';

describe('scan-flavors/oauth-callback', () => {
  const baseOpts = {
    targetUrl: 'https://magpipe.ai/auth/google/callback',
    configsDir: '/abs/configs/zap',
    outputDir: '/abs/out',
    contextPath: '/tmp/ctx.xml',
    callbackParams: { state: 'test-state', code: 'test-code', redirect_uri: 'https://magpipe.ai/dash' },
    openApiPath: '/tmp/oauth-openapi-abc.yaml',
  };

  it('uses zap-api-scan.py with -f openapi', () => {
    const args = buildArgs(baseOpts);
    expect(args).toContain('zap-api-scan.py');
    expect(args).toContain('-f');
    const fIdx = args.indexOf('-f');
    expect(args[fIdx + 1]).toBe('openapi');
  });

  it('mounts the synthetic OpenAPI file at /zap/ root (NOT inside /zap/wrk)', () => {
    // v0.4.2 regression catch: any path inside /zap/wrk/ would fail at
    // runtime with "outside of rootfs" — Docker Desktop's virtiofs on macOS
    // can't nest a file mount inside an existing directory mount. Same bug
    // class as v0.4.1's seed-file fix.
    const args = buildArgs(baseOpts);
    expect(args).toContain('/tmp/oauth-openapi-abc.yaml:/zap/openapi.yaml:ro');
    const tIdx = args.indexOf('-t');
    expect(args[tIdx + 1]).toBe('/zap/openapi.yaml');
    // Defense in depth: assert the OpenAPI mount is NOT inside /zap/wrk/
    const openApiMount = args.find((a) => a.startsWith('/tmp/oauth-openapi-abc.yaml:'));
    expect(openApiMount).not.toMatch(/:\/zap\/wrk\//);
  });

  it('preserves the standard mount + report flag set', () => {
    const args = buildArgs(baseOpts);
    expect(args).toContain('/abs/out:/zap/wrk:rw');
    expect(args).toContain('/tmp/ctx.xml:/zap/context.xml:ro');
    expect(args).toContain('-J');
    expect(args).toContain('results.json');
  });

  it('throws when callbackParams is missing', () => {
    const opts = { ...baseOpts };
    delete opts.callbackParams;
    expect(() => buildArgs(opts)).toThrow(/callbackParams.*required.*oauth-callback/i);
  });

  it('throws when openApiPath is missing', () => {
    const opts = { ...baseOpts };
    delete opts.openApiPath;
    expect(() => buildArgs(opts)).toThrow(/openApiPath.*required/i);
  });
});

describe('renderOpenApiYaml', () => {
  it('produces a single-endpoint OpenAPI 3.0 doc with one query param per callbackParams entry', () => {
    const yaml = renderOpenApiYaml({
      url: 'https://magpipe.ai/auth/google/callback',
      params: { state: 'abc', code: 'xyz' },
    });
    expect(yaml).toContain('openapi: 3.0.0');
    expect(yaml).toContain('/auth/google/callback');
    expect(yaml).toContain('name: state');
    expect(yaml).toContain('example: abc');
    expect(yaml).toContain('name: code');
    expect(yaml).toContain('example: xyz');
    expect(yaml).toContain('in: query');
    expect(yaml).toContain('required: true');
    expect(yaml).toMatch(/schema:\s*\n\s*type: string/);
  });

  it('parses the URL path correctly (no host in the path:)', () => {
    const yaml = renderOpenApiYaml({
      url: 'https://magpipe.ai/auth/google/callback',
      params: { state: 'x' },
    });
    // The OpenAPI 'paths:' key has the URL path only; the server URL has the origin.
    expect(yaml).toMatch(/servers:\n\s*-\s*url:\s*https:\/\/magpipe\.ai\b/);
    expect(yaml).toMatch(/paths:\n\s*\/auth\/google\/callback:/);
  });

  it('XML-escapes nothing (it is YAML, not XML) but quotes example values that need it', () => {
    const yaml = renderOpenApiYaml({
      url: 'https://x.com/cb',
      params: { redirect_uri: 'https://attacker.example/?next=/admin' },
    });
    // js-yaml will quote the example string because it contains a colon
    expect(yaml).toMatch(/example:\s*'?https:\/\/attacker\.example/);
  });
});
