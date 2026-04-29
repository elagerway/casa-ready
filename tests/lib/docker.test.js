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
      '-c',
      '/zap/configs/casa-tier2.policy',
      '-n',
      '/zap/context.xml',
      '-J',
      'results.json',
      '-x',
      'results.xml',
      '-r',
      'results.html',
    ]);
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
    // The script mount should appear before the image name (it's a docker flag).
    expect(args.join(' ')).toContain(
      '/abs/configs/zap/supabase-jwt-script.js:/zap/configs/supabase-jwt-script.js:ro'
    );
    // After the image name + script name, the -z config registers the script
    // with ZAP under the name 'supabase-jwt-auth' (matching the context's
    // <script><name> reference).
    expect(args).toContain('-z');
    const zIdx = args.indexOf('-z');
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
  it('resolves on exit code 0', async () => {
    const fakeSpawn = vi.fn(() => fakeChild({ event: 'exit', args: [0, null] }));
    await expect(
      runZap(['run', '--rm', 'hello-world'], { spawnFn: fakeSpawn })
    ).resolves.toEqual({ exitCode: 0 });
    expect(fakeSpawn).toHaveBeenCalledWith('docker', ['run', '--rm', 'hello-world'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  });

  it('rejects on non-zero exit code', async () => {
    const fakeSpawn = vi.fn(() => fakeChild({ event: 'exit', args: [2, null] }));
    await expect(runZap(['run', '--rm', 'x'], { spawnFn: fakeSpawn })).rejects.toThrow(
      /exited with code 2/i
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
