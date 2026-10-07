import { describe, expect, it } from 'vitest';
import { decodeBase64Url, encodeBase64Url } from '../../src/encoding/base64url.js';

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('encodeBase64Url', () => {
  // RFC 4648 §10 test vectors (the standard base64 vectors; base64url only
  // changes the alphabet for the two non-alphanumeric characters, and these
  // particular vectors never hit a + or /, so the encoded form is identical
  // to standard base64 minus padding).
  it.each([
    ['', ''],
    ['f', 'Zg'],
    ['fo', 'Zm8'],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg'],
    ['fooba', 'Zm9vYmE'],
    ['foobar', 'Zm9vYmFy'],
  ])('encodes %j as %j', (input, expected) => {
    expect(encodeBase64Url(utf8(input))).toBe(expected);
  });

  it('never emits padding characters', () => {
    for (let len = 0; len < 12; len++) {
      const bytes = new Uint8Array(len).fill(0xff);
      expect(encodeBase64Url(bytes)).not.toContain('=');
    }
  });

  it('uses - and _ instead of + and /', () => {
    // Byte sequences chosen to force both a 0x3e (+) and 0x3f (/) sextet
    // in standard base64, to make sure both substitutions are exercised.
    const bytes = Uint8Array.from([0xfb, 0xff, 0xbf]);
    const encoded = encodeBase64Url(bytes);
    expect(encoded).not.toMatch(/[+/]/);
    expect(encoded).toMatch(/[-_]/);
  });
});

describe('decodeBase64Url', () => {
  it.each([
    ['', ''],
    ['Zg', 'f'],
    ['Zm8', 'fo'],
    ['Zm9v', 'foo'],
    ['Zm9vYg', 'foob'],
    ['Zm9vYmE', 'fooba'],
    ['Zm9vYmFy', 'foobar'],
  ])('decodes %j as %j', (input, expected) => {
    expect(new TextDecoder().decode(decodeBase64Url(input))).toBe(expected);
  });

  it('rejects input containing padding', () => {
    expect(() => decodeBase64Url('Zg==')).toThrow();
  });

  it('rejects input containing standard base64 characters (+, /)', () => {
    expect(() => decodeBase64Url('a+b')).toThrow();
    expect(() => decodeBase64Url('a/b')).toThrow();
  });

  it('rejects input of a length that cannot be valid base64url (length % 4 === 1)', () => {
    // 6 bits per character, so a length-1-mod-4 string can only encode a
    // fractional number of bytes with leftover bits that don't fit —
    // RFC 4648's base64 alphabet never produces this length.
    expect(() => decodeBase64Url('a')).toThrow();
    expect(() => decodeBase64Url('abcde')).toThrow();
  });

  it('rejects input containing a character outside the base64url alphabet', () => {
    expect(() => decodeBase64Url('ab!d')).toThrow();
    expect(() => decodeBase64Url('a b')).toThrow();
  });

  it('round-trips arbitrary byte sequences', () => {
    for (let len = 0; len < 50; len++) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = (i * 37 + 11) % 256;
      }
      expect(decodeBase64Url(encodeBase64Url(bytes))).toEqual(bytes);
    }
  });
});
