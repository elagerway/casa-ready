import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runInit } from '../../cli/commands/init.js';

describe('runInit', () => {
  let tmpDir;
  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'casa-ready-init-'));
  });
  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('writes a valid casa-ready.yml from prompt answers (form-auth target)', async () => {
    const answers = {
      app: 'magpipe',
      stagingUrl: 'https://staging.example.com',
      addProd: false,
      targets: {
        staging: [
          {
            name: 'spa',
            url: 'https://staging.example.com',
            authType: 'form',
            loginUrl: 'https://staging.example.com/login',
            loginRequestBody: 'email={%username%}&password={%password%}',
            usernameField: 'email',
            passwordField: 'password',
            loggedInIndicator: 'Sign out|/dashboard',
          },
        ],
      },
    };
    await runInit({ cwd: tmpDir, prompts: stubPrompts(answers) });
    const written = await readFile(path.join(tmpDir, 'casa-ready.yml'), 'utf8');
    expect(written).toContain('app: magpipe');
    expect(written).toContain('# yaml-language-server: $schema=');
    expect(written).toContain('type: form');
    expect(written).toContain('loginUrl: https://staging.example.com/login');
  });

  it('writes a valid yml with a supabase-jwt target referencing ${SUPABASE_ANON_KEY}', async () => {
    const answers = {
      app: 'magpipe',
      stagingUrl: 'https://staging.example.com',
      addProd: false,
      targets: {
        staging: [
          {
            name: 'api',
            url: 'https://x.supabase.co/functions/v1',
            authType: 'supabase-jwt',
            loginUrl: 'https://x.supabase.co/auth/v1/token?grant_type=password',
            apiKeyEnvVar: 'SUPABASE_ANON_KEY',
          },
        ],
      },
    };
    await runInit({ cwd: tmpDir, prompts: stubPrompts(answers) });
    const written = await readFile(path.join(tmpDir, 'casa-ready.yml'), 'utf8');
    expect(written).toContain('type: supabase-jwt');
    expect(written).toContain('apiKey: ${SUPABASE_ANON_KEY}');
    // refreshSeconds intentionally not prompted in v0.3 — the v0.2.4 auth
    // architecture (Node-side login + replacer-injected Bearer) doesn't poll.
    // The schema still accepts it for backward compat with v0.2.x YAMLs.
    expect(written).not.toContain('refreshSeconds');
  });

  it('refuses to overwrite an existing casa-ready.yml unless confirmed', async () => {
    await writeFile(path.join(tmpDir, 'casa-ready.yml'), 'app: existing\n');
    const answers = { confirmOverwrite: false };
    const result = await runInit({ cwd: tmpDir, prompts: stubPrompts(answers) });
    expect(result.aborted).toBe(true);
    const after = await readFile(path.join(tmpDir, 'casa-ready.yml'), 'utf8');
    expect(after).toBe('app: existing\n');
  });

  it('throws if assembled config fails schema validation (e.g. missing required fields)', async () => {
    const answers = {
      app: '', // invalid — empty string
      stagingUrl: 'https://staging.example.com',
      addProd: false,
      targets: { staging: [] }, // also invalid — no targets
    };
    await expect(
      runInit({ cwd: tmpDir, prompts: stubPrompts(answers) })
    ).rejects.toThrow(/validation|app name is required/i);
  });
});

// Minimal stub: returns prompt responses in order, regardless of question.
function stubPrompts(answers) {
  const queue = scriptedQueue(answers);
  return {
    input: vi.fn(async ({ message: _m, default: def, validate }) => {
      const v = queue.shift() ?? def ?? '';
      if (validate) {
        const ok = await validate(v);
        if (ok !== true) throw new Error(typeof ok === 'string' ? ok : 'invalid');
      }
      return v;
    }),
    select: vi.fn(async () => queue.shift()),
    confirm: vi.fn(async ({ default: def }) => {
      const v = queue.shift();
      return v === undefined ? def : v;
    }),
    number: vi.fn(async ({ default: def }) => {
      const v = queue.shift();
      return v === undefined ? def : v;
    }),
  };
}

// Walks the answers shape and produces a flat queue of values in the order
// runInit's prompts will request them.
function scriptedQueue(answers) {
  if (answers.confirmOverwrite !== undefined) {
    return [answers.confirmOverwrite];
  }
  const q = [];
  q.push(answers.app);
  q.push(answers.stagingUrl);
  q.push(answers.addProd);
  for (const target of (answers.targets?.staging ?? [])) {
    q.push(true); // "add a target?"
    q.push(target.name);
    q.push(target.url);
    q.push(target.authType);
    if (target.authType === 'form') {
      q.push(target.loginUrl);
      q.push(target.loginRequestBody);
      q.push(target.usernameField);
      q.push(target.passwordField);
      q.push(target.loggedInIndicator);
    } else if (target.authType === 'supabase-jwt') {
      q.push(target.loginUrl);
      q.push(target.apiKeyEnvVar);
    }
  }
  q.push(false); // "add another target?"
  return q;
}
