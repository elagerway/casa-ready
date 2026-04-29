import { readFile, access } from 'node:fs/promises';

const KNOWN_AUTH_TYPES = ['form', 'supabase-jwt'];

const REQUIRED_FORM_AUTH_FIELDS = [
  'loginUrl',
  'loginRequestBody',
  'usernameField',
  'passwordField',
  'loggedInIndicator',
];

const REQUIRED_SUPABASE_AUTH_FIELDS = ['loginUrl', 'apiKey'];

export async function loadConfig(configPath) {
  let source;
  try {
    await access(configPath);
    source = await readFile(configPath, 'utf8');
  } catch {
    throw new Error(`Could not load config: file not found at ${configPath}`);
  }

  let mod;
  try {
    // Import via a data: URL so that Vite/Vitest's module resolver never sees
    // a file-system path that contains encoded characters (e.g. %20 for spaces).
    // Trade-off: the user's config file cannot use relative imports
    // (`import x from './helper.js'`) — data: URLs have no base for resolution.
    const dataUrl = 'data:text/javascript;charset=utf-8,' + encodeURIComponent(source);
    mod = await import(/* @vite-ignore */ dataUrl);
  } catch (err) {
    if (/Invalid relative URL|base scheme is not hierarchical/i.test(err.message)) {
      throw new Error(
        `Could not load config at ${configPath}: relative imports are not supported in config files. Inline the imported values directly.`
      );
    }
    throw new Error(`Could not load config at ${configPath}: ${err.message}`);
  }

  const config = mod.default;
  validateConfig(config);
  return config;
}

function validateConfig(config) {
  if (!config || typeof config !== 'object') {
    throw new Error('Config: default export must be an object');
  }
  if (!config.app || typeof config.app !== 'string') {
    throw new Error('Config: "app" must be a non-empty string');
  }
  if (!config.envs || typeof config.envs !== 'object' || Array.isArray(config.envs)) {
    throw new Error('Config: "envs" must be an object mapping env names to env definitions');
  }
  for (const [envName, envDef] of Object.entries(config.envs)) {
    validateEnv(envName, envDef);
  }
}

function validateEnv(envName, envDef) {
  if (!envDef || typeof envDef !== 'object') {
    throw new Error(`Config: "envs.${envName}" must be an object`);
  }
  if (!Array.isArray(envDef.targets) || envDef.targets.length === 0) {
    throw new Error(`Config: "envs.${envName}.targets" must be a non-empty array`);
  }
  const seenNames = new Set();
  for (const target of envDef.targets) {
    validateTarget(envName, target);
    if (seenNames.has(target.name)) {
      throw new Error(`Config: duplicate target name '${target.name}' in env ${envName}`);
    }
    seenNames.add(target.name);
  }
}

function validateTarget(envName, target) {
  if (!target || typeof target !== 'object') {
    throw new Error(`Config: target in envs.${envName}.targets must be an object`);
  }
  if (!target.name || typeof target.name !== 'string') {
    throw new Error(`Config: target.name in envs.${envName}.targets must be a non-empty string`);
  }
  if (!target.url || typeof target.url !== 'string' || !/^https?:\/\//.test(target.url)) {
    throw new Error(
      `Config: target.url for '${target.name}' in env ${envName} must be a non-empty http(s) URL`
    );
  }
  if (!target.auth || typeof target.auth !== 'object') {
    throw new Error(
      `Config: target.auth for '${target.name}' in env ${envName} must be an object`
    );
  }
  validateAuth(envName, target);
}

function validateAuth(envName, target) {
  const { auth, name } = target;
  if (!KNOWN_AUTH_TYPES.includes(auth.type)) {
    throw new Error(
      `Config: unknown auth.type '${auth.type}' for target '${name}' in env ${envName} — must be one of: ${KNOWN_AUTH_TYPES.join(', ')}`
    );
  }
  const required =
    auth.type === 'form' ? REQUIRED_FORM_AUTH_FIELDS : REQUIRED_SUPABASE_AUTH_FIELDS;
  for (const field of required) {
    if (!auth[field]) {
      throw new Error(
        `Config: auth.${field} is required for target '${name}' (auth.type=${auth.type}) in env ${envName}`
      );
    }
  }
  if (auth.type === 'supabase-jwt' && auth.refreshSeconds !== undefined) {
    if (!Number.isInteger(auth.refreshSeconds) || auth.refreshSeconds <= 0) {
      throw new Error(
        `Config: auth.refreshSeconds for '${name}' must be a positive integer (got ${auth.refreshSeconds})`
      );
    }
  }
}

export function resolveTargets(config, envName, filterName) {
  const envDef = config.envs[envName];
  if (!envDef) {
    const known = Object.keys(config.envs).join(', ');
    throw new Error(`Unknown env: ${envName}. Known envs: ${known}`);
  }
  if (!filterName) {
    // Return a shallow copy so callers can't mutate the live config (e.g.
    // splice/push corrupting the next call's resolution).
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
