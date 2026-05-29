import { describe, it, expect } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_SKILLS = path.join(__dirname, '..', '..', 'plugin', 'skills');

async function findAllSkills(dir) {
  const found = [];
  async function walk(d) {
    const entries = await readdir(d, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.name === 'SKILL.md') found.push(full);
    }
  }
  await walk(dir);
  return found;
}

function parseFrontmatter(raw, filePath) {
  if (!raw.startsWith('---\n')) {
    throw new Error(`${filePath}: missing opening frontmatter delimiter`);
  }
  const closeIdx = raw.indexOf('\n---\n', 4);
  if (closeIdx === -1) throw new Error(`${filePath}: missing closing frontmatter delimiter`);
  const yamlBlock = raw.slice(4, closeIdx);
  return { frontmatter: yaml.load(yamlBlock), body: raw.slice(closeIdx + 5) };
}

describe('plugin SKILL.md validation', () => {
  it('finds at least one SKILL.md (triage-findings + 2 vendored)', async () => {
    const skills = await findAllSkills(PLUGIN_SKILLS);
    expect(skills.length).toBeGreaterThanOrEqual(3);
  });

  it('every SKILL.md has valid frontmatter with name and description', async () => {
    const skills = await findAllSkills(PLUGIN_SKILLS);
    for (const skillPath of skills) {
      const raw = await readFile(skillPath, 'utf8');
      const { frontmatter } = parseFrontmatter(raw, skillPath);
      expect(frontmatter, `${skillPath}: frontmatter parsed empty`).toBeTruthy();
      expect(frontmatter.name, `${skillPath}: missing name`).toBeTruthy();
      expect(frontmatter.description, `${skillPath}: missing description`).toBeTruthy();
    }
  });

  it('triage-findings skill has all required sections', async () => {
    const triagePath = path.join(PLUGIN_SKILLS, 'triage-findings', 'SKILL.md');
    const raw = await readFile(triagePath, 'utf8');
    expect(raw).toContain('## When to Use');
    expect(raw).toContain('## REQUIRED SUB-SKILLS');
    expect(raw).toContain('## The Process');
    expect(raw).toContain('### Phase 1');
    expect(raw).toContain('### Phase 5');
    expect(raw).toContain('## Red Flags');
    expect(raw).toContain('## Common Mistakes');
    expect(raw).toContain('## Integration');
  });

  it('every <HARD-GATE> block has a matching closing tag', async () => {
    const skills = await findAllSkills(PLUGIN_SKILLS);
    for (const skillPath of skills) {
      const raw = await readFile(skillPath, 'utf8');
      const opens = (raw.match(/<HARD-GATE>/g) || []).length;
      const closes = (raw.match(/<\/HARD-GATE>/g) || []).length;
      expect(opens, `${skillPath}: HARD-GATE tags mismatched`).toBe(closes);
    }
  });

  it('every <EXTREMELY-IMPORTANT> block has a matching closing tag', async () => {
    const skills = await findAllSkills(PLUGIN_SKILLS);
    for (const skillPath of skills) {
      const raw = await readFile(skillPath, 'utf8');
      const opens = (raw.match(/<EXTREMELY-IMPORTANT>/g) || []).length;
      const closes = (raw.match(/<\/EXTREMELY-IMPORTANT>/g) || []).length;
      expect(opens, `${skillPath}: EXTREMELY-IMPORTANT tags mismatched`).toBe(closes);
    }
  });

  it('triage-findings REQUIRED SUB-SKILLS reference vendored skills that exist', async () => {
    const triagePath = path.join(PLUGIN_SKILLS, 'triage-findings', 'SKILL.md');
    const raw = await readFile(triagePath, 'utf8');
    const required = raw.match(/superpowers:_vendored\/[a-z0-9-]+/g) || [];
    expect(required.length).toBeGreaterThan(0);
    for (const ref of required) {
      const skillName = ref.replace('superpowers:_vendored/', '');
      const skillFile = path.join(PLUGIN_SKILLS, '_vendored', skillName, 'SKILL.md');
      const exists = await readFile(skillFile, 'utf8').then(() => true, () => false);
      expect(exists, `Required vendored skill not found: ${skillFile}`).toBe(true);
    }
  });

  it('graphviz dot blocks parse (basic structural check — open + close braces match)', async () => {
    const triagePath = path.join(PLUGIN_SKILLS, 'triage-findings', 'SKILL.md');
    const raw = await readFile(triagePath, 'utf8');
    const dotMatch = raw.match(/```dot\n([\s\S]*?)\n```/);
    expect(dotMatch, 'triage-findings missing dot block').toBeTruthy();
    const dotBody = dotMatch[1];
    const opens = (dotBody.match(/\{/g) || []).length;
    const closes = (dotBody.match(/\}/g) || []).length;
    expect(opens).toBe(closes);
    expect(opens).toBeGreaterThan(0);
  });
});
