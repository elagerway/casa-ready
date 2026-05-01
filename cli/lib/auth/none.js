import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { renderContext, deriveOriginScope } from '../zap-context.js';

const TEMPLATE_FILENAME = 'none-context-template.xml';

/**
 * Render a scope-only ZAP context for a public (unauthenticated) target.
 *
 * Used by oauth-callback targets and any other genuinely public endpoint.
 * Returns no replacerHeaders (no Bearer token to inject) and no scriptPath
 * (no Nashorn auth script to mount). The context defines scope only, so
 * ZAP's spider stays in-bounds while not attempting any login.
 */
export async function getContext({ target, credentials: _credentials, configsDir, runId: _runId }) {
  const templatePath = path.join(configsDir, TEMPLATE_FILENAME);
  const template = await readFile(templatePath, 'utf8');
  const contextXml = renderContext(template, {
    contextName: target.name,
    originScope: deriveOriginScope(target.url),
  });
  return { contextXml, scriptPath: null, replacerHeaders: null };
}
