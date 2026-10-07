import { describe, expect, it } from 'vitest';
import {
  isValidContentReference,
  validateContentReference,
} from '../../src/metadata/content-reference.js';

describe('validateContentReference', () => {
  it('accepts a minimal reference with only uri', () => {
    expect(() => validateContentReference({ uri: 'ipfs://bafybeig...' })).not.toThrow();
  });

  // metadata.md §4.2's inline content example, verbatim.
  it('accepts the spec\u2019s inline content example (§4.2)', () => {
    const ref = {
      uri: 'inline:',
      mime_type: 'text/plain',
      inline_content: 'The actual text of the post goes here.',
    };
    expect(validateContentReference(ref)).toEqual(ref);
  });

  // One content reference from Appendix B, verbatim.
  it('accepts a full-featured reference from the spec\u2019s Appendix B', () => {
    const ref = {
      uri: 'ipfs://bafybeig...',
      mime_type: 'text/html',
      size: 142080,
      hash: 'sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    };
    expect(validateContentReference(ref)).toEqual(ref);
  });

  it('rejects a missing uri', () => {
    expect(() => validateContentReference({ mime_type: 'text/plain' })).toThrow();
  });

  it('rejects a non-string uri', () => {
    expect(() => validateContentReference({ uri: 123 })).toThrow();
  });

  it('rejects an empty uri', () => {
    expect(() => validateContentReference({ uri: '' })).toThrow();
  });

  it('requires inline_content when uri is "inline:"', () => {
    expect(() => validateContentReference({ uri: 'inline:' })).toThrow();
  });

  it('rejects inline_content present when uri is not "inline:" (§4: "present only when uri is inline:")', () => {
    expect(() =>
      validateContentReference({ uri: 'ipfs://bafybeig...', inline_content: 'oops' }),
    ).toThrow();
  });

  it('rejects a non-string mime_type', () => {
    expect(() => validateContentReference({ uri: 'ipfs://x', mime_type: 7 })).toThrow();
  });

  it('rejects a mime_type with no "/"', () => {
    expect(() => validateContentReference({ uri: 'ipfs://x', mime_type: 'textplain' })).toThrow();
  });

  it('accepts a well-formed mime_type', () => {
    expect(() =>
      validateContentReference({ uri: 'ipfs://x', mime_type: 'application/json' }),
    ).not.toThrow();
  });

  it('rejects a negative size', () => {
    expect(() => validateContentReference({ uri: 'ipfs://x', size: -1 })).toThrow();
  });

  it('rejects a non-integer size', () => {
    expect(() => validateContentReference({ uri: 'ipfs://x', size: 1.5 })).toThrow();
  });

  it('accepts a zero size', () => {
    expect(() => validateContentReference({ uri: 'ipfs://x', size: 0 })).not.toThrow();
  });

  it.each([
    'sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    'blake3:def456abcdef',
  ])('accepts a well-formed hash field: %s', (hash) => {
    expect(() => validateContentReference({ uri: 'ipfs://x', hash })).not.toThrow();
  });

  it('rejects a hash with no algorithm prefix', () => {
    expect(() =>
      validateContentReference({ uri: 'ipfs://x', hash: '9f86d081884c7d659a2' }),
    ).toThrow();
  });

  it('rejects a hash with an odd-length hex digest', () => {
    expect(() => validateContentReference({ uri: 'ipfs://x', hash: 'sha256:abc' })).toThrow();
  });

  it('rejects a hash with non-hex characters in the digest', () => {
    expect(() => validateContentReference({ uri: 'ipfs://x', hash: 'sha256:zzzz' })).toThrow();
  });

  it('rejects null and non-object input', () => {
    expect(() => validateContentReference(null)).toThrow();
    expect(() => validateContentReference('a string')).toThrow();
    expect(() => validateContentReference(42)).toThrow();
    expect(() => validateContentReference(undefined)).toThrow();
  });
});

describe('isValidContentReference', () => {
  it('returns true for valid input without throwing', () => {
    expect(isValidContentReference({ uri: 'ipfs://x' })).toBe(true);
  });

  it('returns false (not throwing) for invalid input', () => {
    expect(isValidContentReference({ uri: '' })).toBe(false);
    expect(isValidContentReference(null)).toBe(false);
    expect(isValidContentReference('nope')).toBe(false);
  });
});
