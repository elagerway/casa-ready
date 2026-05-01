import { describe, it, expect, vi } from 'vitest';
import { buildZapArgs, runZap } from '../../cli/lib/docker.js';

describe('buildZapArgs', () => {
  it('builds the exact argv for casa scan with no auth script (form auth)', () => {
    const args = buildZapArgs({
      flavor: 'casa',
      targetUrl: 'https://example.com',
      configsDir: '/abs/configs/zap',
      outputDir: '/abs/scan-output/prod/2026-04-29T12-00-00Z',
      contextPath: '/tmp/casa-ctx-abc.xml',
      scriptPath: null,
      containerName: 'casa-ready-spa-2026-04-30T12-00-00Z',
    });
    expect(args).toStrictEqual([
      'run',
      '--rm',
      '--name',
      'casa-ready-spa-2026-04-30T12-00-00Z',
      '-v',
      '/abs/configs/zap:/zap/configs:ro',
      '-v',
      '/abs/scan-output/prod/2026-04-29T12-00-00Z:/zap/wrk:rw',
      '-v',
      '/tmp/casa-ctx-abc.xml:/zap/context.xml:ro',
      'zaproxy/zap-stable',
      'zap-full-scan.py',
      '-t',
      'https://example.com',
      '-n',
      '/zap/context.xml',
      '-J',
      'results.json',
      '-x',
      'results.xml',
      '-r',
      'results.html',
    ]);
    // -c is intentionally absent (v0.2.1 fix): the V1 fallback policy file
    // is XML, not the TSV format zap-baseline.py / zap-full-scan.py expects.
    // ZAP silently fell back to defaults the entire time. Re-add -c when a
    // real ADA-tuned TSV policy ships.
    expect(args).not.toContain('-c');
  });

  it('omits --name when containerName is not provided (backward compat)', () => {
    const args = buildZapArgs({
      flavor: 'casa',
      targetUrl: 'https://x',
      configsDir: '/c',
      outputDir: '/o',
      contextPath: '/ctx.xml',
    });
    expect(args).not.toContain('--name');
  });

  it('emits -z replacer config when replacerHeaders is provided (v0.2.4 supabase-jwt path)', () => {
    const args = buildZapArgs({
      flavor: 'casa',
      targetUrl: 'https://api.example.com',
      configsDir: '/abs/configs/zap',
      outputDir: '/abs/scan-output/staging/2026-04-29T12-00-00Z',
      contextPath: '/tmp/casa-ctx-supabase.xml',
      replacerHeaders: [
        { name: 'Authorization', value: 'Bearer eyJhbGciOiJIUzI1NiJ9.x.y' },
        { name: 'apikey', value: 'public-anon-xyz' },
      ],
    });
    // The -z flag carries ZAP daemon options. zap-baseline.py shlex-splits
    // its value and appends each token to the daemon CLI, so values that
    // contain spaces (Authorization: Bearer <jwt>) must be single-quoted.
    expect(args).toContain('-z');
    const zIdx = args.indexOf('-z');
    const imageIdx = args.indexOf('zaproxy/zap-stable');
    // -z and its value go AFTER the image (these are ZAP-side, not Docker-side).
    expect(zIdx).toBeGreaterThan(imageIdx);
    const zValue = args[zIdx + 1];
    expect(zValue).toContain("replacer.full_list(0).matchstr=Authorization");
    expect(zValue).toContain("replacer.full_list(0).replacement=Bearer eyJhbGciOiJIUzI1NiJ9.x.y");
    expect(zValue).toContain("replacer.full_list(0).matchtype=REQ_HEADER");
    expect(zValue).toContain("replacer.full_list(0).enabled=true");
    expect(zValue).toContain("replacer.full_list(1).matchstr=apikey");
    expect(zValue).toContain("replacer.full_list(1).replacement=public-anon-xyz");
    // Multi-token values containing spaces must be single-quoted so shlex
    // keeps them as one token (not split on the space inside "Bearer X").
    expect(zValue).toContain("'replacer.full_list(0).replacement=Bearer eyJhbGciOiJIUzI1NiJ9.x.y'");
  });

  it('omits -z entirely when no replacerHeaders are passed (form-auth path)', () => {
    const args = buildZapArgs({
      flavor: 'casa',
      targetUrl: 'https://magpipe.ai',
      configsDir: '/abs/configs/zap',
      outputDir: '/abs/scan-output/prod/2026-04-29T12-00-00Z',
      contextPath: '/tmp/casa-ctx-form.xml',
    });
    expect(args).not.toContain('-z');
  });

  it('safely escapes single quotes in replacer values', () => {
    const args = buildZapArgs({
      flavor: 'baseline',
      targetUrl: 'https://x',
      configsDir: '/c',
      outputDir: '/o',
      contextPath: '/ctx.xml',
      replacerHeaders: [{ name: 'X-Custom', value: "weird'value" }],
    });
    const zIdx = args.indexOf('-z');
    // Single quote inside a single-quoted shlex token escapes as '\'' .
    // Lives inside the replacement= value, not the matchstr= value.
    expect(args[zIdx + 1]).toContain("replacement=weird'\\''value");
  });

  it('uses zap-baseline.py for the baseline flavor', () => {
    const args = buildZapArgs({
      flavor: 'baseline',
      targetUrl: 'https://magpipe.ai',
      configsDir: '/abs/configs/zap',
      outputDir: '/abs/scan-output/staging/2026-04-29T12-00-00Z',
      contextPath: '/tmp/casa-ctx-abc.xml',
    });
    expect(args).toContain('zap-baseline.py');
    expect(args).not.toContain('zap-full-scan.py');
  });

  it('mounts the user contextPath to the fixed in-container path /zap/context.xml', () => {
    // Documents the macOS Docker Desktop fix: callers can pass any host path,
    // the container always sees /zap/context.xml. -n is wired to the same.
    const args = buildZapArgs({
      flavor: 'casa',
      targetUrl: 'https://x',
      configsDir: '/c',
      outputDir: '/o',
      contextPath: '/Users/erik/scan-output/ctx.xml',
    });
    expect(args).toContain('/Users/erik/scan-output/ctx.xml:/zap/context.xml:ro');
    const nIdx = args.indexOf('-n');
    expect(args[nIdx + 1]).toBe('/zap/context.xml');
  });

  it('throws on unknown flavor', () => {
    expect(() =>
      buildZapArgs({
        flavor: 'fast',
        targetUrl: 'x',
        configsDir: 'x',
        outputDir: 'x',
        contextPath: 'x',
      })
    ).toThrow(/unknown scan flavor: fast/i);
  });
});

