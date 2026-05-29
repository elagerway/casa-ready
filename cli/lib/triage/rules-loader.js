import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';

/**
 * Parse a rule file's raw markdown into { frontmatter, body }.
 * Frontmatter is YAML between `---\n` and `\n---\n` at the very start of the file.
 */
export function parseRuleFile(raw, sourceFile = '<unknown>') {
  // Normalize: strip UTF-8 BOM if present, then normalise CRLF → LF.
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  raw = raw.replace(/\r\n/g, '\n');

  if (!raw.startsWith('---\n')) {
    throw new Error(`Rule file ${sourceFile}: missing opening frontmatter delimiter (expected first line to be '---')`);
  }
  let closeIdx = raw.indexOf('\n---\n', 4);
  let body;
  if (closeIdx === -1) {
    // Accept closing delimiter at EOF with no trailing newline (e.g. "\n---" at end)
    if (raw.endsWith('\n---')) {
      closeIdx = raw.length - 4;
      body = '';
    } else {
      throw new Error(`Rule file ${sourceFile}: missing closing frontmatter delimiter`);
    }
  } else {
    body = raw.slice(closeIdx + 5);
  }
  const yamlBlock = raw.slice(4, closeIdx);

  let frontmatter;
  try {
    frontmatter = yaml.load(yamlBlock);
  } catch (err) {
    throw new Error(`Rule file ${sourceFile}: invalid YAML frontmatter: ${err.message}`);
  }
  if (!frontmatter || typeof frontmatter !== 'object') {
    throw new Error(`Rule file ${sourceFile}: frontmatter parsed to non-object`);
  }
  return { frontmatter, body, sourceFile };
}

/**
 * Glob a directory for *.md, parse each, and build an index by ZAP plugin ID.
 * Throws if two rule files claim the same plugin ID (silent shadowing would be a bug).
 */
export async function loadRulesIndex(rulesDir) {
  const entries = await readdir(rulesDir);
  const mdFiles = entries.filter((e) => e.endsWith('.md')).sort();

  const all = [];
  const byPluginId = new Map();
  const byAlertName = new Map();

  for (const filename of mdFiles) {
    const fullPath = path.join(rulesDir, filename);
    const raw = await readFile(fullPath, 'utf8');
    const parsed = parseRuleFile(raw, filename);
    parsed.sourcePath = fullPath;
    all.push(parsed);

    const pluginIds = parsed.frontmatter.zap_plugin_ids ?? [];
    for (const id of pluginIds) {
      if (byPluginId.has(id)) {
        const other = byPluginId.get(id).sourceFile;
        throw new Error(
          `Duplicate plugin ID ${id} in rule files: ${other} and ${filename}`
        );
      }
      byPluginId.set(id, parsed);
    }

    const alertNames = parsed.frontmatter.zap_alert_names ?? [];
    for (const name of alertNames) {
      // Alert-name matching is fuzzy fallback — duplicates are allowed (lower precedence than ID match)
      if (!byAlertName.has(name)) byAlertName.set(name, parsed);
    }
  }

  return { all, byPluginId, byAlertName };
}
