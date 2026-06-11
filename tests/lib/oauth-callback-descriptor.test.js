import { describe, it, expect } from 'vitest';
import { buildDescriptor } from '../../cli/lib/oauth-callback-descriptor.js';

const target = {
  name: 'callback',
  url: 'https://example.com/auth/google/callback',
  auth: { type: 'none' },
  scan: 'oauth-callback',
  callbackParams: { state: 's', code: 'c', redirect_uri: 'https://example.com/dash' },
};

describe('buildDescriptor', () => {
  it('defaults methods to [GET] when method is absent', () => {
    expect(buildDescriptor(target)).toEqual({
      url: 'https://example.com/auth/google/callback',
      methods: ['GET'],
      params: { state: 's', code: 'c', redirect_uri: 'https://example.com/dash' },
    });
  });

  it('wraps a scalar method into an array', () => {
    expect(buildDescriptor({ ...target, method: 'POST' }).methods).toEqual(['POST']);
  });

  it('passes an array method through', () => {
    expect(buildDescriptor({ ...target, method: ['GET', 'POST'] }).methods).toEqual(['GET', 'POST']);
  });

  it('emits canonical GET-before-POST order regardless of input order', () => {
    expect(buildDescriptor({ ...target, method: ['POST', 'GET'] }).methods).toEqual(['GET', 'POST']);
  });

  it('dedupes repeated methods', () => {
    expect(buildDescriptor({ ...target, method: ['POST', 'POST', 'GET'] }).methods).toEqual(['GET', 'POST']);
  });

  it('carries callbackParams through verbatim', () => {
    expect(buildDescriptor(target).params).toEqual(target.callbackParams);
  });
});
