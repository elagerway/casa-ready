import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { renderContext, deriveOriginScope } from '../zap-context.js';

const TEMPLATE_FILENAME = 'supabase-jwt-context-template.xml';
const SCRIPT_FILENAME = 'supabase-jwt-script.js';
const DEFAULT_REFRESH_SECONDS = 3300;

export async function getContext({ target, credentials, configsDir, runId: _runId }) {
  const templatePath = path.join(configsDir, TEMPLATE_FILENAME);
  const template = await readFile(templatePath, 'utf8');

  // Derive the Supabase auth base URL from loginUrl by stripping the path.
  // E.g. https://x.supabase.co/auth/v1/token?grant_type=password
  //   →  https://x.supabase.co/auth/v1
  const supabaseAuthBase = deriveSupabaseAuthBase(target.auth.loginUrl);

  const contextXml = renderContext(template, {
    contextName: target.name,
    targetUrl: target.url,
    // Origin-scoped includregex so the loginUrl path /auth/v1/... is in scope
    // alongside the targetUrl path /functions/v1 (v0.2.2 fix).
    originScope: deriveOriginScope(target.url),
    loginUrl: target.auth.loginUrl,
    apiKey: target.auth.apiKey,
    refreshSeconds: target.auth.refreshSeconds || DEFAULT_REFRESH_SECONDS,
    supabaseAuthBase,
    username: credentials.username,
    password: credentials.password,
  });

  const scriptPath = path.join(configsDir, SCRIPT_FILENAME);
  return { contextXml, scriptPath };
}

function deriveSupabaseAuthBase(loginUrl) {
  // loginUrl is expected to contain '/auth/v1/' somewhere. Find that, return
  // everything up to and including '/auth/v1'.
  const match = loginUrl.match(/^(https?:\/\/[^/]+\/auth\/v1)\b/);
  if (!match) {
    throw new Error(
      `supabase-jwt loginUrl must contain '/auth/v1/...' — got '${loginUrl}'`
    );
  }
  return match[1];
}
