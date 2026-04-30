import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { expandEnv } from '../../cli/lib/env-expand.js';

describe('expandEnv', () => {
  let original;
  beforeEach(() => {
    original = { ...process.env };
  });
  afterEach(() => {
    process.env = original;
  });

  it('returns scalars unchanged when no ${VAR} present', () => {
    expect(expandEnv('hello')).toBe('hello');
    expect(expandEnv(42)).toBe(42);
    expect(expandEnv(null)).toBe(null);
    expect(expandEnv(true)).toBe(true);
  });

  it('expands a single ${VAR} reference in a string', () => {
    process.env.FOO = 'bar';
    expect(expandEnv('${FOO}')).toBe('bar');
  });

  it('expands multiple ${VAR} references in one string', () => {
    process.env.A = 'one';
    process.env.B = 'two';
    expect(expandEnv('${A}-${B}')).toBe('one-two');
  });

  it('walks nested objects', () => {
    process.env.HOST = 'example.com';
    const result = expandEnv({ url: 'https://${HOST}/api', nested: { x: '${HOST}' } });
    expect(result).toEqual({ url: 'https://example.com/api', nested: { x: 'example.com' } });
  });

  it('walks arrays', () => {
    process.env.A = 'first';
    process.env.B = 'second';
    expect(expandEnv(['${A}', '${B}', 'literal'])).toEqual(['first', 'second', 'literal']);
  });

  it('throws when an env var is missing, naming the dotted path', () => {
    delete process.env.MISSING_KEY;
    expect(() =>
      expandEnv({ envs: { staging: { targets: [{ auth: { apiKey: '${MISSING_KEY}' } }] } } })
    ).toThrow(/MISSING_KEY.*envs\.staging\.targets\.0\.auth\.apiKey/);
  });

  it('passes literal $ through unchanged when not in ${...} form', () => {
    expect(expandEnv('price: $100')).toBe('price: $100');
  });

  it('treats empty ${} as a literal string (no expansion)', () => {
    expect(expandEnv('${}')).toBe('${}');
  });

  it('handles values that contain ${} after expansion (no re-expansion)', () => {
    process.env.X = '${Y}';
    process.env.Y = 'should-not-be-used';
    expect(expandEnv('${X}')).toBe('${Y}');
  });
});
