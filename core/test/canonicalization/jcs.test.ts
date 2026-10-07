import { describe, expect, it } from 'vitest';
import { canonicalizeJson } from '../../src/canonicalization/jcs.js';

describe('canonicalizeJson', () => {
  it('sorts object keys lexicographically', () => {
    expect(canonicalizeJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('sorts keys recursively at all nesting levels', () => {
    expect(canonicalizeJson({ z: { d: 1, c: 2 }, a: 1 })).toBe('{"a":1,"z":{"c":2,"d":1}}');
  });

  it('produces no insignificant whitespace', () => {
    const result = canonicalizeJson({ a: [1, 2, 3], b: 'x' });
    expect(result).toBe('{"a":[1,2,3],"b":"x"}');
  });

  it('preserves array element order (arrays are not sorted)', () => {
    expect(canonicalizeJson({ a: [3, 1, 2] })).toBe('{"a":[3,1,2]}');
  });

  it('does NOT normalize unicode strings (RFC 8785 preserves them "as is")', () => {
    // "é" as a single precomposed codepoint (U+00E9) vs. "e" + combining
    // acute accent (U+0065 U+0301) look identical to a human but are
    // different code point sequences. RFC 8785 is explicit that
    // JCS-compliant processing performs no Unicode normalization and
    // "MUST preserve Unicode string data as is" — so these must NOT
    // canonicalize to the same output. (identity.md §4.2 previously
    // claimed the opposite; this test guards against reintroducing
    // that inaccuracy.)
    const precomposed = { name: '\u00e9' };
    const decomposed = { name: 'e\u0301' };
    expect(canonicalizeJson(precomposed)).not.toBe(canonicalizeJson(decomposed));
    expect(canonicalizeJson(precomposed)).toBe('{"name":"\u00e9"}');
    expect(canonicalizeJson(decomposed)).toBe('{"name":"e\u0301"}');
  });

  it.each([
    [0, '0'],
    [-0, '0'],
    [1, '1'],
    [-1, '-1'],
    [1.5, '1.5'],
    [100, '100'],
    [1e21, '1e+21'],
  ])('serializes number %j as %j', (num, expected) => {
    expect(canonicalizeJson({ n: num })).toBe(`{"n":${expected}}`);
  });

  it('round-trips through JSON.parse to an equivalent structure', () => {
    const original = { z: 1, a: { nested: true, values: [1, 2, 3] }, m: 'hello' };
    const canonical = canonicalizeJson(original);
    expect(JSON.parse(canonical)).toEqual(original);
  });

  it('is deterministic across repeated calls and key insertion order', () => {
    const obj1 = { a: 1, b: 2, c: 3 };
    const obj2 = { c: 3, b: 2, a: 1 };
    expect(canonicalizeJson(obj1)).toBe(canonicalizeJson(obj2));
  });

  it('escapes required characters in strings', () => {
    expect(canonicalizeJson({ s: 'a"b\\c' })).toBe('{"s":"a\\"b\\\\c"}');
  });

  it('handles nested arrays of objects, sorting each object independently', () => {
    const input = {
      list: [
        { b: 1, a: 2 },
        { d: 1, c: 2 },
      ],
    };
    expect(canonicalizeJson(input)).toBe('{"list":[{"a":2,"b":1},{"c":2,"d":1}]}');
  });

  it('throws when given a value canonicalize cannot serialize', () => {
    // A bare top-level `undefined` has no JSON representation.
    expect(() => canonicalizeJson(undefined)).toThrow();
  });
});
