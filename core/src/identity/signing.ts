import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { canonicalizeJson } from '../canonicalization/jcs.js';
import { decodeBase64Url, encodeBase64Url } from '../encoding/base64url.js';

ed.hashes.sha512 = sha512;

const utf8Encoder = new TextEncoder();

/**
 * Produce the exact bytes that get signed for a neusnet object: JCS
 * canonicalization (identity.md §4.2) of every field *except* any
 * `signature` field, UTF-8 encoded.
 *
 * Exported because other signature schemes referenced in identity.md §4.1
 * (for alternative identity substrates) need to sign the same byte
 * sequence even though they don't use {@link signObject}'s Ed25519 path.
 */
export function bytesToSign(obj: object): Uint8Array {
  const { signature: _signature, ...rest } = obj as Record<string, unknown>;
  return utf8Encoder.encode(canonicalizeJson(rest));
}

/**
 * Sign a neusnet object with a native Ed25519 secret key, per identity.md
 * §4.1–§4.3.
 *
 * Any pre-existing `signature` field on `obj` is excluded from what gets
 * signed and is replaced in the result — so re-signing an already-signed
 * object with the same key and the same other fields is idempotent.
 *
 * Returns a *new* object; `obj` is not mutated.
 */
export function signObject<T extends object>(
  obj: T,
  secretKey: Uint8Array,
): T & { signature: string } {
  const message = bytesToSign(obj);
  const signatureBytes = ed.sign(message, secretKey);
  const { signature: _signature, ...rest } = obj as Record<string, unknown>;
  return { ...rest, signature: encodeBase64Url(signatureBytes) } as T & { signature: string };
}

/**
 * Verify a neusnet object's `signature` field against a native Ed25519
 * public key, per identity.md §4.4.
 *
 * Returns `false` — rather than throwing — for any object that is
 * malformed (missing or non-string `signature` field) or whose signature
 * does not verify, so callers can use it directly as a filter over
 * untrusted input: "A record whose signature does not verify must be
 * treated as invalid and discarded" (identity.md §4.4) is naturally
 * expressed as `if (!verifyObject(record, key)) continue;`.
 */
export function verifyObject(obj: object, publicKey: Uint8Array): boolean {
  const signature = (obj as Record<string, unknown>).signature;
  if (typeof signature !== 'string') {
    return false;
  }

  let signatureBytes: Uint8Array;
  try {
    signatureBytes = decodeBase64Url(signature);
  } catch {
    return false;
  }

  const message = bytesToSign(obj);
  try {
    return ed.verify(signatureBytes, message, publicKey);
  } catch {
    return false;
  }
}
