const PLACEHOLDER_PATTERN = /\{\{(\w+)\}\}/g;

/**
 * Substitute `{{varname}}` placeholders in a template with XML-escaped values.
 *
 * Pass RAW values — `renderContext` always XML-escapes. Pre-escaping a value
 * (e.g. passing `&amp;`) will cause double-encoding (`&amp;amp;`).
 *
 * Throws when the template references a placeholder absent from `values`.
 * `replace` does not re-scan replaced text, so a value that itself contains
 * `{{x}}` text is safe — it will not be re-substituted.
 */
export function renderContext(template, values) {
  return template.replace(PLACEHOLDER_PATTERN, (_match, key) => {
    if (!Object.prototype.hasOwnProperty.call(values, key)) {
      throw new Error(`Missing value for placeholder: ${key}`);
    }
    return xmlEscape(String(values[key]));
  });
}

/**
 * Derive a ZAP-compatible includregex that matches the entire origin (scheme +
 * host + port) of the given URL. Used in <incregexes> so that loginUrls on a
 * different path of the same host are still in scope.
 *
 * Example:
 *   'https://x.supabase.co/functions/v1' → '^https://x\\.supabase\\.co/.*'
 *   'http://host.docker.internal:3000/api' → '^http://host\\.docker\\.internal:3000/.*'
 *
 * Without this, a target like /functions/v1 with a loginUrl at /auth/v1/token
 * would have ZAP's spider reject the URL with URL_NOT_IN_CONTEXT — discovered
 * by the v0.2.1 dogfood scan.
 */
export function deriveOriginScope(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Could not derive origin scope from URL: ${url}`);
  }
  // Escape regex metachars in the host (mostly `.`; colons in host:port are
  // literal in regex).
  const escapedHost = parsed.host.replace(/[.\\+*?^$()[\]{}|]/g, '\\$&');
  return `^${parsed.protocol}//${escapedHost}/.*`;
}

function xmlEscape(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
