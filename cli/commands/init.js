import path from 'node:path';
import { writeFile, access } from 'node:fs/promises';
import yaml from 'js-yaml';
import * as defaultPrompts from '@inquirer/prompts';
import { ConfigSchema } from '../lib/schema.js';

const YAML_FILENAME = 'casa-ready.yml';
const SCHEMA_DIRECTIVE =
  '# yaml-language-server: $schema=https://raw.githubusercontent.com/elagerway/casa-ready/main/schemas/casa-ready.schema.json';

/**
 * Interactive scaffolding for casa-ready.yml.
 *
 * @param {object} opts
 * @param {string} [opts.cwd] — directory to write into (default: process.cwd())
 * @param {object} [opts.prompts] — injectable prompt API for testability;
 *   defaults to @inquirer/prompts
 * @returns {Promise<{aborted: boolean, written?: string}>}
 */
export async function runInit({ cwd = process.cwd(), prompts = defaultPrompts } = {}) {
  const target = path.join(cwd, YAML_FILENAME);

  if (await fileExists(target)) {
    const ok = await prompts.confirm({
      message: `${YAML_FILENAME} already exists. Overwrite?`,
      default: false,
    });
    if (!ok) {
      return { aborted: true };
    }
  }

  const app = await prompts.input({
    message: 'App name (used in scan output paths and summaries):',
    validate: (v) => (v && v.trim().length > 0 ? true : 'app name is required'),
  });

  const stagingUrl = await prompts.input({
    message: 'Staging URL (the SPA / primary host):',
    validate: validateUrl,
  });

  const addProd = await prompts.confirm({
    message: 'Configure a prod env too?',
    default: true,
  });

  const stagingTargets = await collectTargets({
    envName: 'staging',
    defaultUrl: stagingUrl,
    prompts,
  });

  const config = {
    app: app.trim(),
    envs: {
      staging: { targets: stagingTargets },
    },
  };

  if (addProd) {
    // Empty prod skeleton — schema requires ≥1 target so this WILL fail
    // validation. But the more useful failure is "you said 'yes prod' so go
    // copy the staging stanza and edit the URL"; we surface that via the
    // schema error rather than re-prompting all the same questions for prod.
    config.envs.prod = { targets: [] };
  }

  const result = ConfigSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues
      .map((iss) => `  - ${iss.path.join('.') || '(root)'}: ${iss.message}`)
      .join('\n');
    throw new Error(`Config validation failed (init produced invalid output):\n${issues}`);
  }

  const yamlBody = yaml.dump(result.data, { lineWidth: 100, noRefs: true });
  const written = `${SCHEMA_DIRECTIVE}\n${yamlBody}`;
  await writeFile(target, written, 'utf8');
  return { aborted: false, written: target };
}

async function collectTargets({ envName, defaultUrl, prompts }) {
  const targets = [];
  let i = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const addOne = await prompts.confirm({
      message:
        i === 0
          ? `Add a target to ${envName}? (you'll need at least one)`
          : `Add another target to ${envName}?`,
      default: i === 0,
    });
    if (!addOne) break;

    const name = await prompts.input({
      message: `Target name (e.g. 'spa', 'api'):`,
      validate: (v) => (v && v.trim().length > 0 ? true : 'name is required'),
    });
    const url = await prompts.input({
      message: `Target URL${i === 0 ? ` (default: ${defaultUrl})` : ''}:`,
      default: i === 0 ? defaultUrl : undefined,
      validate: validateUrl,
    });
    const authType = await prompts.select({
      message: 'Auth type:',
      choices: [
        { name: 'form (HTML form POST login)', value: 'form' },
        { name: 'supabase-jwt (Supabase JSON-body login + JWT bearer)', value: 'supabase-jwt' },
      ],
    });

    let auth;
    if (authType === 'form') {
      const loginUrl = await prompts.input({ message: 'Login URL:', validate: validateUrl });
      const loginRequestBody = await prompts.input({
        message: "Login request body (use {%username%} / {%password%} for ZAP substitution):",
        default: 'email={%username%}&password={%password%}',
      });
      const usernameField = await prompts.input({
        message: 'Username field name:',
        default: 'email',
      });
      const passwordField = await prompts.input({
        message: 'Password field name:',
        default: 'password',
      });
      const loggedInIndicator = await prompts.input({
        message: 'Logged-in regex (matched against responses):',
        default: 'Sign out',
      });
      auth = {
        type: 'form',
        loginUrl,
        loginRequestBody,
        usernameField,
        passwordField,
        loggedInIndicator,
      };
    } else {
      const loginUrl = await prompts.input({
        message: 'Supabase auth endpoint:',
        validate: (v) =>
          /\/auth\/v1\//.test(v) ? true : 'must contain /auth/v1/ (Supabase Auth REST shape)',
      });
      const apiKeyEnvVar = await prompts.input({
        message: 'Env var name for Supabase anon key:',
        default: 'SUPABASE_ANON_KEY',
      });
      // refreshSeconds intentionally NOT prompted in v0.3 — the v0.2.4 auth
      // architecture (Node-side login + replacer-injected static Bearer)
      // doesn't poll. Schema still accepts it for backward-compat with v0.2.x
      // YAMLs; new YAMLs simply omit it.
      auth = {
        type: 'supabase-jwt',
        loginUrl,
        apiKey: `\${${apiKeyEnvVar}}`,
      };
    }

    targets.push({ name: name.trim(), url, auth });
    i++;
  }
  return targets;
}

async function fileExists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function validateUrl(v) {
  try {
    const u = new URL(v);
    if (!/^https?:$/.test(u.protocol)) return 'URL must use http or https';
    return true;
  } catch {
    return 'Invalid URL';
  }
}
