const VAR_PATTERN = /\$\{(\w+)\}/g;

/**
 * Recursively walk a value (string/object/array/scalar) and replace `${VAR}`
 * occurrences in any string with `process.env.VAR`.
 *
 * Throws on missing env var with the dotted path that referenced it (e.g.
 * `envs.staging.targets.1.auth.apiKey`) so users can find the offending line.
 *
 * `replace` does not re-scan replaced text, so a value whose expansion contains
 * `${...}` is safe — it will not be re-substituted.
 */
export function expandEnv(value, path = []) {
  if (typeof value === 'string') {
    return value.replace(VAR_PATTERN, (_match, name) => {
      const v = process.env[name];
      if (v === undefined) {
        throw new Error(
          `Missing env var: ${name} (referenced by ${path.join('.') || '(root)'})`
        );
      }
      return v;
    });
  }
  if (Array.isArray(value)) {
    return value.map((item, i) => expandEnv(item, [...path, String(i)]));
  }
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = expandEnv(v, [...path, k]);
    }
    return out;
  }
  return value;
}
