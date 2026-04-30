/**
 * Perform a Supabase Auth password login from Node, returning the access_token.
 *
 * Why this exists: V1.1 attempted in-ZAP script-based auth (Nashorn JS via
 * <authentication type=4>), but that ships with two correctness traps —
 * (1) zap-baseline.py imports the context BEFORE any -z `script.load(...)`
 * runs, so the context fails with "internal_error" because the referenced
 * script is unregistered; (2) `-z` shlex-splits its value into ZAP daemon
 * CLI args and `script.load(...)` is not a valid daemon flag, so the script
 * never registers. The result was a silent unauthenticated crawl. v0.2.4
 * pulls auth into Node so we can prove it works upfront and fail loudly
 * with a useful error if creds/keys are wrong.
 *
 * Caller injects fetchFn for testability — defaults to global fetch (Node ≥18).
 */
export async function loginToSupabase({ loginUrl, apiKey, username, password, fetchFn = fetch }) {
  let response;
  try {
    response = await fetchFn(loginUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: apiKey,
      },
      body: JSON.stringify({ email: username, password }),
    });
  } catch (err) {
    // Wrap network errors with the host so users can tell "wrong URL" from
    // "wrong creds" — Supabase URL typos are a common init mistake.
    const host = safeHost(loginUrl);
    throw new Error(`Supabase login network error reaching ${host}: ${err.message}`);
  }

  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      `Supabase login response was not JSON (HTTP ${response.status}): ${text.slice(0, 200)}`
    );
  }

  if (!response.ok) {
    const desc = parsed?.error_description || parsed?.msg || parsed?.error || text.slice(0, 200);
    throw new Error(`Supabase login failed (HTTP ${response.status}): ${desc}`);
  }

  if (!parsed.access_token) {
    throw new Error(
      `Supabase login response missing access_token. Got: ${text.slice(0, 200)}`
    );
  }

  return { accessToken: parsed.access_token };
}

function safeHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
