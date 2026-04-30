import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { renderContext, deriveOriginScope } from '../zap-context.js';
import { loginToSupabase } from './supabase-login.js';

const TEMPLATE_FILENAME = 'supabase-jwt-context-template.xml';

/**
 * Build the ZAP context + auth-header set for a supabase-jwt target.
 *
 * v0.2.4 architecture: we do the Supabase password login from Node and hand
 * the resulting JWT back to the orchestrator as a replacerHeaders entry. The
 * orchestrator passes those headers to docker.js, which translates them into
 * `-z -config replacer.full_list(N)...` flags. ZAP's replacer addon then
 * injects them into every in-scope request. The context XML itself only
 * defines scope; it never sees the token.
 *
 * fetchFn is injectable for testing — defaults to the global fetch (Node ≥18).
 */
export async function getContext({
  target,
  credentials,
  configsDir,
  runId: _runId,
  fetchFn = fetch,
}) {
  // Validate loginUrl shape BEFORE doing any network I/O — catches obvious
  // typos with a clear error instead of an opaque 404 from the wrong host.
  const supabaseLoginBase = matchSupabaseAuthBase(target.auth.loginUrl);

  const templatePath = path.join(configsDir, TEMPLATE_FILENAME);
  const template = await readFile(templatePath, 'utf8');

  const { accessToken } = await loginToSupabase({
    loginUrl: target.auth.loginUrl,
    apiKey: target.auth.apiKey,
    username: credentials.username,
    password: credentials.password,
    fetchFn,
  });

  const contextXml = renderContext(template, {
    contextName: target.name,
    // Origin-scoped includregex so the loginUrl path /auth/v1/... is in scope
    // alongside the targetUrl path /functions/v1 (v0.2.2 fix).
    originScope: deriveOriginScope(target.url),
  });

  return {
    contextXml,
    scriptPath: null,
    replacerHeaders: [
      { name: 'Authorization', value: `Bearer ${accessToken}` },
      { name: 'apikey', value: target.auth.apiKey },
    ],
    // surfaced for diagnostics; not currently consumed downstream
    supabaseAuthBase: supabaseLoginBase,
  };
}

function matchSupabaseAuthBase(loginUrl) {
  const match = String(loginUrl || '').match(/^(https?:\/\/[^/]+\/auth\/v1)\b/);
  if (!match) {
    throw new Error(
      `supabase-jwt loginUrl must contain '/auth/v1/...' — got '${loginUrl}'`
    );
  }
  return match[1];
}
