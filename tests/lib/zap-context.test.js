import { describe, it, expect } from 'vitest';
import { renderContext, deriveOriginScope } from '../../cli/lib/zap-context.js';

const sampleTemplate = `<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <context>
    <name>{{contextName}}</name>
    <url>{{targetUrl}}</url>
    <authentication>
      <loginUrl>{{loginUrl}}</loginUrl>
      <loginRequestBody>{{loginRequestBody}}</loginRequestBody>
      <usernameField>{{usernameField}}</usernameField>
      <passwordField>{{passwordField}}</passwordField>
      <loggedInIndicator>{{loggedInIndicator}}</loggedInIndicator>
    </authentication>
    <user>
      <name>{{username}}</name>
      <password>{{password}}</password>
    </user>
  </context>
</configuration>`;

describe('renderContext', () => {
  it('substitutes all {{var}} placeholders with provided values', () => {
    const values = {
      contextName: 'magpipe-staging',
      targetUrl: 'https://magpipe-staging-snapsonic.vercel.app',
      loginUrl: 'https://magpipe-staging-snapsonic.vercel.app/login',
      loginRequestBody: 'email={%username%}&password={%password%}',
      usernameField: 'email',
      passwordField: 'password',
      loggedInIndicator: 'Sign out|/dashboard',
      username: 'erik@snapsonic.com',
      password: 'hunter2',
    };
    const result = renderContext(sampleTemplate, values);
    expect(result).toContain('<name>magpipe-staging</name>');
    expect(result).toContain('<url>https://magpipe-staging-snapsonic.vercel.app</url>');
    expect(result).toContain('<usernameField>email</usernameField>');
    expect(result).toContain('<password>hunter2</password>');
    expect(result).not.toContain('{{');
  });

  it('throws when a required placeholder has no value', () => {
    const values = { contextName: 'magpipe' }; // missing most fields
    expect(() => renderContext(sampleTemplate, values)).toThrow(
      /missing value for placeholder: targetUrl/i
    );
  });

  it('XML-escapes special characters in values', () => {
    const template = `<password>{{password}}</password>`;
    const result = renderContext(template, { password: '<script>&"\'' });
    expect(result).toBe('<password>&lt;script&gt;&amp;&quot;&apos;</password>');
  });

  it('encodes a literal ampersand exactly once', () => {
    const template = `<password>{{password}}</password>`;
    const result = renderContext(template, { password: 'a&b' });
    expect(result).toBe('<password>a&amp;b</password>');
  });

  it('treats values as raw — pre-escaped values get double-encoded', () => {
    // Documents the contract: callers must pass raw values, never pre-escaped.
    // If you pass `&amp;` you get `&amp;amp;`. Task 6 (orchestrator) must not pre-escape.
    const template = `<password>{{password}}</password>`;
    const result = renderContext(template, { password: '&amp;' });
    expect(result).toBe('<password>&amp;amp;</password>');
  });

  it('does not re-substitute when a value contains placeholder syntax', () => {
    // String.prototype.replace does not re-scan its own replacements.
    // A value containing literal `{{...}}` text is safe — it will not trigger
    // another substitution pass, even for an otherwise-known key.
    const template = `<password>{{password}}</password>`;
    const result = renderContext(template, {
      password: '{{password}}',
    });
    // The literal `{{password}}` text gets XML-escaped (the braces have no
    // special XML meaning, so they pass through) and is NOT re-substituted.
    expect(result).toBe('<password>{{password}}</password>');
  });
});

describe('deriveOriginScope', () => {
  it('derives an origin-scoped includregex for an https URL with a path', () => {
    expect(deriveOriginScope('https://x.supabase.co/functions/v1')).toBe(
      '^https://x\\.supabase\\.co(/.*)?$'
    );
  });

  it('derives an origin-scoped includregex for an http URL with a port', () => {
    expect(deriveOriginScope('http://host.docker.internal:3000/api')).toBe(
      '^http://host\\.docker\\.internal:3000(/.*)?$'
    );
  });

  it('handles bare-host URLs (no path, no trailing slash) — v0.2.3 fix', () => {
    // Without the optional-path group, ZAP's spider rejects the seed URL
    // because `https://example.com` doesn't match `https://example\.com/.*`
    // (the trailing `/.*` requires content after the slash).
    expect(deriveOriginScope('https://example.com')).toBe(
      '^https://example\\.com(/.*)?$'
    );
    // Verify the produced regex actually matches the bare URL.
    const re = new RegExp(deriveOriginScope('https://example.com'));
    expect(re.test('https://example.com')).toBe(true);
    expect(re.test('https://example.com/')).toBe(true);
    expect(re.test('https://example.com/dashboard')).toBe(true);
  });

  it('rejects host-smuggling attempts (suffix after the port/host)', () => {
    // A regex without `(/.*)?$` — e.g. `^https://example\.com.*` — would
    // accept `https://example.comevil.com` as in-scope. Origin anchoring
    // prevents that.
    const re = new RegExp(deriveOriginScope('https://example.com'));
    expect(re.test('https://example.comevil.com')).toBe(false);
    expect(re.test('https://example.com.evil.com')).toBe(false);
  });

  it('strips query strings and fragments (only origin matters for scope)', () => {
    expect(
      deriveOriginScope('https://example.com/login?next=/dashboard#x')
    ).toBe('^https://example\\.com(/.*)?$');
  });

  it('escapes regex meta characters in the host', () => {
    // Hypothetical paranoid case — most real hosts don't have these, but the
    // regex builder must not break if they show up. URL constructor only
    // accepts a small set of host chars but `.` definitely matters.
    const result = deriveOriginScope('https://api.example.com/foo');
    expect(result).toBe('^https://api\\.example\\.com(/.*)?$');
  });

  it('throws on an invalid URL', () => {
    expect(() => deriveOriginScope('not a url')).toThrow(
      /Could not derive origin scope/i
    );
  });
});
