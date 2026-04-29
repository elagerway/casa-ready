import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getContext } from '../../../cli/lib/auth/form.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// configsDir for tests points at the real configs/zap directory so the
// form module can find form-context-template.xml.
const configsDir = path.resolve(__dirname, '..', '..', '..', 'configs', 'zap');

describe('form auth getContext', () => {
  const target = {
    name: 'spa',
    url: 'https://magpipe.ai',
    auth: {
      type: 'form',
      loginUrl: 'https://magpipe.ai/login',
      loginRequestBody: 'email={%username%}&password={%password%}',
      usernameField: 'email',
      passwordField: 'password',
      loggedInIndicator: 'Sign out|/dashboard',
    },
  };
  const credentials = { username: 'erik@example.com', password: 'p@ss!' };

  it('returns rendered XML referencing the target name and credentials', async () => {
    const result = await getContext({ target, credentials, configsDir, runId: 'r1' });
    expect(result.contextXml).toContain('<name>spa</name>');
    expect(result.contextXml).toContain('https://magpipe.ai');
    expect(result.contextXml).toContain('erik@example.com');
    expect(result.contextXml).toContain('p@ss!');
    expect(result.contextXml).not.toContain('{{');
  });

  it('returns scriptPath: null (form auth has no script)', async () => {
    const result = await getContext({ target, credentials, configsDir, runId: 'r1' });
    expect(result.scriptPath).toBeNull();
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
});
