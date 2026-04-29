import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getContext } from '../../../cli/lib/auth/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configsDir = path.resolve(__dirname, '..', '..', '..', 'configs', 'zap');

describe('auth dispatcher', () => {
  it('routes auth.type=form to the form renderer', async () => {
    const target = {
      name: 'spa',
      url: 'https://example.com',
      auth: {
        type: 'form',
        loginUrl: 'https://example.com/login',
        loginRequestBody: 'email={%username%}&password={%password%}',
        usernameField: 'email',
        passwordField: 'password',
        loggedInIndicator: 'Sign out',
      },
    };
    const result = await getContext({
      target,
      credentials: { username: 'u@x', password: 'p' },
      configsDir,
      runId: 'test-run-1',
    });
    expect(result.contextXml).toContain('<context>');
    expect(result.contextXml).toContain('<name>spa</name>');
    expect(result.scriptPath).toBeNull();
  });

  it('throws on unknown auth.type', async () => {
    const target = {
      name: 'x',
      url: 'https://x',
      auth: { type: 'bogus' },
    };
    await expect(
      getContext({
        target,
        credentials: { username: 'u', password: 'p' },
        configsDir,
        runId: 'test-run-2',
      })
    ).rejects.toThrow(/unknown auth\.type.*bogus/i);
  });
});
