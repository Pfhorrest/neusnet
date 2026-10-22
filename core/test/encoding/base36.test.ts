import { describe, expect, it } from 'vitest';
import { decodeBase36, encodeBase36 } from '../../src/encoding/base36.js';

describe('encodeBase36 / decodeBase36', () => {
  it.each([
    ['', ''],
    ['00', '0'],
    ['0000', '00'],
    ['61', '2p'], // 0x61 = 97 = 2*36 + 25 -> '2','p'
    ['ff', '73'],
    [
      '0172002408011220cb311166beeedd9fb6af4cc8c2bf4ac471dcdde7a71ff032440747e084cf0cc8',
      '51qzi5uqu5dl8wlbw09j1cpr1i456yb3mv0r5wnpx3wz6qq8pnppkvgqdepc8',
    ],
  ])('encodes hex %s as %s', (hexInput, expected) => {
    const bytes = Uint8Array.from(Buffer.from(hexInput, 'hex'));
    expect(encodeBase36(bytes)).toBe(expected);
  });

  it('uses lowercase digits (0-9a-z), unlike the scrambled base58 alphabet', () => {
    expect(encodeBase36(Uint8Array.from([255, 255]))).toMatch(/^[0-9a-z]+$/);
  });

  it('round-trips random byte sequences of varying length', () => {
    for (let len = 0; len < 40; len++) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = (i * 41 + 3) % 256;
      expect(decodeBase36(encodeBase36(bytes))).toEqual(bytes);
    }
  });

  it('rejects characters outside 0-9a-z', () => {
    expect(() => decodeBase36('abc!xyz')).toThrow();
    expect(() => decodeBase36('ABC')).toThrow(); // uppercase not accepted
  });
});
