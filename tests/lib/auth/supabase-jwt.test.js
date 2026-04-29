import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { stat } from 'node:fs/promises';
import { getContext } from '../../../cli/lib/auth/supabase-jwt.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configsDir = path.resolve(__dirname, '..', '..', '..', 'configs', 'zap');

describe('supabase-jwt auth getContext', () => {
  const target = {
    name: 'api',
    url: 'https://x.supabase.co/functions/v1',
    auth: {
      type: 'supabase-jwt',
      loginUrl: 'https://x.supabase.co/auth/v1/token?grant_type=password',
      apiKey: 'public-anon-key-xyz',
      refreshSeconds: 3300,
    },
  };
  const credentials = { username: 'erik@example.com', password: 'p@ss!' };

  it('returns rendered XML referencing the target name, URL, apiKey, and refresh seconds', async () => {
    const result = await getContext({ target, credentials, configsDir, runId: 'r1' });
    expect(result.contextXml).toContain('<name>api</name>');
    expect(result.contextXml).toContain('https://x.supabase.co/functions/v1');
    expect(result.contextXml).toContain('https://x.supabase.co/auth/v1/token?grant_type=password');
    expect(result.contextXml).toContain('public-anon-key-xyz');
    expect(result.contextXml).toContain('<pollfreq>3300</pollfreq>');
    expect(result.contextXml).toContain('<type>4</type>');
    expect(result.contextXml).not.toContain('{{');
  });

  it('returns scriptPath pointing to the vendored Supabase script', async () => {
    const result = await getContext({ target, credentials, configsDir, runId: 'r1' });
    expect(result.scriptPath).toBeTruthy();
    expect(result.scriptPath).toMatch(/supabase-jwt-script\.js$/);
    // Confirm it actually exists on disk
    const stats = await stat(result.scriptPath);
    expect(stats.isFile()).toBe(true);
  });

  it('uses default refreshSeconds=3300 when omitted', async () => {
    const targetNoRefresh = {
      ...target,
      auth: { ...target.auth, refreshSeconds: undefined },
    };
    const result = await getContext({
      target: targetNoRefresh,
      credentials,
      configsDir,
      runId: 'r1',
    });
    expect(result.contextXml).toContain('<pollfreq>3300</pollfreq>');
  });

  it('XML-escapes special characters in credentials', async () => {
    const credsWithSpecials = { username: 'a&b', password: '<x>"\'' };
    const result = await getContext({
      target,
      credentials: credsWithSpecials,
      configsDir,
      runId: 'r1',
    });
    expect(result.contextXml).toContain('a&amp;b');
    expect(result.contextXml).toContain('&lt;x&gt;&quot;&apos;');
  });

  it('throws an actionable error when loginUrl does not contain /auth/v1', async () => {
    const targetBadUrl = {
      ...target,
      auth: { ...target.auth, loginUrl: 'https://x.supabase.co/login' },
    };
    await expect(
      getContext({ target: targetBadUrl, credentials, configsDir, runId: 'r1' })
    ).rejects.toThrow(/loginUrl must contain.*\/auth\/v1.*https:\/\/x\.supabase\.co\/login/);
  });
});
