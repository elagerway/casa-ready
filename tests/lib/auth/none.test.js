import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getContext } from '../../../cli/lib/auth/none.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configsDir = path.resolve(__dirname, '..', '..', '..', 'configs', 'zap');

describe('none auth getContext', () => {
  const target = {
    name: 'oauth-callback',
    url: 'https://example.com/auth/google/callback',
    auth: { type: 'none' },
  };
  const credentials = { username: 'unused', password: 'unused' };

  it('returns scope-only XML (no auth/users/session blocks)', async () => {
    const result = await getContext({ target, credentials, configsDir, runId: 'r1' });
    expect(result.contextXml).toContain('<name>oauth-callback</name>');
    expect(result.contextXml).toContain('^https://example\\.com(/.*)?$');
    const noComments = result.contextXml.replace(/<!--[\s\S]*?-->/g, '');
    expect(noComments).not.toMatch(/<authentication[\s>]/);
    expect(noComments).not.toMatch(/<users[\s>]/);
    expect(noComments).not.toMatch(/<httpauthsessionwrapper[\s>]/);
  });

  it('returns scriptPath: null and replacerHeaders: null', async () => {
    const result = await getContext({ target, credentials, configsDir, runId: 'r1' });
    expect(result.scriptPath).toBeNull();
    expect(result.replacerHeaders).toBeNull();
  });

  it('does not require credentials to be valid (skips login entirely)', async () => {
    const result = await getContext({
      target,
      credentials: { username: '', password: '' },
      configsDir,
      runId: 'r1',
    });
    expect(result.contextXml).toContain('<name>oauth-callback</name>');
  });
});
