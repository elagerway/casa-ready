import yaml from 'js-yaml';

/**
 * Single js-yaml touchpoint for the CLI.
 *
 * Every caller used to wrap js-yaml with its own try/catch and error
 * message; centralizing here keeps the messages consistent and gives one
 * place to swap the YAML library if ever needed.
 */

/**
 * Parse YAML source, rethrowing parse errors as `${errorPrefix}: ${reason}`.
 */
export function loadYaml(source, errorPrefix) {
  try {
    return yaml.load(source);
  } catch (err) {
    throw new Error(`${errorPrefix}: ${err.message}`);
  }
}

/**
 * Serialize to YAML. noRefs is on by default — every existing call site
 * wants inlined values, never anchors/aliases.
 */
export function dumpYaml(doc, options = {}) {
  return yaml.dump(doc, { noRefs: true, ...options });
}