function fakeChild(eventToFire) {
  // eventToFire: { event: 'exit'|'error', args: [...] }
  return {
    stdout: { on: () => {} },
    stderr: { on: () => {} },
    on: (event, cb) => {
      if (event === eventToFire.event) {
        setTimeout(() => cb(...eventToFire.args), 0);
      }
    },
  };
}

describe('runZap', () => {
  it('resolves on exit code 0 (no findings)', async () => {
    const fakeSpawn = vi.fn(() => fakeChild({ event: 'exit', args: [0, null] }));
    await expect(
      runZap(['run', '--rm', 'hello-world'], { spawnFn: fakeSpawn })
    ).resolves.toEqual({ exitCode: 0 });
    expect(fakeSpawn).toHaveBeenCalledWith('docker', ['run', '--rm', 'hello-world'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  });

  // v0.2.1 fix: ZAP exits 1, 2, or 3 when it FINDS vulnerabilities — that's
  // the success path for any real scan. Previously we rejected on any non-zero
  // exit, which marked every realistic scan as a failure.
  it.each([
    [1, 'errors found (HIGH severity)'],
    [2, 'warnings found (MEDIUM severity)'],
    [3, 'errors AND warnings'],
  ])('resolves on exit code %i — %s (scan completed with findings)', async (code) => {
    const fakeSpawn = vi.fn(() => fakeChild({ event: 'exit', args: [code, null] }));
    await expect(runZap(['run'], { spawnFn: fakeSpawn })).resolves.toEqual({
      exitCode: code,
    });
  });

  it('rejects on exit code 4+ (ZAP infrastructure failure)', async () => {
    const fakeSpawn = vi.fn(() => fakeChild({ event: 'exit', args: [4, null] }));
    await expect(runZap(['run'], { spawnFn: fakeSpawn })).rejects.toThrow(
      /exited with code 4/i
    );
  });

  it('rejects with a friendly message when Docker is not installed (ENOENT)', async () => {
    const enoent = Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' });
    const fakeSpawn = vi.fn(() => fakeChild({ event: 'error', args: [enoent] }));
    await expect(runZap(['run'], { spawnFn: fakeSpawn })).rejects.toThrow(
      /Docker is not installed or not on PATH/
    );
  });

  it('rejects when the container is killed by a signal (e.g. OOM/SIGKILL)', async () => {
    // Node emits exit with (code=null, signal='SIGKILL') in this case.
    // The previous handler produced "exited with code null" — junk.
    const fakeSpawn = vi.fn(() => fakeChild({ event: 'exit', args: [null, 'SIGKILL'] }));
    await expect(runZap(['run'], { spawnFn: fakeSpawn })).rejects.toThrow(
      /killed by signal SIGKILL/
    );
  });
});
