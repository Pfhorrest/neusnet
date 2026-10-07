import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { decodeBase58, encodeBase58 } from '../encoding/base58.js';

// @noble/ed25519's synchronous API (getPublicKey, sign, verify, keygen)
// requires a synchronous SHA-512 implementation to be wired in explicitly;
// it ships only an async (Web Crypto-backed) SHA-512 by default. We use
// the synchronous API throughout this library so it behaves identically
// and deterministically in Node and in a browser without relying on
// `await` for what is, cryptographically, pure computation.
ed.hashes.sha512 = sha512;

/** The prefix that namespaces native neusnet identifiers — see identity.md §2. */
export const NID1_PREFIX = 'nid1';

/** An Ed25519 keypair as raw 32-byte secret and public keys. */
export interface Keypair {
  readonly secretKey: Uint8Array;
  readonly publicKey: Uint8Array;
}

/**
 * Generate a new Ed25519 keypair (identity.md §3.1).
 *
 * @param seed - Optional 32-byte seed for deterministic generation. Used
 *   by tests; real identity creation should omit this and let
 *   `@noble/ed25519` draw from a cryptographically secure source
 *   (identity.md §3.1: "Key generation must use a cryptographically
 *   secure random number generator").
 */
export function generateKeypair(seed?: Uint8Array): Keypair {
  if (seed !== undefined && seed.length !== 32) {
    throw new Error(`generateKeypair: seed must be exactly 32 bytes, got ${seed.length}`);
  }
  const { secretKey, publicKey } = ed.keygen(seed);
  return { secretKey, publicKey };
}

/**
 * Encode a 32-byte Ed25519 public key as a native neusnet user identifier:
 * `nid1` followed by the Base58 (Bitcoin alphabet) encoding of the key
 * (identity.md §2).
 */
export function encodeNid1(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) {
    throw new Error(`encodeNid1: public key must be exactly 32 bytes, got ${publicKey.length}`);
  }
  return NID1_PREFIX + encodeBase58(publicKey);
}

/**
 * Decode a native neusnet user identifier back to its 32-byte Ed25519
 * public key.
 *
 * @throws If `id` does not start with the `nid1` prefix, is not valid
 *   Base58, or does not decode to exactly 32 bytes.
 */
export function decodeNid1(id: string): Uint8Array {
  if (!id.startsWith(NID1_PREFIX)) {
    throw new Error(`decodeNid1: identifier must start with "${NID1_PREFIX}", got: ${id}`);
  }
  const payload = id.slice(NID1_PREFIX.length);
  if (payload.length === 0) {
    throw new Error('decodeNid1: identifier has no payload after the nid1 prefix');
  }
  const publicKey = decodeBase58(payload);
  if (publicKey.length !== 32) {
    throw new Error(
      `decodeNid1: decoded payload is ${publicKey.length} bytes, expected exactly 32`,
    );
  }
  return publicKey;
}

/**
 * Check whether a string is a well-formed native neusnet user identifier,
 * without throwing. Useful for validating untrusted input (e.g. the
 * `author` field of an incoming post) before deciding how to handle it.
 */
export function isValidNid1(id: string): boolean {
  try {
    decodeNid1(id);
    return true;
  } catch {
    return false;
  }
}
