const PLACEHOLDER_PATTERN = /\{\{(\w+)\}\}/g;

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
