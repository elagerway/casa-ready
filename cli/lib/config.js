import { readFile } from 'node:fs/promises';

export async function loadConfig(configPath) {
  let source;
  try {
    source = await readFile(configPath, 'utf8');
  } catch {
    throw new Error(`Could not load config: file not found at ${configPath}`);
  }

  let mod;
  try {
    // Import via a data: URL so that Vite/Vitest's module resolver never sees
    // a file-system path that contains encoded characters (e.g. %20 for spaces).
    const dataUrl = 'data:text/javascript;charset=utf-8,' + encodeURIComponent(source);
    mod = await import(/* @vite-ignore */ dataUrl);
  } catch (err) {
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
  if (!config.envs || typeof config.envs !== 'object') {
    throw new Error('Config: "envs" must be an object mapping env names to URLs');
  }
  if (!config.auth || typeof config.auth !== 'object') {
    throw new Error('Config: "auth" must be an object');
  }
  const requiredAuthFields = [
    'type',
    'loginUrl',
    'loginRequestBody',
    'usernameField',
    'passwordField',
    'loggedInIndicator',
  ];
  for (const field of requiredAuthFields) {
    if (!config.auth[field]) {
      throw new Error(`Config: "auth.${field}" is required`);
    }
  }
}

export function resolveEnv(config, envName) {
  const url = config.envs[envName];
  if (!url) {
    const known = Object.keys(config.envs).join(', ');
    throw new Error(`Unknown env: ${envName}. Known envs: ${known}`);
  }
  return url;
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
