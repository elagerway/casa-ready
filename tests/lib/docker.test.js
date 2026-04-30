import { describe, it, expect, vi } from 'vitest';
import { buildZapArgs, runZap } from '../../cli/lib/docker.js';

describe('buildZapArgs', () => {
  it('builds the exact argv for casa scan with no auth script (form auth)', () => {
    const args = buildZapArgs({
      flavor: 'casa',
      targetUrl: 'https://magpipe.ai',
      configsDir: '/abs/configs/zap',
      outputDir: '/abs/scan-output/prod/2026-04-29T12-00-00Z',
      contextPath: '/tmp/casa-ctx-abc.xml',
      scriptPath: null,
    });
    expect(args).toStrictEqual([
      'run',
      '--rm',
      '-v',
      '/abs/configs/zap:/zap/configs:ro',
      '-v',
      '/abs/scan-output/prod/2026-04-29T12-00-00Z:/zap/wrk:rw',
      '-v',
      '/tmp/casa-ctx-abc.xml:/zap/context.xml:ro',
      'zaproxy/zap-stable',
      'zap-full-scan.py',
      '-t',
      'https://magpipe.ai',
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

  it('mounts auth script and registers it via -z when scriptPath is provided', () => {
    const args = buildZapArgs({
      flavor: 'casa',
      targetUrl: 'https://api.example.com',
      configsDir: '/abs/configs/zap',
      outputDir: '/abs/scan-output/staging/2026-04-29T12-00-00Z',
      contextPath: '/tmp/casa-ctx-supabase.xml',
      scriptPath: '/abs/configs/zap/supabase-jwt-script.js',
    });
    // The script mount appears as a discrete array element (use toContain on
    // the array, not args.join(' ').toContain — paths could contain spaces).
    expect(args).toContain(
      '/abs/configs/zap/supabase-jwt-script.js:/zap/configs/supabase-jwt-script.js:ro'
    );
    // The script-mount -v flag must appear BEFORE the image name (Docker side).
    const scriptMountIdx = args.indexOf(
      '/abs/configs/zap/supabase-jwt-script.js:/zap/configs/supabase-jwt-script.js:ro'
    );
    const imageIdx = args.indexOf('zaproxy/zap-stable');
    expect(scriptMountIdx).toBeLessThan(imageIdx);
    // The -z config registers the script with ZAP under the name
    // 'supabase-jwt-auth' (matching the context's <script><name>). It must
    // appear AFTER the image name (container side, passed to ZAP).
    expect(args).toContain('-z');
    const zIdx = args.indexOf('-z');
    expect(zIdx).toBeGreaterThan(imageIdx);
    expect(args[zIdx + 1]).toContain('script.load');
    expect(args[zIdx + 1]).toContain('supabase-jwt-auth');
    expect(args[zIdx + 1]).toContain('/zap/configs/supabase-jwt-script.js');
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
