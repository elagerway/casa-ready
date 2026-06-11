import { describe, it, expect } from 'vitest';
import { loadYaml, dumpYaml } from '../../cli/lib/yaml.js';

describe('loadYaml', () => {
  it('parses valid YAML into an object', () => {
    expect(loadYaml('app: demo\ncount: 2\n', 'Test source')).toEqual({ app: 'demo', count: 2 });
  });

  it('throws with the caller-supplied prefix on invalid YAML', () => {
    expect(() => loadYaml('foo: [unclosed', 'Invalid YAML in /tmp/casa-ready.yml')).toThrow(
      /^Invalid YAML in \/tmp\/casa-ready\.yml: /
    );
  });
});

describe('dumpYaml', () => {
  it('serializes an object to YAML', () => {
    expect(dumpYaml({ app: 'demo' })).toBe('app: demo\n');
  });

  it('defaults to noRefs so shared objects are inlined, not anchored', () => {
    const shared = { a: 1 };
    const out = dumpYaml({ x: shared, y: shared });
    expect(out).not.toContain('&');
    expect(out).not.toContain('*');
  });

  it('passes through options like lineWidth', () => {
    const long = { key: 'word '.repeat(40).trim() };
    const wide = dumpYaml(long, { lineWidth: 400 });
    expect(wide.trimEnd().split('\n')).toHaveLength(1);
  });
});
