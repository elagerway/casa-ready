import { describe, it, expect, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getContext } from '../../../cli/lib/auth/supabase-jwt.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configsDir = path.resolve(__dirname, '..', '..', '..', 'configs', 'zap');

const FAKE_JWT = 'eyJhbGciOiJIUzI1NiJ9.payload.sig';

function fakeFetchOk(token = FAKE_JWT) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ access_token: token }),
  }));
}

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

describe('supabase-jwt auth getContext (v0.2.4 — Node-side login + replacer)', () => {
  it('renders a scope-only context (no <authentication>/<users>/<session>)', async () => {
    const fetchFn = fakeFetchOk();
    const result = await getContext({
      target,
      credentials,
      configsDir,
      runId: 'r1',
      fetchFn,
    });
    expect(result.contextXml).toContain('<name>api</name>');
    // Origin-scoped includregex (v0.2.2 fix) — covers the whole host so the
    // /auth/v1/token loginUrl is in scope alongside the /functions/v1 target.
    expect(result.contextXml).toContain('^https://x\\.supabase\\.co(/.*)?$');
    // Strip XML comments before checking — the template's explanatory comment
    // mentions these element names verbatim, but no actual tags should remain.
    const noComments = result.contextXml.replace(/<!--[\s\S]*?-->/g, '');
    expect(noComments).not.toMatch(/<authentication[\s>]/);
    expect(noComments).not.toMatch(/<users[\s>]/);
    expect(noComments).not.toMatch(/<forceduser[\s>]/);
    expect(noComments).not.toMatch(/<httpauthsessionwrapper[\s>]/);
    // No leftover placeholders.
    expect(result.contextXml).not.toMatch(/\{\{|\{%/);
  });

  it('returns replacerHeaders containing Bearer JWT and apikey for ZAP injection', async () => {
    const fetchFn = fakeFetchOk();
    const result = await getContext({ target, credentials, configsDir, runId: 'r1', fetchFn });
    expect(result.replacerHeaders).toEqual([
      { name: 'Authorization', value: `Bearer ${FAKE_JWT}` },
      { name: 'apikey', value: 'public-anon-key-xyz' },
    ]);
    expect(result.scriptPath).toBeNull();
  });

  it('calls fetch against the configured loginUrl with the anon apikey header', async () => {
    const fetchFn = fakeFetchOk();
    await getContext({ target, credentials, configsDir, runId: 'r1', fetchFn });
    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(target.auth.loginUrl);
    expect(init.headers.apikey).toBe(target.auth.apiKey);
    expect(JSON.parse(init.body)).toEqual({
      email: credentials.username,
      password: credentials.password,
    });
  });

  it('does NOT XML-escape the JWT into the context (token rides outside the XML now)', async () => {
    // The JWT is delivered to ZAP via -z config replacer rules — never via
    // the context XML. So the contextXml must not contain the token at all.
    const fetchFn = fakeFetchOk('eyJSECRET.tokenpart');
    const result = await getContext({ target, credentials, configsDir, runId: 'r1', fetchFn });
    expect(result.contextXml).not.toContain('eyJSECRET');
    expect(result.contextXml).not.toContain('Bearer');
  });

  it('propagates Supabase login errors with actionable context', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error_description: 'Invalid login credentials' }),
    }));
    await expect(
      getContext({ target, credentials, configsDir, runId: 'r1', fetchFn })
    ).rejects.toThrow(/Supabase login failed.*400.*Invalid login credentials/);
  });

  it('throws an actionable error when loginUrl does not contain /auth/v1', async () => {
    const targetBadUrl = {
      ...target,
      auth: { ...target.auth, loginUrl: 'https://x.supabase.co/login' },
    };
    const fetchFn = fakeFetchOk();
    await expect(
      getContext({ target: targetBadUrl, credentials, configsDir, runId: 'r1', fetchFn })
    ).rejects.toThrow(/loginUrl must contain.*\/auth\/v1.*https:\/\/x\.supabase\.co\/login/);
    // Login should NOT be attempted with an obviously-wrong loginUrl —
    // catch the misconfig before doing network I/O.
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
