import { describe, expect, it } from 'vitest';
import { decodeBase58, encodeBase58 } from '../../src/encoding/base58.js';

describe('encodeBase58 / decodeBase58', () => {
  // Well-known Base58 (Bitcoin alphabet) test vectors.
  it.each([
    ['', ''],
    ['00', '1'],
    ['0000', '11'],
    ['61', '2g'],
    ['626262', 'a3gV'],
    ['636363', 'aPEr'],
    ['73696d706c792061206c6f6e6720737472696e67', '2cFupjhnEsSn59qHXstmK2ffpLv2'],
    ['00eb15231dfceb60925886b67d065299925915aeb172c06647', '1NS17iag9jJgTHD1VXjvLCEnZuQ3rJDE9L'],
    ['516b6fcd0f', 'ABnLTmg'],
    ['bf4f89001e670274dd', '3SEo3LWLoPntC'],
    ['572e4794', '3EFU7m'],
    ['ecac89cad93923c02321', 'EJDM8drfXA6uyA'],
    ['10c8511e', 'Rt5zm'],
    ['00000000000000000000', '1111111111'],
  ])('encodes hex %s as %s', (hexInput, expected) => {
    const bytes = Uint8Array.from(Buffer.from(hexInput, 'hex'));
    expect(encodeBase58(bytes)).toBe(expected);
  });

  it('decodes back to the original bytes for all vectors', () => {
    const vectors = [
      '',
      '00',
      '61',
      '626262',
      '73696d706c792061206c6f6e6720737472696e67',
      '00eb15231dfceb60925886b67d065299925915aeb172c06647',
    ];
    for (const hex of vectors) {
      const bytes = Uint8Array.from(Buffer.from(hex, 'hex'));
      expect(decodeBase58(encodeBase58(bytes))).toEqual(bytes);
    }
  });

  it('rejects characters outside the Bitcoin alphabet (no 0, O, I, l)', () => {
    for (const badChar of ['0', 'O', 'I', 'l']) {
      expect(() => decodeBase58(`abc${badChar}xyz`)).toThrow();
    }
  });

  it('round-trips random byte sequences of varying length', () => {
    for (let len = 0; len < 40; len++) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = (i * 53 + 7) % 256;
      }
      expect(decodeBase58(encodeBase58(bytes))).toEqual(bytes);
    }
  });
});
