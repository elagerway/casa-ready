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

function xmlEscape(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
