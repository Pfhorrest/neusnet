import baseX from 'base-x';

/**
 * Bitcoin's Base58 alphabet, copied verbatim from identity.md §2:
 * "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz" — digit 0,
 * and the letters O, I, and l are omitted to avoid visual ambiguity.
 */
export const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

const base58 = baseX(BASE58_ALPHABET);

/**
 * Encode bytes as a Base58 string using the Bitcoin alphabet specified in
 * identity.md §2.
 */
export function encodeBase58(bytes: Uint8Array): string {
  return base58.encode(bytes);
}

/**
 * Decode a Base58 string (Bitcoin alphabet) back to bytes.
 *
 * Throws if the string contains any character outside the alphabet —
 * notably `0`, `O`, `I`, and `l`, which are deliberately excluded.
 */
export function decodeBase58(input: string): Uint8Array {
  return base58.decode(input);
}
