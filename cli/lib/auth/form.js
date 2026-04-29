import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { renderContext } from '../zap-context.js';

const TEMPLATE_FILENAME = 'form-context-template.xml';

export async function getContext({ target, credentials, configsDir, runId: _runId }) {
  const templatePath = path.join(configsDir, TEMPLATE_FILENAME);
  const template = await readFile(templatePath, 'utf8');
  const contextXml = renderContext(template, {
    contextName: target.name,
    targetUrl: target.url,
    loginUrl: target.auth.loginUrl,
    loginRequestBody: target.auth.loginRequestBody,
    usernameField: target.auth.usernameField,
    passwordField: target.auth.passwordField,
    loggedInIndicator: target.auth.loggedInIndicator,
    username: credentials.username,
    password: credentials.password,
  });
  return { contextXml, scriptPath: null };
}
