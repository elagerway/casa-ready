import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import { ConfigSchema } from './schema.js';
import { expandEnv } from './env-expand.js';

const LEGACY_JS_FILENAME = 'casa-ready.config.js';
const YAML_FILENAME = 'casa-ready.yml';

/**
 * Load and validate a YAML config from disk.
 *
 * Pipeline: read file → parse YAML → expand ${VAR} → validate via Zod.
 * Each stage emits a targeted error so users land directly on the right
 * line / variable / field.
 *
 * If the YAML file is absent but a legacy v0.2.x `casa-ready.config.js` sits
 * next to it, we surface a migration error pointing at `casa-ready init`
 * rather than the generic not-found message.
 */
export async function loadConfig(configPath) {
  let source;
  try {
    await access(configPath);
    source = await readFile(configPath, 'utf8');
  } catch {
    const dir = path.dirname(configPath);
    const legacyPath = path.join(dir, LEGACY_JS_FILENAME);
    try {
      await access(legacyPath);
    } catch {
      throw new Error(
        `Could not load config: ${YAML_FILENAME} not found at ${configPath}. ` +
          `Run \`casa-ready init\` to generate one.`
      );
    }
    throw new Error(
      `Found legacy v0.2.x config at ${legacyPath}. CASA Ready v0.3 uses YAML (${YAML_FILENAME}). ` +
        `Run \`casa-ready init\` to generate one, or see MIGRATION.md.`
    );
  }

  let parsed;
  try {
    parsed = yaml.load(source);
  } catch (err) {
    throw new Error(`Invalid YAML in ${configPath}: ${err.message}`);
  }

  const expanded = expandEnv(parsed);

  const result = ConfigSchema.safeParse(expanded);
  if (!result.success) {
    const issues = result.error.issues
      .map((iss) => `  - ${iss.path.join('.') || '(root)'}: ${iss.message}`)
      .join('\n');
    throw new Error(`Config validation failed in ${configPath}:\n${issues}`);
  }
  return result.data;
}

export function resolveTargets(config, envName, filterName) {
  const envDef = config.envs[envName];
  if (!envDef) {
    const known = Object.keys(config.envs).join(', ');
    throw new Error(`Unknown env: ${envName}. Known envs: ${known}`);
  }
  if (!filterName) {
    // Return a shallow copy so callers can't mutate the live config.
    return envDef.targets.slice();
  }
  const filtered = envDef.targets.filter((t) => t.name === filterName);
  if (filtered.length === 0) {
    const available = envDef.targets.map((t) => t.name).join(', ');
    throw new Error(`Target '${filterName}' not found in env ${envName}. Available: ${available}`);
  }
  return filtered;
}

export function readAuthCredentials() {
  const username = process.env.CASA_READY_USER;
  const password = process.env.CASA_READY_PASS;
  if (!username) {
    throw new Error('Missing CASA_READY_USER env var (auth.username)');
  }
  if (!password) {
    throw new Error('Missing CASA_READY_PASS env var (auth.password)');
  }
  return { username, password };
}
