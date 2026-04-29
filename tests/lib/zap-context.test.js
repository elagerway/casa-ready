import { describe, it, expect } from 'vitest';
import { renderContext } from '../../cli/lib/zap-context.js';

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

  it('does not double-escape already-encoded entities', () => {
    const template = `<password>{{password}}</password>`;
    // Plain string with literal ampersand — should be encoded once
    const result = renderContext(template, { password: 'a&b' });
    expect(result).toBe('<password>a&amp;b</password>');
  });
});
