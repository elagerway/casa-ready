import { describe, it, expect, vi } from 'vitest';
import { loginToSupabase } from '../../../cli/lib/auth/supabase-login.js';

const ANON_KEY = 'public-anon-xyz';
const LOGIN_URL = 'https://x.supabase.co/auth/v1/token?grant_type=password';
const FAKE_JWT = 'eyJhbGciOiJIUzI1NiJ9.payload.sig';

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    text: async () => JSON.stringify(body),
  };
}

describe('loginToSupabase', () => {
  it('POSTs JSON-body credentials and returns access_token on 200', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, { access_token: FAKE_JWT, expires_in: 3600 }));
    const result = await loginToSupabase({
      loginUrl: LOGIN_URL,
      apiKey: ANON_KEY,
      username: 'erik@example.com',
      password: 'p@ss!',
      fetchFn,
    });
    expect(result.accessToken).toBe(FAKE_JWT);

    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(LOGIN_URL);
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.headers['apikey']).toBe(ANON_KEY);
    expect(JSON.parse(init.body)).toEqual({
      email: 'erik@example.com',
      password: 'p@ss!',
    });
  });

  it('throws an actionable error on 400 (bad credentials), surfacing Supabase error_description', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' })
    );
    await expect(
      loginToSupabase({
        loginUrl: LOGIN_URL,
        apiKey: ANON_KEY,
        username: 'wrong@x',
        password: 'wrong',
        fetchFn,
      })
    ).rejects.toThrow(/Supabase login failed.*400.*Invalid login credentials/);
  });

  it('throws when response is 200 but missing access_token', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, { weird: 'shape' }));
    await expect(
      loginToSupabase({
        loginUrl: LOGIN_URL,
        apiKey: ANON_KEY,
        username: 'u',
        password: 'p',
        fetchFn,
      })
    ).rejects.toThrow(/Supabase login response missing access_token/);
  });

  it('throws on non-JSON response body', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => '<html>oops</html>',
    }));
    await expect(
      loginToSupabase({
        loginUrl: LOGIN_URL,
        apiKey: ANON_KEY,
        username: 'u',
        password: 'p',
        fetchFn,
      })
    ).rejects.toThrow(/Supabase login response was not JSON/);
  });

  it('wraps fetch network errors with a friendly message including the URL', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(
      loginToSupabase({
        loginUrl: LOGIN_URL,
        apiKey: ANON_KEY,
        username: 'u',
        password: 'p',
        fetchFn,
      })
    ).rejects.toThrow(/Supabase login network error.*x\.supabase\.co.*fetch failed/);
  });
});
