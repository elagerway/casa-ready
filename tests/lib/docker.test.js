import { describe, it, expect, vi } from 'vitest';
import { buildZapArgs, runZap } from '../../cli/lib/docker.js';

describe('buildZapArgs', () => {
  it('builds argv for the casa scan flavor', () => {
    const args = buildZapArgs({
      flavor: 'casa',
      targetUrl: 'https://magpipe.ai',
      configsDir: '/abs/configs/zap',
      outputDir: '/abs/scan-output/prod/2026-04-29T12-00-00Z',
      contextPath: '/tmp/casa-ctx-abc.xml',
    });
    expect(args[0]).toBe('run');
    expect(args).toContain('--rm');
    expect(args).toContain('-v');
    expect(args.join(' ')).toContain('/abs/configs/zap:/zap/configs:ro');
    expect(args.join(' ')).toContain('/abs/scan-output/prod/2026-04-29T12-00-00Z:/zap/wrk:rw');
    expect(args).toContain('zaproxy/zap-stable');
    expect(args).toContain('zap-full-scan.py');
    expect(args).toContain('-t');
    expect(args).toContain('https://magpipe.ai');
    expect(args).toContain('-c');
    expect(args).toContain('/zap/configs/casa-tier2.policy');
    expect(args).toContain('-n');
    expect(args).toContain('/tmp/casa-ctx-abc.xml');
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

describe('runZap', () => {
  it('resolves on exit code 0', async () => {
    const fakeSpawn = vi.fn(() => ({
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      on: (event, cb) => {
        if (event === 'exit') setTimeout(() => cb(0, null), 0);
      },
    }));
    await expect(
      runZap(['run', '--rm', 'hello-world'], { spawnFn: fakeSpawn })
    ).resolves.toEqual({ exitCode: 0 });
    expect(fakeSpawn).toHaveBeenCalledWith('docker', ['run', '--rm', 'hello-world'], { stdio: ['ignore', 'pipe', 'pipe'] });
  });

  it('rejects on non-zero exit code', async () => {
    const fakeSpawn = vi.fn(() => ({
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      on: (event, cb) => {
        if (event === 'exit') setTimeout(() => cb(2, null), 0);
      },
    }));
    await expect(
      runZap(['run', '--rm', 'x'], { spawnFn: fakeSpawn })
    ).rejects.toThrow(/exited with code 2/i);
  });
});
