/**
 * base64url encoding per RFC 4648 §5, with padding omitted as required by
 * identity.md §4.3 ("Base64url — RFC 4648 §5, no padding").
 *
 * Implemented from scratch on plain `Uint8Array` rather than `Buffer` so
 * this module behaves identically in Node and in a browser — see
 * client-recommendations.md on neusnet clients being web-deployable.
 */

// Non-null assertions (`!`) below are safe by construction: every index
// into ALPHABET is produced by masking to 6 bits (`& 0x3f`) or shifting a
// byte (0-255) right by 2-6 bits, so it is always in [0, 63] against a
// 64-character alphabet. `noUncheckedIndexedAccess` can't see that, so
// we assert it explicitly rather than add dead runtime guards.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

// Built once: maps each base64url character's char code to its 6-bit value.
const DECODE_MAP: Record<string, number> = {};
for (let i = 0; i < ALPHABET.length; i++) {
  DECODE_MAP[ALPHABET[i]!] = i;
}

/**
 * Encode bytes as an unpadded base64url string.
 */
export function encodeBase64Url(bytes: Uint8Array): string {
  let output = '';
  let i = 0;

  for (; i + 3 <= bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1]!;
    const b2 = bytes[i + 2]!;
    output += ALPHABET[b0 >> 2]!;
    output += ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)]!;
    output += ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)]!;
    output += ALPHABET[b2 & 0x3f]!;
  }

  const remaining = bytes.length - i;
  if (remaining === 1) {
    const b0 = bytes[i]!;
    output += ALPHABET[b0 >> 2]!;
    output += ALPHABET[(b0 & 0x03) << 4]!;
  } else if (remaining === 2) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1]!;
    output += ALPHABET[b0 >> 2]!;
    output += ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)]!;
    output += ALPHABET[(b1 & 0x0f) << 2]!;
  }

  return output;
}

/**
 * Decode an unpadded base64url string back to bytes.
 *
 * Rejects padding (`=`) and standard base64's `+`/`/` characters, since a
 * value using either is not valid output of {@link encodeBase64Url} and
 * accepting it silently would mask a producer that isn't following
 * identity.md §4.3.
 */
export function decodeBase64Url(input: string): Uint8Array {
  if (input.length === 0) {
    return new Uint8Array(0);
  }
  if (/[=+/]/.test(input)) {
    throw new Error(
      'decodeBase64Url: input must be unpadded base64url (no "=", "+", or "/"); ' +
        'got: ' +
        JSON.stringify(input),
    );
  }
  if (input.length % 4 === 1) {
    throw new Error('decodeBase64Url: invalid length (not a valid base64url encoding)');
  }

  const values: number[] = [];
  for (const char of input) {
    const value = DECODE_MAP[char];
    if (value === undefined) {
      throw new Error(`decodeBase64Url: invalid character ${JSON.stringify(char)}`);
    }
    values.push(value);
  }

  const outputLength = Math.floor((values.length * 6) / 8);
  const output = new Uint8Array(outputLength);
  let bitBuffer = 0;
  let bitCount = 0;
  let outputIndex = 0;

  for (const value of values) {
    bitBuffer = (bitBuffer << 6) | value;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      output[outputIndex++] = (bitBuffer >> bitCount) & 0xff;
    }
  }

  return output;
}
