import { describe, it, expect } from 'vitest';
import { ConfigSchema } from '../../cli/lib/schema.js';

const validConfig = {
  app: 'magpipe',
  envs: {
    staging: {
      targets: [
        {
          name: 'spa',
          url: 'https://staging.magpipe.ai',
          auth: {
            type: 'form',
            loginUrl: 'https://staging.magpipe.ai/login',
            loginRequestBody: 'email={%username%}&password={%password%}',
            usernameField: 'email',
            passwordField: 'password',
            loggedInIndicator: 'Sign out|/dashboard',
          },
        },
        {
          name: 'api',
          url: 'https://x.supabase.co/functions/v1',
          auth: {
            type: 'supabase-jwt',
            loginUrl: 'https://x.supabase.co/auth/v1/token?grant_type=password',
            apiKey: 'public-anon-key',
            refreshSeconds: 3300,
          },
        },
      ],
    },
  },
};

describe('ConfigSchema', () => {
  it('accepts a valid multi-target config (form + supabase-jwt)', () => {
    expect(() => ConfigSchema.parse(validConfig)).not.toThrow();
  });

  it('rejects empty app name', () => {
    expect(() => ConfigSchema.parse({ ...validConfig, app: '' })).toThrow();
  });

  it('rejects empty targets array', () => {
    const bad = structuredClone(validConfig);
    bad.envs.staging.targets = [];
    expect(() => ConfigSchema.parse(bad)).toThrow(/targets.*at least 1/i);
  });

  it('rejects duplicate target names within the same env', () => {
    const bad = structuredClone(validConfig);
    bad.envs.staging.targets[1].name = 'spa';
    expect(() => ConfigSchema.parse(bad)).toThrow(/duplicate target name/i);
  });

  it('rejects unknown auth.type', () => {
    const bad = structuredClone(validConfig);
    bad.envs.staging.targets[0].auth = { type: 'bogus' };
    expect(() => ConfigSchema.parse(bad)).toThrow(/Invalid discriminator|expected.*form.*supabase-jwt/i);
  });

  it('rejects form auth missing loginUrl', () => {
    const bad = structuredClone(validConfig);
    delete bad.envs.staging.targets[0].auth.loginUrl;
    expect(() => ConfigSchema.parse(bad)).toThrow();
  });

  it('rejects supabase-jwt auth missing apiKey', () => {
    const bad = structuredClone(validConfig);
    delete bad.envs.staging.targets[1].auth.apiKey;
    expect(() => ConfigSchema.parse(bad)).toThrow();
  });

  it('rejects target.url that is not http(s)', () => {
    const bad = structuredClone(validConfig);
    bad.envs.staging.targets[0].url = 'ftp://x';
    expect(() => ConfigSchema.parse(bad)).toThrow(/url.*http/i);
  });

  it('rejects refreshSeconds <= 0', () => {
    const bad = structuredClone(validConfig);
    bad.envs.staging.targets[1].auth.refreshSeconds = 0;
    expect(() => ConfigSchema.parse(bad)).toThrow(/refreshSeconds.*positive/i);
  });

  it('defaults refreshSeconds to 3300 when omitted', () => {
    const cfg = structuredClone(validConfig);
    delete cfg.envs.staging.targets[1].auth.refreshSeconds;
    const parsed = ConfigSchema.parse(cfg);
    expect(parsed.envs.staging.targets[1].auth.refreshSeconds).toBe(3300);
  });
});
