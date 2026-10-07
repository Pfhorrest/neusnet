import { describe, expect, it } from 'vitest';
import {
  decodeNid1,
  encodeNid1,
  generateKeypair,
  isValidNid1,
  NID1_PREFIX,
} from '../../src/identity/keypair.js';

describe('generateKeypair', () => {
  it('produces a 32-byte secret key and a 32-byte public key', () => {
    const kp = generateKeypair();
    expect(kp.secretKey).toHaveLength(32);
    expect(kp.publicKey).toHaveLength(32);
  });

  it('produces different keys on each call', () => {
    const a = generateKeypair();
    const b = generateKeypair();
    expect(a.secretKey).not.toEqual(b.secretKey);
    expect(a.publicKey).not.toEqual(b.publicKey);
  });

  it('is deterministic given an explicit 32-byte seed', () => {
    const seed = new Uint8Array(32).fill(7);
    const a = generateKeypair(seed);
    const b = generateKeypair(seed);
    expect(a.secretKey).toEqual(b.secretKey);
    expect(a.publicKey).toEqual(b.publicKey);
  });

  it('rejects a seed that is not exactly 32 bytes', () => {
    expect(() => generateKeypair(new Uint8Array(31))).toThrow();
    expect(() => generateKeypair(new Uint8Array(33))).toThrow();
    expect(() => generateKeypair(new Uint8Array(0))).toThrow();
  });
});

describe('encodeNid1 / decodeNid1', () => {
  it('encodes a public key with the nid1 prefix', () => {
    const kp = generateKeypair(new Uint8Array(32).fill(1));
    const id = encodeNid1(kp.publicKey);
    expect(id.startsWith(NID1_PREFIX)).toBe(true);
  });

  it('round-trips a public key through encode/decode', () => {
    const kp = generateKeypair(new Uint8Array(32).fill(42));
    const id = encodeNid1(kp.publicKey);
    expect(decodeNid1(id)).toEqual(kp.publicKey);
  });

  it('produces identical identifiers for the same public key every time', () => {
    const kp = generateKeypair(new Uint8Array(32).fill(3));
    expect(encodeNid1(kp.publicKey)).toBe(encodeNid1(kp.publicKey));
  });

  it('rejects public keys that are not exactly 32 bytes', () => {
    expect(() => encodeNid1(new Uint8Array(31))).toThrow();
    expect(() => encodeNid1(new Uint8Array(33))).toThrow();
  });

  it('rejects decoding a string without the nid1 prefix', () => {
    expect(() => decodeNid1('nope1abc')).toThrow();
  });

  it('rejects decoding a malformed nid1 string', () => {
    expect(() => decodeNid1('nid1')).toThrow(); // empty payload
    expect(() => decodeNid1('nid1' + '0'.repeat(10))).toThrow(); // '0' invalid in base58
  });

  it('rejects decoding a nid1 string whose payload is not 32 bytes', () => {
    // A validly-base58-encoded but wrong-length payload (e.g. only 4 bytes).
    const shortPayload = encodeNid1Helper(new Uint8Array(4).fill(9));
    expect(() => decodeNid1(shortPayload)).toThrow();
  });
});

describe('isValidNid1', () => {
  it('returns true for a well-formed identifier', () => {
    const kp = generateKeypair(new Uint8Array(32).fill(5));
    expect(isValidNid1(encodeNid1(kp.publicKey))).toBe(true);
  });

  it('returns false rather than throwing for malformed input', () => {
    expect(isValidNid1('not-an-identifier')).toBe(false);
    expect(isValidNid1('')).toBe(false);
    expect(isValidNid1('nid1')).toBe(false);
  });
});

// Local helper only for constructing a deliberately-wrong-length payload,
// bypassing encodeNid1's own 32-byte validation.
function encodeNid1Helper(bytes: Uint8Array): string {
  // Re-implemented inline (not importing encodeBase58 to keep this test
  // file's intent self-evident) using the same alphabet as src/encoding/base58.
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let num = 0n;
  for (const b of bytes) num = num * 256n + BigInt(b);
  let out = '';
  while (num > 0n) {
    out = ALPHABET[Number(num % 58n)]! + out; // in [0,57] against a 58-char alphabet, by construction
    num /= 58n;
  }
  for (const b of bytes) {
    if (b === 0) out = '1' + out;
    else break;
  }
  return NID1_PREFIX + (out || '1');
}
