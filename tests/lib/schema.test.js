import { describe, it, expect } from 'vitest';
import { ConfigSchema } from '../../cli/lib/schema.js';

const validConfig = {
  app: 'magpipe',
  envs: {
    staging: {
      targets: [
        {
          name: 'spa',
          url: 'https://staging.example.com',
          auth: {
            type: 'form',
            loginUrl: 'https://staging.example.com/login',
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

  it('omits refreshSeconds when not supplied (v0.2.4: optional, no default)', () => {
    // v0.2.4 dropped the .default(3300) — the field has no semantics in the
    // new auth path, so leaving it undefined is more honest than auto-filling.
    const cfg = structuredClone(validConfig);
    delete cfg.envs.staging.targets[1].auth.refreshSeconds;
    const parsed = ConfigSchema.parse(cfg);
    expect(parsed.envs.staging.targets[1].auth.refreshSeconds).toBeUndefined();
  });

  it('still accepts refreshSeconds when explicitly set (backward compat with v0.2.x YAMLs)', () => {
    const cfg = structuredClone(validConfig);
    cfg.envs.staging.targets[1].auth.refreshSeconds = 1800;
    const parsed = ConfigSchema.parse(cfg);
    expect(parsed.envs.staging.targets[1].auth.refreshSeconds).toBe(1800);
  });

  it('rejects an empty envs object (must contain at least one env)', () => {
    expect(() => ConfigSchema.parse({ ...validConfig, envs: {} })).toThrow(
      /envs.*at least one/i
    );
  });

  it('rejects unknown fields via .strict() — protects against typos in user YAML', () => {
    // The schema's .strict() rejects unknown keys. This is what catches
    // common user mistakes like `auth.bogusField: true` or `loginUrll`.
    const bad = structuredClone(validConfig);
    bad.envs.staging.targets[0].auth.bogusField = true;
    expect(() => ConfigSchema.parse(bad)).toThrow(/unrecognized|bogusField/i);
  });

  it('accepts a target with seedUrls (string[])', () => {
    const cfg = structuredClone(validConfig);
    cfg.envs.staging.targets[0].seedUrls = ['/foo', 'https://staging.example.com/bar'];
    expect(() => ConfigSchema.parse(cfg)).not.toThrow();
  });

  it('accepts a target with seedDir (string path)', () => {
    const cfg = structuredClone(validConfig);
    cfg.envs.staging.targets[0].seedDir = './supabase/functions';
    expect(() => ConfigSchema.parse(cfg)).not.toThrow();
  });

  it("accepts auth.type: 'none' for public endpoints", () => {
    const cfg = structuredClone(validConfig);
    cfg.envs.staging.targets[0].auth = { type: 'none' };
    expect(() => ConfigSchema.parse(cfg)).not.toThrow();
  });

  it("accepts scan: 'oauth-callback' with callbackParams + auth.type: none", () => {
    const cfg = structuredClone(validConfig);
    cfg.envs.staging.targets[0].auth = { type: 'none' };
    cfg.envs.staging.targets[0].scan = 'oauth-callback';
    cfg.envs.staging.targets[0].callbackParams = { state: 'x', code: 'y' };
    expect(() => ConfigSchema.parse(cfg)).not.toThrow();
  });

  it("rejects scan: 'oauth-callback' without callbackParams", () => {
    const cfg = structuredClone(validConfig);
    cfg.envs.staging.targets[0].auth = { type: 'none' };
    cfg.envs.staging.targets[0].scan = 'oauth-callback';
    expect(() => ConfigSchema.parse(cfg)).toThrow(/callbackParams.*required.*oauth-callback/i);
  });

  it("rejects scan: 'oauth-callback' with empty callbackParams object", () => {
    const cfg = structuredClone(validConfig);
    cfg.envs.staging.targets[0].auth = { type: 'none' };
    cfg.envs.staging.targets[0].scan = 'oauth-callback';
    cfg.envs.staging.targets[0].callbackParams = {};
    expect(() => ConfigSchema.parse(cfg)).toThrow(/callbackParams.*required.*oauth-callback/i);
  });

  it("rejects scan: 'oauth-callback' with auth.type !== 'none'", () => {
    const cfg = structuredClone(validConfig);
    cfg.envs.staging.targets[0].scan = 'oauth-callback';
    cfg.envs.staging.targets[0].callbackParams = { state: 'x', code: 'y' };
    // auth.type is still 'form' from validConfig
    expect(() => ConfigSchema.parse(cfg)).toThrow(/oauth-callback.*requires.*auth\.type.*none/i);
  });

  it("accepts scan: 'baseline' or 'casa' with no callbackParams (per-target override)", () => {
    const cfg = structuredClone(validConfig);
    cfg.envs.staging.targets[0].scan = 'baseline';
    expect(() => ConfigSchema.parse(cfg)).not.toThrow();
    cfg.envs.staging.targets[0].scan = 'casa';
    expect(() => ConfigSchema.parse(cfg)).not.toThrow();
  });

  it('rejects unknown scan flavor', () => {
    const cfg = structuredClone(validConfig);
    cfg.envs.staging.targets[0].scan = 'fast';
    expect(() => ConfigSchema.parse(cfg)).toThrow(/Invalid enum value|fast/);
  });

  it("auth.type: 'none' rejects extra keys (NoAuthSchema is .strict())", () => {
    // Catches a real failure mode: someone copies a `form` block, changes
    // `type` to `none`, and forgets to remove `loginUrl`. Without strict
    // mode, the leftover field would silently pass.
    const cfg = structuredClone(validConfig);
    cfg.envs.staging.targets[0].auth = { type: 'none', loginUrl: 'https://leftover.example.com' };
    expect(() => ConfigSchema.parse(cfg)).toThrow(/unrecognized|loginUrl/i);
  });
});
