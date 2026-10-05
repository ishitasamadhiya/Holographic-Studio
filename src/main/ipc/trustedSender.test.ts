import { describe, expect, it } from 'vitest';
import { createSenderCheck, originOf } from './trustedSender';

describe('originOf', () => {
  it('extracts scheme and host, also for the custom app scheme', () => {
    expect(originOf('app://studio/index.html')).toBe('app://studio');
    expect(originOf('http://localhost:5173/gallery.html?x=1#y')).toBe('http://localhost:5173');
    expect(originOf('https://example.com')).toBe('https://example.com');
  });

  it('returns null for things without a host or that are not URLs', () => {
    expect(originOf('about:blank')).toBeNull();
    expect(originOf('file:///etc/passwd')).toBeNull();
    expect(originOf('not a url')).toBeNull();
    expect(originOf('')).toBeNull();
  });
});

describe('createSenderCheck', () => {
  const isTrusted = createSenderCheck(['app://studio', 'http://localhost:5173/']);

  it('trusts any page of the app itself and of the dev server', () => {
    expect(isTrusted('app://studio/index.html')).toBe(true);
    expect(isTrusted('app://studio/gallery.html')).toBe(true);
    expect(isTrusted('http://localhost:5173/index.html')).toBe(true);
  });

  it('trusts nothing else', () => {
    expect(isTrusted('app://other/index.html')).toBe(false);
    expect(isTrusted('https://studio/index.html')).toBe(false);
    expect(isTrusted('http://localhost:5174/')).toBe(false);
    expect(isTrusted('https://evil.example/app://studio')).toBe(false);
    expect(isTrusted('about:blank')).toBe(false);
    expect(isTrusted('file:///Users/x/index.html')).toBe(false);
    expect(isTrusted('')).toBe(false);
  });

  it('ignores unusable entries in the trusted list', () => {
    expect(createSenderCheck(['', 'nonsense'])('app://studio/')).toBe(false);
  });
});
