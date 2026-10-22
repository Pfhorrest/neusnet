import baseX from 'base-x';

/**
 * Lowercase base36: digits then letters, in natural order — unlike
 * {@link import('./base58.js').BASE58_ALPHABET}, which uses a scrambled
 * (Bitcoin) ordering, base36 has no such convention to match; this is the
 * standard alphabet. Used by {@link import('../identity/ipns.js').deriveIpnsName}
 * for the multibase `base36` representation of a libp2p CIDv1.
 */
export const BASE36_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

const base36 = baseX(BASE36_ALPHABET);

/** Encode bytes as a lowercase base36 string. */
export function encodeBase36(bytes: Uint8Array): string {
  return base36.encode(bytes);
}

/** Decode a lowercase base36 string back to bytes. Throws on uppercase or any other out-of-alphabet character. */
export function decodeBase36(input: string): Uint8Array {
  return base36.decode(input);
}
